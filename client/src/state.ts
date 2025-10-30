import {
  type ServerMessage,
  type MatchFoundMessage,
  type RoundStartMessage,
  type RoundResultMessage,
  type ActionBroadcastMessage,
  type MatchEndMessage,
  type MinimalSnapshot,
  type PlayerRole,
  type UnitAction,
  type RoundDiff,
  createInitialRuntime,
  simulateRound,
  type MatchRuntimeState,
  type RuntimeUnit,
  type SimulationFrame,
  type SimulationFrameUnit,
} from '@slingshot/shared';

import { MAPS, UNITS_BY_ID } from './resources';

export interface ClientUnitState {
  id: string;
  type: string;
  hp: number;
  position: { x: number; y: number };
  alive: boolean;
  graveCount: number;
}

export interface ClientState {
  status: 'connecting' | 'queueing' | 'ready' | 'waiting' | 'resolving' | 'finished';
  round: number;
  countdownMs: number;
  youUnits: ClientUnitState[];
  opponentUnits: ClientUnitState[];
  graves: Array<{ position: { x: number; y: number }; count: number }>;
  mapId?: string;
  matchId?: string;
  summary?: { winner: string };
  activeYouId: string | null;
  activeOpponentId: string | null;
}

export type TimelineListener = (frames: SimulationFrame[]) => void;
export type DiffListener = (diff: RoundDiff) => void;

const PLAYER_ORDER: PlayerRole[] = ['you', 'opponent'];

export class GameStateManager {
  private state: ClientState = {
    status: 'connecting',
    round: 0,
    countdownMs: 0,
    youUnits: [],
    opponentUnits: [],
    graves: [],
    activeYouId: null,
    activeOpponentId: null,
  };

  private runtime: MatchRuntimeState | null = null;
  private previewState: MatchRuntimeState | null = null;
  private previewRound: number | null = null;
  private previewMode: 'none' | 'partial' | 'full' = 'none';
  private firstMover: PlayerRole = 'you';
  private roundSeed = '';
  private actions: Partial<Record<PlayerRole, UnitAction>> = {};
  private pendingOutcome: ReturnType<typeof simulateRound> | null = null;
  private previewTimeline: SimulationFrame[] | null = null;
  private previewActor: PlayerRole | 'both' | null = null;
  private previewLastTime = 0;
  private timelineListeners: TimelineListener[] = [];
  private diffListeners: DiffListener[] = [];
  private listeners: Array<(state: ClientState) => void> = [];
  private matchEndListeners: Array<(payload: MatchEndMessage['payload']) => void> = [];

  subscribe(listener: (state: ClientState) => void) {
    this.listeners.push(listener);
    listener(this.state);
  }

  getSnapshot(): ClientState {
    const snapshot: ClientState = { ...this.state };
    snapshot.youUnits = this.state.youUnits.map((unit) => ({ ...unit, position: { ...unit.position } }));
    snapshot.opponentUnits = this.state.opponentUnits.map((unit) => ({ ...unit, position: { ...unit.position } }));
    snapshot.graves = this.state.graves.map((grave) => ({ position: { ...grave.position }, count: grave.count }));
    snapshot.activeYouId = this.getActiveUnitId('you');
    snapshot.activeOpponentId = this.getActiveUnitId('opponent');
    return snapshot;
  }

  onTimeline(listener: TimelineListener) {
    this.timelineListeners.push(listener);
  }

  onDiff(listener: DiffListener) {
    this.diffListeners.push(listener);
  }

  onMatchEnd(listener: (payload: MatchEndMessage['payload']) => void) {
    this.matchEndListeners.push(listener);
  }

  updateFromServer(message: ServerMessage) {
    switch (message.type) {
      case 'MATCH_FOUND':
        this.handleMatchFound(message);
        break;
      case 'ROUND_START':
        this.handleRoundStart(message);
        break;
      case 'ACTION_BROADCAST':
        this.handleActionBroadcast(message);
        break;
      case 'ROUND_RESULT':
        this.handleRoundResult(message);
        break;
      case 'RESYNC_SNAPSHOT':
        this.restoreSnapshot(message.payload);
        break;
      case 'MATCH_END':
        this.handleMatchEnd(message);
        break;
      default:
        break;
    }
  }

