import { createHash, randomUUID } from 'node:crypto';

import type { WebSocket } from 'ws';

import {
  type PlayerRole,
  type ClientMessage,
  type ServerMessage,
  type MatchFoundMessage,
  type RoundStartMessage,
  type RevealOpenMessage,
  type ActionRevealMessage,
  type RoundResultMessage,
  type MatchEndMessage,
  type UnitAction,
  runtimeToSnapshot,
  simulateRound,
  createInitialRuntime,
  encodeRoundHashPayload,
  serializeCommitPayload,
  compareHashes,
  type RoundDiff,
  type MapSchema,
  type UnitSchema,
  type MatchSummary,
} from '@slingshot/shared';

import type { AnalyticsStore } from './analytics';
import type { MatchContext, PlayerContext } from './types';
import type { ServerConfig } from './config';

interface PlayerInit {
  id: string;
  displayName: string;
  socket: WebSocket | null;
  isBot: boolean;
}

interface MatchDependencies {
  config: ServerConfig;
  analytics: AnalyticsStore;
  secretSalt: string;
  units: UnitSchema[];
  unitsById: Record<string, UnitSchema>;
  onComplete: (match: MatchContext) => void;
}

const PLAYER_ORDER: PlayerRole[] = ['you', 'opponent'];

export class MatchController {
  readonly match: MatchContext;
  private readonly config: ServerConfig;
  private readonly analytics: AnalyticsStore;
  private readonly secretSalt: string;
  private readonly unitsById: Record<string, UnitSchema>;
  private readonly onComplete: (match: MatchContext) => void;

  private currentRound: number;
  private stage: 'idle' | 'planning' | 'reveal' | 'resolving' | 'ended' = 'idle';
  private planningTimer?: NodeJS.Timeout;
  private revealTimer?: NodeJS.Timeout;
  private botPlans = new Map<PlayerRole, { action: UnitAction; nonce: string }>();
  private commits: Partial<Record<PlayerRole, string>> = {};
  private reveals: Partial<Record<PlayerRole, { action: UnitAction; nonce: string }>> = {};
  private resultHashes: Partial<Record<PlayerRole, string>> = {};
  private needsAuthoritative = false;

  constructor(
    map: MapSchema,
    players: Record<PlayerRole, PlayerInit>,
    dependencies: MatchDependencies,
  ) {
    this.config = dependencies.config;
    this.analytics = dependencies.analytics;
    this.secretSalt = dependencies.secretSalt;
    this.unitsById = dependencies.unitsById;
    this.onComplete = dependencies.onComplete;

    this.match = initializeMatch(map, players, dependencies.units);
    this.currentRound = this.match.runtime.round + 1;

    this.analytics.recordMatchStart(map.id, {
      you: this.match.runtime.teams.you.units,
      opponent: this.match.runtime.teams.opponent.units,
    });

    this.sendMatchFound();
  }

  start(): void {
    if (this.stage !== 'idle') return;
    this.beginPlanningPhase();
  }

  handleMessage(role: PlayerRole, message: ClientMessage): void {
    switch (message.type) {
      case 'ACTION_COMMIT':
        if (message.payload.round === this.currentRound) {
          this.commits[role] = message.payload.hash;
        }
        break;
      case 'ACTION_REVEAL':
        this.handleReveal(role, message.payload.round, message.payload.action, message.payload.nonce);
        break;
      case 'CLIENT_RESULT_HASH':
        if (message.payload.round === this.currentRound) {
          this.resultHashes[role] = message.payload.hash;
        }
        break;
      default:
        break;
    }
  }

  handleDisconnect(role: PlayerRole): void {
    const player = this.match.players[role];
    player.socket = null;
    player.lastSeenAt = Date.now();
  }

  reconnect(role: PlayerRole, socket: WebSocket): void {
    const player = this.match.players[role];
    player.socket = socket;
    player.lastSeenAt = Date.now();
    this.send(role, {
      type: 'RESYNC_SNAPSHOT',
      payload: this.snapshotForRole(role),
    });
  }

