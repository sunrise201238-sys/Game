import { randomUUID, createHash } from 'node:crypto';

import {
  type ClientMessage,
  type PlayerRole,
  type UnitAction,
  type ServerMessage,
  type RoundResultMessage,
  type UnitState,
} from '@slingshot/shared';
import { compareHashes, serializeCommitPayload } from '@slingshot/shared';

import type { AnalyticsStore } from './analytics.js';
import type { MatchContext, PlayerContext, SimulationEngine } from './types.js';

type RoundResolvedHandler = (match: MatchContext) => void;

interface ActionEnvelope {
  action: UnitAction;
  nonce: string;
}

const PLAYER_ORDER: PlayerRole[] = ['you', 'opponent'];

export class MatchController {
  private readonly match: MatchContext;
  private readonly analytics: AnalyticsStore;
  private readonly broadcast: (msg: ServerMessage) => void;
  private readonly simulation: SimulationEngine;
  private pendingActions: Partial<Record<PlayerRole, ActionEnvelope>> = {};
  private readonly onRoundResolved: RoundResolvedHandler;
  private readonly secretSalt: string;

  constructor(
    match: MatchContext,
    simulation: SimulationEngine,
    analytics: AnalyticsStore,
    broadcaster: (msg: ServerMessage) => void,
    onRoundResolved: RoundResolvedHandler,
    secretSalt: string,
  ) {
    this.match = match;
    this.simulation = simulation;
    this.analytics = analytics;
    this.broadcast = broadcaster;
    this.onRoundResolved = onRoundResolved;
    this.secretSalt = secretSalt;
  }

  handleMessage(role: PlayerRole, message: ClientMessage): void {
    switch (message.type) {
      case 'ACTION_COMMIT':
        this.match.lastHashes[role] = message.payload.hash;
        break;
      case 'ACTION_REVEAL':
        this.pendingActions[role] = {
          action: message.payload.action,
          nonce: message.payload.nonce,
        };
        this.resolveRoundIfReady();
        break;
      case 'CLIENT_RESULT_HASH':
        // For now we just store the hash and let deterministic validation happen during resolution
        break;
      default:
        break;
    }
  }

  private resolveRoundIfReady(): void {
    if (!PLAYER_ORDER.every((role) => this.pendingActions[role])) {
      return;
    }

    const actions: Record<PlayerRole, UnitAction> = {
      you: this.pendingActions.you!.action,
      opponent: this.pendingActions.opponent!.action,
    };

    const calculatedHashes: Record<PlayerRole, string> = {
      you: createHash('sha256')
        .update(serializeCommitPayload(actions.you, this.pendingActions.you!.nonce, this.secretSalt))
        .digest('hex'),
      opponent: createHash('sha256')
        .update(serializeCommitPayload(actions.opponent, this.pendingActions.opponent!.nonce, this.secretSalt))
        .digest('hex'),
    };

    PLAYER_ORDER.forEach((role) => {
      const commit = this.match.lastHashes[role];
      if (!commit) return;
      if (!compareHashes(commit, calculatedHashes[role])) {
        // TODO: trigger authoritative fallback; for skeleton log mismatch
        // No-op for now
      }
    });

    const result = this.simulation.simulate(this.match, actions);
    this.analytics.increment('totalRounds');
    this.match.round += 1;
    this.match.randomSeed = result.randomSeed;
    this.match.cursors = result.nextCursors;

    const message: RoundResultMessage = {
      type: 'ROUND_RESULT',
      payload: {
        round: this.match.round,
        diff: result.diff,
        nextCursorYou: result.nextCursors.you,
        nextCursorOpp: result.nextCursors.opponent,
        randomSeed: result.randomSeed,
      },
    };

    this.broadcast(message);
    this.pendingActions = {};
    this.onRoundResolved(this.match);
  }

  getUnits(role: PlayerRole): UnitState[] {
    return this.match.players[role].units;
  }
}

export function createMatchContext(
  mapId: string,
  players: Record<PlayerRole, PlayerContext>,
): MatchContext {
  return {
    id: randomUUID(),
    map: {
      id: mapId,
      nameKey: 'map.grassy-field',
      bounds: { w: 30, h: 20 },
      lakes: [],
      walls: [],
      spawnTemplates: [],
      ruleFlags: { maxRounds: 30 },
    },
    players,
    round: 0,
    firstMover: 'you',
    randomSeed: randomUUID(),
    turnOrder: {
      you: players.you.units.map((unit) => unit.id),
      opponent: players.opponent.units.map((unit) => unit.id),
    },
    cursors: { you: 0, opponent: 0 },
    lastHashes: { you: null, opponent: null },
  };
}