  setStatus(status: ClientState['status']) {
    this.state.status = status;
    this.emit();
  }

  updateCountdown(ms: number) {
    this.state.countdownMs = ms;
    this.emit();
  }

  registerPlayerAction(action: UnitAction, role: PlayerRole = 'you') {
    this.actions[role] = action;
    this.previewAction(role, action);
    if (this.hasAllActions() && !this.pendingOutcome) {
      this.prepareLocalOutcome();
    }
  }

  private getRoundOrder(): PlayerRole[] {
    return this.firstMover === 'you' ? (['you', 'opponent'] as PlayerRole[]) : (['opponent', 'you'] as PlayerRole[]);
  }

  getActiveUnitId(role: PlayerRole): string | null {
    const usePreview = this.previewMode === 'full' ? this.previewState : this.previewMode === 'partial' ? null : this.previewState;
    const source = usePreview ?? this.runtime;
    if (!source) return null;
    const order = source.turnOrder[role];
    if (order.length === 0) return null;
    const cursor = Math.max(0, Math.min(order.length - 1, source.cursors[role]));
    for (let offset = 0; offset < order.length; offset++) {
      const idx = (cursor + offset) % order.length;
      const unitId = order[idx];
      const unit = source.teams[role].units.find((candidate) => candidate.id === unitId && candidate.alive);
      if (unit) return unit.id;
    }
    return null;
  }

  private handleMatchFound(message: MatchFoundMessage) {
    const map = MAPS.find((candidate) => candidate.id === message.payload.mapId);
    if (!map) {
      console.error('Unknown map id', message.payload.mapId);
      return;
    }
    const youUnits = message.payload.you.units;
    const oppUnits = message.payload.opponent.units;

    this.runtime = createInitialRuntime(
      map,
      {
        you: { id: message.payload.you.id, name: message.payload.you.displayName, units: youUnits },
        opponent: { id: message.payload.opponent.id, name: message.payload.opponent.displayName, units: oppUnits },
      },
      { you: message.payload.turnOrderYou, opponent: message.payload.turnOrderOpp },
      { you: message.payload.cursorYou, opponent: message.payload.cursorOpp },
      'seed-initial',
    );
    this.previewState = null;
    this.previewRound = null;
    this.previewMode = 'none';
    this.previewTimeline = null;
    this.previewActor = null;
    this.previewLastTime = 0;

    this.state = {
      status: 'queueing',
      round: 0,
      countdownMs: 0,
      youUnits: youUnits.map(toClientUnit),
      opponentUnits: oppUnits.map(toClientUnit),
      graves: [],
      mapId: map.id,
      matchId: message.payload.matchId,
      activeYouId: this.getActiveUnitId('you'),
      activeOpponentId: this.getActiveUnitId('opponent'),
    };
    this.firstMover = message.payload.firstMover;
    this.actions = {};
    this.pendingOutcome = null;
    this.emit();
  }

  private handleRoundStart(message: RoundStartMessage) {
    if (!this.runtime) return;
    this.roundSeed = message.payload.randomSeed;
    this.runtime.randomSeed = message.payload.randomSeed;
    this.runtime.round = message.payload.round - 1;
    this.previewState = null;
    this.previewRound = null;
    this.previewMode = 'none';
    this.previewTimeline = null;
    this.previewActor = null;
    this.previewLastTime = 0;
    this.state.status = 'ready';
    this.state.round = message.payload.round;
    this.state.countdownMs = Math.max(message.payload.deadlineTs - Date.now(), 0);
    this.actions = {};
    this.pendingOutcome = null;
    this.state.activeYouId = this.getActiveUnitId('you');
    this.state.activeOpponentId = this.getActiveUnitId('opponent');
    this.emit();
  }