  private beginPlanningPhase(): void {
    if (this.stage === 'ended') return;
    this.stage = 'planning';
    this.currentRound = this.match.runtime.round + 1;
    this.commits = {};
    this.reveals = {};
    this.resultHashes = {};
    this.needsAuthoritative = false;
    this.botPlans.clear();

    const planningDeadline = Date.now() + this.config.planningMs;
    const roundSeed = this.match.runtime.randomSeed;

    for (const role of PLAYER_ORDER) {
      const roundStart: RoundStartMessage = {
        type: 'ROUND_START',
        payload: {
          round: this.currentRound,
          deadlineTs: planningDeadline,
          randomSeed: roundSeed,
          snapshot: this.snapshotForRole(role),
        },
      };
      this.send(role, roundStart);
    }

    this.prepareBotPlans();

    this.clearTimer(this.planningTimer);
    this.planningTimer = setTimeout(() => {
      this.openRevealPhase();
    }, this.config.planningMs);
  }

  private openRevealPhase(): void {
    if (this.stage !== 'planning') return;
    this.stage = 'reveal';
    const reveal: RevealOpenMessage = {
      type: 'REVEAL_OPEN',
      payload: { round: this.currentRound },
    };
    this.broadcast(reveal);
    this.flushBotReveals();
    this.clearTimer(this.revealTimer);
    this.revealTimer = setTimeout(() => this.finalizeRound(), this.config.revealMs);
  }

  private handleReveal(role: PlayerRole, round: number, action: UnitAction, nonce: string): void {
    if (round !== this.currentRound || this.stage === 'ended') {
      return;
    }
    const commit = this.commits[role];
    const payloadHash = createHash('sha256')
      .update(serializeCommitPayload(action, nonce, this.secretSalt))
      .digest('hex');
    if (!commit || !compareHashes(commit, payloadHash)) {
      this.needsAuthoritative = true;
    }
    this.reveals[role] = { action, nonce };
    const echo: ActionRevealMessage = {
      type: 'ACTION_REVEAL',
      payload: { round, action, nonce },
    };
    this.broadcast(echo);
    if (this.stage === 'reveal' && PLAYER_ORDER.every((r) => this.reveals[r])) {
      this.finalizeRound();
    }
  }

  private finalizeRound(): void {
    if (this.stage === 'ended' || this.stage === 'resolving') return;
    this.stage = 'resolving';
    this.clearTimer(this.planningTimer);
    this.clearTimer(this.revealTimer);

    const actions: Record<PlayerRole, UnitAction | null> = {
      you: this.reveals.you?.action ?? this.generateFallbackAction('you'),
      opponent: this.reveals.opponent?.action ?? this.generateFallbackAction('opponent'),
    };

    const actingOrder = this.match.turnSequence;
    const roundSeed = this.match.runtime.randomSeed;
    const outcome = simulateRound(
      { map: this.match.map, unitsById: this.unitsById },
      {
        state: this.match.runtime,
        actions,
        actingOrder,
      },
    );

    this.analytics.recordRound();
    this.analytics.recordOutOfBounds(countOutOfBounds(outcome.diff, this.match.map));

    const authoritativePayload = encodeRoundHashPayload(outcome.diff, roundSeed);
    const serverHash = createHash('sha256').update(authoritativePayload).digest('hex');

    for (const role of PLAYER_ORDER) {
      const clientHash = this.resultHashes[role];
      if (!clientHash || clientHash !== serverHash) {
        this.needsAuthoritative = true;
      }
    }

    this.match.runtime = outcome.next;
    this.match.latestSummary = outcome.summary;

    for (const role of PLAYER_ORDER) {
      const opponentRole = role === 'you' ? 'opponent' : 'you';
      const resultMessage: RoundResultMessage = {
        type: 'ROUND_RESULT',
        payload: {
          round: outcome.next.round,
          diff: outcome.diff,
          nextCursorYou: outcome.next.cursors[role],
          nextCursorOpp: outcome.next.cursors[opponentRole],
          randomSeed: outcome.next.randomSeed,
        },
      };
      this.send(role, resultMessage);
    }

    if (outcome.summary) {
      this.finishMatch(outcome.summary);
      return;
    }

    if (this.needsAuthoritative) {
      console.warn(`Determinism mismatch detected for match ${this.match.id} round ${this.currentRound}`);
    }

    this.stage = 'idle';
    setTimeout(() => this.beginPlanningPhase(), 400);
  }

  private finishMatch(summary: MatchSummary): void {
    if (this.stage === 'ended') return;
    this.stage = 'ended';
    for (const role of PLAYER_ORDER) {
      const perspectiveWinner = summary.winner === 'draw'
        ? 'draw'
        : summary.winner === role
        ? 'you'
        : 'opponent';
      const message: MatchEndMessage = {
        type: 'MATCH_END',
        payload: { winner: perspectiveWinner, summary },
      };
      this.send(role, message);
    }
    this.analytics.recordMatchEnd(summary, this.match.firstMover, {
      you: this.match.runtime.teams.you.units,
      opponent: this.match.runtime.teams.opponent.units,
    });
    this.onComplete(this.match);
  }

