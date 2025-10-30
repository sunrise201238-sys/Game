import {
  type ServerMessage,
  type MatchFoundMessage,
  type RoundStartMessage,
  type RoundResultMessage,
  type ActionRevealMessage,
  type MatchEndMessage,
  type MinimalSnapshot,
  type PlayerRole,
  type UnitAction,
  type RoundDiff,
  createInitialRuntime,
  simulateRound,
  encodeRoundHashPayload,
  type MatchRuntimeState,
  type RuntimeUnit,
  type SimulationFrame,
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

export type HashListener = (payload: { round: number; hash: string }) => void;
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
  private hashListeners: HashListener[] = [];
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

  onHash(listener: HashListener) {
    this.hashListeners.push(listener);
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
      case 'ACTION_REVEAL':
        this.handleActionReveal(message);
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

  private handleActionReveal(message: ActionRevealMessage) {
    if (!this.runtime) return;
    const role = this.runtime.teams.you.units.some((unit) => unit.id === message.payload.action.unitId)
      ? 'you'
      : 'opponent';
    this.actions[role] = message.payload.action;
    if (this.hasAllActions() && !this.pendingOutcome) {
      this.computeLocalHash();
    }
  }

  private handleRoundResult(message: RoundResultMessage) {
    if (!this.runtime) return;
    const pending = this.pendingOutcome;
    const hadLocalTimeline = Boolean(pending?.frames?.length);
    const hadFullPreview = this.previewMode === 'full' && this.previewRound === message.payload.round;
    const hadPartialPreview = this.previewMode === 'partial' && this.previewRound === message.payload.round;
    const previousPreviewActor = this.previewActor;
    const previousPreviewCutoff = this.previewLastTime;
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
    this.state.graves = extractGraves(message.payload.diff);
    this.actions = {};
    this.pendingOutcome = null;
    this.state.activeYouId = this.getActiveUnitId('you');
    this.state.activeOpponentId = this.getActiveUnitId('opponent');
    this.emit();

    let fallbackTimeline = message.payload.timeline ?? [];
    if (hadLocalTimeline || hadFullPreview) {
      fallbackTimeline = [];
    } else if (hadPartialPreview && fallbackTimeline.length > 0 && this.runtime) {
      fallbackTimeline = filterTimelineAfterPreview(
        fallbackTimeline,
        previousPreviewActor,
        previousPreviewCutoff,
        this.runtime,
      );
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
    } else {
      updateRuntimeFromSnapshot(this.runtime, snapshot);
    }
    this.previewState = null;
    this.previewRound = null;
    this.previewMode = 'none';
    this.previewTimeline = null;
    this.previewActor = null;
    this.previewLastTime = 0;
    this.state.youUnits = snapshot.you.units.map(toClientUnit);
    this.state.opponentUnits = snapshot.opponent.units.map(toClientUnit);
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

  private async computeLocalHash() {
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
    this.state.activeYouId = this.getActiveUnitId('you');
    this.state.activeOpponentId = this.getActiveUnitId('opponent');
    this.emit();
    const payload = encodeRoundHashPayload(outcome.diff, this.roundSeed);
    const hash = await sha256(payload);
    for (const listener of this.hashListeners) {
      listener({ round: outcome.next.round, hash });
    }
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
    if (bothActionsKnown) {
      this.state.youUnits = preview.teams.you.units.map(toClientRuntimeUnit);
      this.state.opponentUnits = preview.teams.opponent.units.map(toClientRuntimeUnit);
      this.state.graves = extractGraves(outcome.diff);
    }
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

function extractGraves(diff: RoundDiff) {
  return diff.graves.map((grave) => ({ position: { ...grave.position }, count: grave.count }));
}

function getLastFrameTime(frames: SimulationFrame[]): number {
  if (frames.length === 0) return 0;
  return frames[frames.length - 1].time;
}

async function sha256(value: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function filterTimelineAfterPreview(
  frames: SimulationFrame[],
  actor: PlayerRole | 'both' | null,
  cutoffTime: number,
  runtime: MatchRuntimeState,
): SimulationFrame[] {
  if (!frames.length) {
    return frames;
  }
  const normalizedCutoff = Number.isFinite(cutoffTime) ? cutoffTime : 0;
  if (!actor || actor === 'both') {
    return normalizeTimeline(frames, frames[0]?.time ?? 0);
  }
  const epsilon = 1 / 240;
  const filtered = frames.filter((frame) => {
    if (frame.time <= normalizedCutoff + epsilon && (frame.phase === actor || frame.phase === 'setup')) {
      return false;
    }
    return frame.time >= normalizedCutoff - epsilon;
  });
  if (filtered.length === 0) {
    return [];
  }
  return filtered.map((frame, index) => ({
    ...frame,
    time: index === 0 ? 0 : Number(Math.max(0, frame.time - normalizedCutoff).toFixed(4)),
  }));
}

function normalizeTimeline(frames: SimulationFrame[], offset: number): SimulationFrame[] {
  if (!frames.length) return frames;
  const base = Number.isFinite(offset) ? offset : frames[0].time;
  if (!base) return frames;
  return frames.map((frame) => ({
    ...frame,
    time: Number(Math.max(0, frame.time - base).toFixed(4)),
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
}