  private handleActionBroadcast(message: ActionBroadcastMessage) {
    if (!this.runtime) return;
    if (message.payload.round !== this.runtime.round + 1 && message.payload.round !== this.previewRound) {
      return;
    }
    const role = message.payload.actor;
    this.actions[role] = message.payload.action;
    if (this.pendingOutcome) {
      return;
    }
    this.previewAction(role, message.payload.action);
    if (this.hasAllActions()) {
      this.prepareLocalOutcome();
    }
  }

  private handleRoundResult(message: RoundResultMessage) {
    if (!this.runtime) return;
    const pending = this.pendingOutcome;
    const hadLocalTimeline = Boolean(pending?.frames?.length);
    const hadFullPreview = this.previewMode === 'full' && this.previewRound === message.payload.round;
    const hadPartialPreview = this.previewMode === 'partial' && this.previewRound === message.payload.round;
    const previousPreviewActor = this.previewActor;
    const previousPreviewTimeline = this.previewTimeline;
    if (pending && pending.next.round === message.payload.round) {
      this.runtime = pending.next;
    } else {
      applyDiffToRuntime(this.runtime, message.payload.diff);
      this.runtime.round = message.payload.round;
      this.runtime.cursors.you = message.payload.nextCursorYou;
      this.runtime.cursors.opponent = message.payload.nextCursorOpp;
      this.runtime.randomSeed = message.payload.randomSeed;
    }
    this.previewState = null;
    this.previewRound = null;
    this.previewMode = 'none';
    this.previewTimeline = null;
    this.previewActor = null;
    this.previewLastTime = 0;
    this.state.status = 'waiting';
    this.state.round = message.payload.round;
    this.state.countdownMs = 0;
    this.state.youUnits = this.runtime.teams.you.units.map(toClientRuntimeUnit);
    this.state.opponentUnits = this.runtime.teams.opponent.units.map(toClientRuntimeUnit);
    this.state.graves = toClientGraves(this.runtime);
    this.actions = {};
    this.pendingOutcome = null;
    this.state.activeYouId = this.getActiveUnitId('you');
    this.state.activeOpponentId = this.getActiveUnitId('opponent');
    this.emit();

    let fallbackTimeline = message.payload.timeline ?? [];
    if (hadLocalTimeline || hadFullPreview) {
      fallbackTimeline = [];
    } else if (hadPartialPreview && fallbackTimeline.length > 0 && previousPreviewTimeline?.length) {
      fallbackTimeline = buildContinuationTimeline(
        previousPreviewTimeline,
        fallbackTimeline,
        previousPreviewActor,
      );
    } else if (fallbackTimeline.length > 0) {
      fallbackTimeline = normalizeTimeline(fallbackTimeline, fallbackTimeline[0]?.time ?? 0);
    }
    if (fallbackTimeline.length > 0) {
      for (const listener of this.timelineListeners) {
        listener(fallbackTimeline);
      }
    }

    for (const listener of this.diffListeners) {
      listener(message.payload.diff);
    }
  }

  private handleMatchEnd(message: MatchEndMessage) {
    this.state.status = 'finished';
    this.state.summary = { winner: message.payload.winner };
    this.state.countdownMs = 0;
    this.runtime = null;
    this.previewState = null;
    this.previewRound = null;
    this.previewMode = 'none';
    this.previewTimeline = null;
    this.previewActor = null;
    this.previewLastTime = 0;
    this.actions = {};
    this.pendingOutcome = null;
    this.state.activeYouId = null;
    this.state.activeOpponentId = null;
    this.emit();
    for (const listener of this.matchEndListeners) {
      listener(message.payload);
    }
  }

