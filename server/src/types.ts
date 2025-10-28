import type { WebSocket } from 'ws';

import type {
  MapSchema,
  MatchSummary,
  MinimalSnapshot,
  PlayerRole,
  RoundDiff,
  UnitAction,
  UnitSchema,
} from '@slingshot/shared';
import type { MatchRuntimeState, RuntimeUnit, SimulationContext } from '@slingshot/shared';

export interface PlayerContext {
  id: string;
  displayName: string;
  socket: WebSocket | null;
  units: RuntimeUnit[];
  isBot: boolean;
  pendingAction?: { action: UnitAction; nonce: string };
  lastSeenAt: number;
}

export interface MatchContext {
  id: string;
  map: MapSchema;
  runtime: MatchRuntimeState;
  players: Record<PlayerRole, PlayerContext>;
  firstMover: PlayerRole;
  turnSequence: PlayerRole[];
  createdAt: number;
  latestSummary?: MatchSummary;
}

export interface GameResources {
  maps: MapSchema[];
  units: UnitSchema[];
  unitsById: Record<string, UnitSchema>;
}

export interface SimulationDeps {
  context: SimulationContext;
}

export interface SnapshotProvider {
  snapshot: MinimalSnapshot;
}

export interface RoundResolution {
  diff: RoundDiff;
  summary?: MatchSummary;
}
