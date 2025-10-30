import type { SimulationFrame } from './simulation.js';
import type { MinimalSnapshot } from './types.js';

export type PlayerRole = 'you' | 'opponent';

export interface JoinQueueMessage {
  type: "JOIN_QUEUE";
  payload: {
    playerId: string;
  };
}

export interface MatchFoundMessage {
  type: "MATCH_FOUND";
  payload: {
    matchId: string;
    you: PlayerSnapshot;
    opponent: PlayerSnapshot;
    firstMover: PlayerRole;
    mapId: string;
    turnOrderYou: string[];
    turnOrderOpp: string[];
    cursorYou: number;
    cursorOpp: number;
  };
}

export interface RoundStartMessage {
  type: "ROUND_START";
  payload: {
    round: number;
    deadlineTs: number;
    randomSeed: string;
    snapshot: MinimalSnapshot;
  };
}

export interface ActionSubmitMessage {
  type: "ACTION_SUBMIT";
  payload: {
    round: number;
    action: UnitAction;
  };
}

export interface ActionBroadcastMessage {
  type: "ACTION_BROADCAST";
  payload: {
    round: number;
    actor: PlayerRole;
    action: UnitAction;
  };
}

export interface RoundResultMessage {
  type: "ROUND_RESULT";
  payload: {
    round: number;
    diff: RoundDiff;
    nextCursorYou: number;
    nextCursorOpp: number;
    randomSeed: string;
    timeline?: SimulationFrame[];
  };
}

export interface ResyncSnapshotMessage {
  type: "RESYNC_SNAPSHOT";
  payload: MinimalSnapshot;
}

export interface MatchEndMessage {
  type: "MATCH_END";
  payload: {
    winner: PlayerRole | "draw";
    summary: MatchSummary;
  };
}

export interface HeartbeatMessage {
  type: "HEARTBEAT";
  payload: {
    rtt: number;
  };
}

export interface ErrorMessage {
  type: "ERROR";
  payload: {
    code: string;
    msg: string;
  };
}

export type ServerMessage =
  | MatchFoundMessage
  | RoundStartMessage
  | ActionBroadcastMessage
  | RoundResultMessage
  | ResyncSnapshotMessage
  | MatchEndMessage
  | ErrorMessage;

export type ClientMessage =
  | JoinQueueMessage
  | ActionSubmitMessage
  | HeartbeatMessage;

export interface PlayerSnapshot {
  id: string;
  displayName: string;
  units: UnitState[];
}

export interface UnitState {
  id: string;
  type: string;
  hp: number;
  position: Vector2;
  alive: boolean;
}

export interface Vector2 {
  x: number;
  y: number;
}

export interface AoeZoneState {
  id: string;
  ttl: number;
  position: Vector2;
  radius: number;
  owner: PlayerRole;
}

export interface UnitAction {
  unitId: string;
  dragVec: Vector2;
  skill?: "projectile" | "aoe";
}

export interface RoundDiff {
  hpChanges: Array<{ unitId: string; delta: number }>;
  deaths: Array<{ unitId: string; position: Vector2 }>;
  graves: Array<{ unitId: string; position: Vector2; count: number }>;
  positions: Array<{ unitId: string; position: Vector2 }>;
  projectiles: ProjectileState[];
  aoeUpserts: AoeZoneState[];
  aoeExpires: string[];
}

export interface ProjectileState {
  id: string;
  owner: PlayerRole;
  position: Vector2;
  velocity: Vector2;
}

export interface MatchSummary {
  rounds: number;
  winner: PlayerRole | 'draw';
  youRemaining: number;
  oppRemaining: number;
}

export type { MapSchema } from './types.js';