  private restoreSnapshot(snapshot: MinimalSnapshot) {
    const map = MAPS.find((candidate) => candidate.id === snapshot.mapId);
    if (!map) return;
    if (!this.runtime) {
      this.runtime = createInitialRuntime(
        map,
        {
          you: { id: snapshot.you.id, name: snapshot.you.displayName, units: snapshot.you.units },
          opponent: { id: snapshot.opponent.id, name: snapshot.opponent.displayName, units: snapshot.opponent.units },
        },
        { you: snapshot.you.units.map((unit) => unit.id), opponent: snapshot.opponent.units.map((unit) => unit.id) },
        { you: 0, opponent: 0 },
        this.roundSeed || 'seed-resync',
      );
    }
    updateRuntimeFromSnapshot(this.runtime, snapshot);
    this.previewState = null;
    this.previewRound = null;
    this.previewMode = 'none';
    this.previewTimeline = null;
    this.previewActor = null;
    this.previewLastTime = 0;
    this.state.youUnits = snapshot.you.units.map(toClientUnit);
    this.state.opponentUnits = snapshot.opponent.units.map(toClientUnit);
    this.state.graves = toClientGraves(this.runtime);
    this.state.round = snapshot.round;
    this.state.countdownMs = 0;
    this.state.status = 'waiting';
    this.state.activeYouId = this.getActiveUnitId('you');
    this.state.activeOpponentId = this.getActiveUnitId('opponent');
    this.emit();
  }

  private hasAllActions(): boolean {
    return PLAYER_ORDER.every((role) => Boolean(this.actions[role]));
  }

  private prepareLocalOutcome() {
    if (!this.runtime) return;
    this.state.status = 'resolving';
    const context = { map: this.runtime.map, unitsById: UNITS_BY_ID } as const;
    const outcome = simulateRound(context, {
      state: this.runtime,
      actions: {
        you: this.actions.you ?? null,
        opponent: this.actions.opponent ?? null,
      },
      actingOrder: this.getRoundOrder(),
      captureTimeline: true,
    });
    this.pendingOutcome = outcome;
    this.previewState = outcome.next;
    this.previewRound = outcome.next.round;
    this.previewMode = 'full';
    this.previewTimeline = outcome.frames;
    this.previewActor = 'both';
    this.previewLastTime = getLastFrameTime(outcome.frames);
    this.state.youUnits = outcome.next.teams.you.units.map(toClientRuntimeUnit);
    this.state.opponentUnits = outcome.next.teams.opponent.units.map(toClientRuntimeUnit);
    this.state.graves = toClientGraves(outcome.next);
    this.state.activeYouId = this.getActiveUnitId('you');
    this.state.activeOpponentId = this.getActiveUnitId('opponent');
    this.emit();
    if (outcome.frames.length > 0) {
      for (const listener of this.timelineListeners) {
        listener(outcome.frames);
      }
    }
  }

  private previewAction(role: PlayerRole, action: UnitAction) {
    if (!this.runtime) return;
    const context = { map: this.runtime.map, unitsById: UNITS_BY_ID } as const;
    const actions: Record<PlayerRole, UnitAction | null> = {
      you: this.actions.you ?? null,
      opponent: this.actions.opponent ?? null,
    };
    actions[role] = action;
    const fullOrder = this.getRoundOrder();
    const otherRole: PlayerRole = role === 'you' ? 'opponent' : 'you';
    const actingOrder = this.actions[otherRole] ? fullOrder : (fullOrder.filter((candidate) => candidate === role) as PlayerRole[]);
    const outcome = simulateRound(context, {
      state: this.runtime,
      actions,
      actingOrder,
      captureTimeline: true,
    });
    const preview = outcome.next;
    if (!this.actions[otherRole]) {
      preview.cursors[otherRole] = this.runtime.cursors[otherRole];
      preview.round = this.runtime.round + 1;
      preview.randomSeed = this.runtime.randomSeed;
    }
    this.previewState = preview;
    this.previewRound = preview.round;
    const bothActionsKnown = Boolean(this.actions.you && this.actions.opponent);
    this.previewMode = bothActionsKnown ? 'full' : 'partial';
    this.state.status = 'resolving';
    this.state.youUnits = preview.teams.you.units.map(toClientRuntimeUnit);
    this.state.opponentUnits = preview.teams.opponent.units.map(toClientRuntimeUnit);
    this.state.graves = toClientGraves(preview);
    this.state.activeYouId = this.getActiveUnitId('you');
    this.state.activeOpponentId = this.getActiveUnitId('opponent');
    this.emit();
    if (outcome.frames.length > 0) {
      for (const listener of this.timelineListeners) {
        listener(outcome.frames);
      }
    }
    this.previewTimeline = outcome.frames;
    this.previewActor = bothActionsKnown ? 'both' : role;
    this.previewLastTime = getLastFrameTime(outcome.frames);
  }

