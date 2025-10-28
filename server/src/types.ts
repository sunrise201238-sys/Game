import type {
  MinimalSnapshot,
  PlayerRole,
  UnitAction,
  UnitState,
  RoundDiff,
  MapSchema,
  UnitSchema,
} from '@slingshot/shared';

export interface MatchContext {
  id: string;
  map: MapSchema;
  players: Record<PlayerRole, PlayerContext>;
  round: number;
  firstMover: PlayerRole;
  randomSeed: string;
  turnOrder: Record<PlayerRole, string[]>;
  cursors: Record<PlayerRole, number>;
  lastHashes: Record<PlayerRole, string | null>;
}

export interface PlayerContext {
  id: string;
  socketId: string;
  displayName: string;
  units: UnitState[];
  queueCommit?: string;
  pendingAction?: UnitAction & { nonce: string };
}

export interface GameResources {
  maps: MapSchema[];
  units: UnitSchema[];
}

export interface MatchmakingTicket {
  playerId: string;
  socketId: string;
  requestedMode: 'pvp' | 'pve';
}

export interface SimulationResult {
  diff: RoundDiff;
  nextCursors: Record<PlayerRole, number>;
  randomSeed: string;
}

export interface SimulationEngine {
  simulate: (
    match: MatchContext,
    actions: Record<PlayerRole, UnitAction | null>,
  ) => SimulationResult;
}

export interface SnapshotProvider {
  snapshot: MinimalSnapshot;
}