  private prepareBotPlans(): void {
    for (const role of PLAYER_ORDER) {
      const player = this.match.players[role];
      if (!player.isBot) continue;
      const action = this.generateBotAction(role);
      const nonce = randomUUID();
      this.commits[role] = createHash('sha256')
        .update(serializeCommitPayload(action, nonce, this.secretSalt))
        .digest('hex');
      this.botPlans.set(role, { action, nonce });
    }
  }

  private flushBotReveals(): void {
    for (const [role, plan] of this.botPlans.entries()) {
      this.handleReveal(role, this.currentRound, plan.action, plan.nonce);
    }
    this.botPlans.clear();
  }

  private generateFallbackAction(role: PlayerRole): UnitAction | null {
    const nextUnit = getNextAvailableUnit(this.match.runtime, role);
    if (!nextUnit) return null;
    return { unitId: nextUnit.id, dragVec: { x: 0, y: 0 } };
  }

  private generateBotAction(role: PlayerRole): UnitAction {
    const unit = getNextAvailableUnit(this.match.runtime, role);
    if (!unit) {
      return { unitId: 'none', dragVec: { x: 0, y: 0 } };
    }
    const opponentCenter = averagePosition(this.match.runtime.teams[nextPlayer(role)].units);
    const dx = opponentCenter.x - unit.position.x;
    const dy = opponentCenter.y - unit.position.y;
    const magnitude = Math.min(Math.sqrt(dx * dx + dy * dy) / 4, 8);
    return {
      unitId: unit.id,
      dragVec: { x: clamp(dx, -magnitude, magnitude), y: clamp(dy, -magnitude, magnitude) },
    };
  }