  private emit() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

function toClientUnit(unit: { id: string; type: string; hp: number; alive: boolean; position: { x: number; y: number } }): ClientUnitState {
  return {
    id: unit.id,
    type: unit.type,
    hp: unit.hp,
    position: { ...unit.position },
    alive: unit.alive,
    graveCount: 0,
  };
}

function toClientRuntimeUnit(unit: RuntimeUnit): ClientUnitState {
  return {
    id: unit.id,
    type: unit.type,
    hp: unit.hp,
    position: { ...unit.position },
    alive: unit.alive,
    graveCount: 0,
  };
}

function toClientGraves(runtime: MatchRuntimeState): ClientState['graves'] {
  return Array.from(runtime.graveTally.values()).map((grave) => ({
    position: { ...grave.position },
    count: grave.count,
  }));
}

function getLastFrameTime(frames: SimulationFrame[]): number {
  if (frames.length === 0) return 0;
  return frames[frames.length - 1].time;
}

function buildContinuationTimeline(
  previewFrames: SimulationFrame[],
  fallbackFrames: SimulationFrame[],
  actor: PlayerRole | 'both' | null,
): SimulationFrame[] {
  if (!fallbackFrames.length || !previewFrames.length) {
    return [];
  }
  if (actor !== 'you' && actor !== 'opponent') {
    return normalizeTimeline(fallbackFrames, fallbackFrames[0]?.time ?? 0);
  }
  const other: PlayerRole = actor === 'you' ? 'opponent' : 'you';
  const startIndex = fallbackFrames.findIndex((frame) => frame.phase === other);
  if (startIndex === -1) {
    return [];
  }
  const baseTime = fallbackFrames[startIndex].time;
  const normalized = fallbackFrames.slice(startIndex).map((frame) => ({
    phase: frame.phase,
    time: Number(Math.max(0, frame.time - baseTime).toFixed(4)),
    you: cloneFrameUnits(frame.you),
    opponent: cloneFrameUnits(frame.opponent),
  }));

  const lastPreview = previewFrames[previewFrames.length - 1];
  const frames: SimulationFrame[] = [
    {
      phase: lastPreview.phase,
      time: 0,
      you: cloneFrameUnits(lastPreview.you),
      opponent: cloneFrameUnits(lastPreview.opponent),
    },
  ];

  let lastTime = 0;
  const epsilon = 1 / 120;
  for (const frame of normalized) {
    const adjustedTime = Math.max(frame.time, lastTime + epsilon);
    frames.push({
      phase: frame.phase,
      time: Number(adjustedTime.toFixed(4)),
      you: frame.you,
      opponent: frame.opponent,
    });
    lastTime = adjustedTime;
  }

  return frames;
}

function normalizeTimeline(frames: SimulationFrame[], offset: number): SimulationFrame[] {
  if (!frames.length) return frames;
  const base = Number.isFinite(offset) ? offset : frames[0].time;
  if (!Number.isFinite(base)) return frames.map(cloneFrameWithTime);
  return frames.map((frame) => ({
    phase: frame.phase,
    time: Number(Math.max(0, frame.time - base).toFixed(4)),
    you: cloneFrameUnits(frame.you),
    opponent: cloneFrameUnits(frame.opponent),
  }));
}

function cloneFrameWithTime(frame: SimulationFrame): SimulationFrame {
  return {
    phase: frame.phase,
    time: Number(Math.max(0, frame.time).toFixed(4)),
    you: cloneFrameUnits(frame.you),
    opponent: cloneFrameUnits(frame.opponent),
  };
}

function cloneFrameUnits(units: SimulationFrameUnit[]): SimulationFrameUnit[] {
  return units.map((unit) => ({
    id: unit.id,
    type: unit.type,
    hp: unit.hp,
    alive: unit.alive,
    position: { ...unit.position },
  }));
}

function applyDiffToRuntime(runtime: MatchRuntimeState, diff: RoundDiff) {
  for (const position of diff.positions) {
    for (const role of PLAYER_ORDER) {
      const unit = runtime.teams[role].units.find((candidate) => candidate.id === position.unitId);
      if (unit) {
        unit.position = { ...position.position };
      }
    }
  }
  for (const change of diff.hpChanges) {
    for (const role of PLAYER_ORDER) {
      const unit = runtime.teams[role].units.find((candidate) => candidate.id === change.unitId);
      if (unit) {
        unit.hp += change.delta;
        if (unit.hp <= 0) {
          unit.alive = false;
        }
      }
    }
  }
  for (const death of diff.deaths) {
    for (const role of PLAYER_ORDER) {
      const unit = runtime.teams[role].units.find((candidate) => candidate.id === death.unitId);
      if (unit) {
        unit.alive = false;
        unit.position = { ...death.position };
      }
    }
  }
  if (diff.aoeExpires?.length) {
    const expired = new Set(diff.aoeExpires);
    runtime.aoeZones = runtime.aoeZones.filter((zone) => !expired.has(zone.id));
  }
  if (diff.aoeUpserts?.length) {
    const pending = new Map(diff.aoeUpserts.map((zone) => [zone.id, zone]));
    runtime.aoeZones = runtime.aoeZones.map((zone) => {
      const incoming = pending.get(zone.id);
      if (incoming) {
        zone.ttl = incoming.ttl;
        zone.position = { ...incoming.position };
        zone.radius = incoming.radius;
        zone.owner = incoming.owner;
        pending.delete(zone.id);
      }
      return zone;
    });
    for (const incoming of pending.values()) {
      const dot = inferZoneDot(runtime, incoming.owner);
      runtime.aoeZones.push({
        id: incoming.id,
        ttl: incoming.ttl,
        position: { ...incoming.position },
        radius: incoming.radius,
        owner: incoming.owner,
        dot,
      });
    }
  }
  if (diff.graves?.length) {
    runtime.graveTally = new Map(
      diff.graves.map((grave) => [
        `${grave.position.x.toFixed(2)}:${grave.position.y.toFixed(2)}`,
        { position: { ...grave.position }, count: grave.count },
      ]),
    );
  }
}

function updateRuntimeFromSnapshot(runtime: MatchRuntimeState, snapshot: MinimalSnapshot) {
  for (const role of PLAYER_ORDER) {
    const team = runtime.teams[role];
    const source = role === 'you' ? snapshot.you : snapshot.opponent;
    for (const unit of team.units) {
      const updated = source.units.find((candidate) => candidate.id === unit.id);
      if (updated) {
        unit.position = { ...updated.position };
        unit.hp = updated.hp;
        unit.alive = updated.alive;
      }
    }
  }
  const zones = Array.isArray((snapshot as { aoeZones?: unknown }).aoeZones)
    ? ((snapshot as { aoeZones: Array<{ id: string; ttl: number; position: { x: number; y: number }; radius: number; owner: PlayerRole; dot?: { dmg?: number; duration?: number; refresh?: boolean; stack?: boolean } }> }).aoeZones)
    : [];
  runtime.aoeZones = zones.map((zone) => ({
    id: zone.id,
    ttl: zone.ttl,
    position: { ...zone.position },
    radius: zone.radius,
    owner: zone.owner,
    dot: zone.dot ? { ...zone.dot } : inferZoneDot(runtime, zone.owner),
  }));
}

function inferZoneDot(runtime: MatchRuntimeState, owner: PlayerRole) {
  const team = runtime.teams[owner];
  for (const unit of team.units) {
    const spec = UNITS_BY_ID[unit.type]?.aoe;
    if (spec) {
      return {
        dmg: spec.dot.dmg,
        duration: spec.dot.durationRounds,
        refresh: spec.dot.refresh,
        stack: spec.dot.stack,
      };
    }
  }
  return undefined;
}
