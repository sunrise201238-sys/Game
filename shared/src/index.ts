export type TeamId = 0 | 1;

export interface Vector {
  x: number;
  y: number;
}

export interface DragAction {
  unitId: string;
  power: number;
  vector: Vector;
}

export type ClientToServerMessage =
  | { type: 'queue'; mapId: string }
  | { type: 'cancel-queue' }
  | { type: 'leave-match'; matchId: string }
  | { type: 'action'; matchId: string; team: TeamId; action: DragAction };

export type ServerToClientMessage =
  | { type: 'queued' }
  | { type: 'queue-cancelled' }
  | { type: 'match-found'; matchId: string; team: TeamId; mapId: string }
  | { type: 'action'; matchId: string; team: TeamId; action: DragAction }
  | { type: 'opponent-left'; matchId: string }
  | { type: 'error'; message: string };

export type OnlineStatus =
  | 'idle'
  | 'connecting'
  | 'queued'
  | 'matched'
  | 'opponent-left'
  | 'disconnected'
  | 'error';