  private send(role: PlayerRole, message: ServerMessage): void {
    const socket = this.match.players[role].socket;
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private sendMatchFound() {
    for (const role of PLAYER_ORDER) {
      const opponentRole = role === 'you' ? 'opponent' : 'you';
      const message: MatchFoundMessage = {
        type: 'MATCH_FOUND',
        payload: {
          matchId: this.match.id,
          you: this.snapshotForRole(role).you,
          opponent: this.snapshotForRole(role).opponent,
          firstMover: this.match.firstMover === role ? 'you' : 'opponent',
          mapId: this.match.map.id,
          turnOrderYou: this.match.runtime.turnOrder[role],
          turnOrderOpp: this.match.runtime.turnOrder[opponentRole],
          cursorYou: this.match.runtime.cursors[role],
          cursorOpp: this.match.runtime.cursors[opponentRole],
        },
      };
      this.send(role, message);
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const role of PLAYER_ORDER) {
      this.send(role, message);
    }
  }

  private clearTimer(timer?: NodeJS.Timeout) {
    if (timer) {
      clearTimeout(timer);
    }
  }

  private snapshotForRole(role: PlayerRole): MinimalSnapshot {
    const base = runtimeToSnapshot(this.match.runtime);
    const opponentRole = role === 'you' ? 'opponent' : 'you';
    const youSnapshot = role === 'you' ? base.you : base.opponent;
    const opponentSnapshot = opponentRole === 'you' ? base.you : base.opponent;
    return {
      round: base.round,
      mapId: base.mapId,
      aoeZones: base.aoeZones.map((zone) => ({ ...zone, position: { ...zone.position } })),
      you: {
        id: youSnapshot.id,
        displayName: youSnapshot.displayName,
        units: youSnapshot.units.map((unit) => ({ ...unit, position: { ...unit.position } })),
      },
      opponent: {
        id: opponentSnapshot.id,
        displayName: opponentSnapshot.displayName,
        units: opponentSnapshot.units.map((unit) => ({ ...unit, position: { ...unit.position } })),
      },
    };
  }
}

export function initializeMatch(
  map: MapSchema,
  players: Record<PlayerRole, PlayerInit>,
  unitSchemas: UnitSchema[],
): MatchContext {
  const spawn = pickSpawnTemplate(map);
  const youUnits = instantiateUnits('you', unitSchemas, spawn.slotsYou);
  const oppUnits = instantiateUnits('opponent', unitSchemas, spawn.slotsOpp);

  const turnOrderYou = buildTurnOrder(youUnits);
  const turnOrderOpp = buildTurnOrder(oppUnits);
  const firstMover: PlayerRole = Math.random() < 0.5 ? 'you' : 'opponent';

  const runtime = createInitialRuntime(
    map,
    {
      you: { id: players.you.id, name: players.you.displayName, units: youUnits },
      opponent: { id: players.opponent.id, name: players.opponent.displayName, units: oppUnits },
    },
    { you: turnOrderYou, opponent: turnOrderOpp },
    { you: 0, opponent: 0 },
    randomUUID(),
  );

  const match: MatchContext = {
    id: randomUUID(),
    map,
    runtime,
    players: {
      you: createPlayerContext(players.you, runtime.teams.you.units),
      opponent: createPlayerContext(players.opponent, runtime.teams.opponent.units),
    },
    firstMover,
    turnSequence: firstMover === 'you' ? ['you', 'opponent'] : ['opponent', 'you'],
    createdAt: Date.now(),
  };

  return match;
}

function createPlayerContext(init: PlayerInit, units: PlayerContext['units']): PlayerContext {
  return {
    id: init.id,
    displayName: init.displayName,
    socket: init.socket,
    units,
    isBot: init.isBot,
    lastSeenAt: Date.now(),
  };
}

function buildPlayerSnapshot(player: PlayerContext) {
  return {
    id: player.id,
    displayName: player.displayName,
    units: player.units.map((unit) => ({
      id: unit.id,
      type: unit.type,
      hp: unit.hp,
      position: { ...unit.position },
      alive: unit.alive,
    })),
  };
}

function instantiateUnits(role: PlayerRole, schemas: UnitSchema[], slots: Array<{ x: number; y: number }>) {
  return schemas.slice(0, slots.length).map((schema, index) => ({
    id: `${role}-${schema.id}-${index}`,
    type: schema.id,
    hp: schema.hp,
    position: { ...slots[index] },
    alive: true,
  }));
}

function buildTurnOrder(units: Array<{ id: string; position: { x: number; y: number } }>): string[] {
  return [...units]
    .sort((a, b) => {
      if (a.position.y !== b.position.y) return a.position.y - b.position.y;
      if (a.position.x !== b.position.x) return a.position.x - b.position.x;
      return a.id.localeCompare(b.id);
    })
    .map((unit) => unit.id);
}

function pickSpawnTemplate(map: MapSchema) {
  return map.spawnTemplates[0] ?? {
    id: 'default',
    slotsYou: [
      { x: map.bounds.w * 0.2, y: map.bounds.h * 0.3 },
      { x: map.bounds.w * 0.2, y: map.bounds.h * 0.5 },
      { x: map.bounds.w * 0.2, y: map.bounds.h * 0.7 },
    ],
    slotsOpp: [
      { x: map.bounds.w * 0.8, y: map.bounds.h * 0.3 },
      { x: map.bounds.w * 0.8, y: map.bounds.h * 0.5 },
      { x: map.bounds.w * 0.8, y: map.bounds.h * 0.7 },
    ],
  };
}

function getNextAvailableUnit(runtime: MatchContext['runtime'], role: PlayerRole) {
  const order = runtime.turnOrder[role];
  const cursor = Math.min(runtime.cursors[role], order.length - 1);
  for (let idx = cursor; idx < order.length; idx++) {
    const unitId = order[idx];
    const unit = runtime.teams[role].units.find((candidate) => candidate.id === unitId && candidate.alive);
    if (unit) return unit;
  }
  return null;
}

function nextPlayer(role: PlayerRole): PlayerRole {
  return role === 'you' ? 'opponent' : 'you';
}

function averagePosition(units: PlayerContext['units']) {
  const alive = units.filter((unit) => unit.alive);
  if (alive.length === 0) return { x: 0, y: 0 };
  const sum = alive.reduce(
    (acc, unit) => ({ x: acc.x + unit.position.x, y: acc.y + unit.position.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / alive.length, y: sum.y / alive.length };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function countOutOfBounds(diff: RoundDiff, map: MapSchema): number {
  return diff.deaths.filter((death) => isOutOfBounds(death.position, map)).length;
}

function isOutOfBounds(position: { x: number; y: number }, map: MapSchema): boolean {
  if (position.x < 0 || position.y < 0 || position.x > map.bounds.w || position.y > map.bounds.h) {
    return true;
  }
  return map.lakes.some((lake) => pointInPolygon(position, lake.polygon));
}

function pointInPolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 0.00001) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
