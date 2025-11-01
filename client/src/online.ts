import type {
  ClientToServerMessage,
  DragAction,
  OnlineStatus,
  ServerToClientMessage,
  TeamId,
} from '@slingshot/shared';

interface MatchInfo {
  matchId: string;
  team: TeamId;
  mapId: string;
}

interface OnlineMatchEvents {
  onStatusChange(status: OnlineStatus, message?: string): void;
  onMatchFound(info: MatchInfo): void;
  onActionReceived(action: DragAction, team: TeamId): void;
  onOpponentLeft(): void;
}

const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 10_000;

export class OnlineMatchClient {
  private socket: WebSocket | null = null;

  private status: OnlineStatus = 'idle';

  private readonly events: OnlineMatchEvents;

  private matchId: string | null = null;

  private messageQueue: ClientToServerMessage[] = [];

  private manualClose = false;

  private reconnectTimer: number | null = null;

  private reconnectDelay = RECONNECT_BASE_DELAY;

  private shouldAutoQueue = false;

  private desiredQueueMapId: string | null = null;

  private pendingReconnectQueue = false;

  constructor(events: OnlineMatchEvents) {
    this.events = events;
  }

  get currentStatus(): OnlineStatus {
    return this.status;
  }

  get currentMatchId(): string | null {
    return this.matchId;
  }

  private setStatus(status: OnlineStatus, message?: string) {
    this.status = status;
    this.events.onStatusChange(status, message);
  }

  private buildSocketUrl(): string {
    const configured = import.meta.env.VITE_MATCHMAKER_URL?.trim();
    const normalize = (raw: string): string => {
      let target: URL;
      try {
        target = new URL(raw);
      } catch {
        target = new URL(raw, window.location.origin);
      }
      if (target.protocol === 'http:') {
        target.protocol = 'ws:';
      } else if (target.protocol === 'https:') {
        target.protocol = 'wss:';
      }
      const basePath = target.pathname.replace(/\/+$/, '');
      target.pathname = `${basePath}/match`;
      return target.toString();
    };

    if (configured) {
      return normalize(configured);
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname || 'localhost';
    const port = import.meta.env.DEV
      ? import.meta.env.VITE_MATCHMAKER_PORT ?? '3001'
      : window.location.port;
    const url = new URL(`${protocol}//${hostname}${port ? `:${port}` : ''}`);
    url.pathname = '/match';
    return url.toString();
  }

  private ensureSocket(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.manualClose = false;
    const socketUrl = this.buildSocketUrl();
    this.socket = new WebSocket(socketUrl);
    this.setStatus('connecting');

    this.socket.addEventListener('open', () => {
      this.clearReconnectTimer();
      this.resetReconnectBackoff();
      this.flushQueue();
      const shouldRequeue = this.pendingReconnectQueue && this.shouldAutoQueue && this.desiredQueueMapId !== null;
      this.pendingReconnectQueue = false;
      if (shouldRequeue && this.desiredQueueMapId) {
        this.send({ type: 'queue', mapId: this.desiredQueueMapId });
      }
      if (this.status === 'connecting') {
        this.setStatus('idle');
      }
    });

    this.socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data) as ServerToClientMessage;
        this.handleMessage(payload);
      } catch (error) {
        console.error('Failed to parse server message', error);
      }
    });

    this.socket.addEventListener('close', () => {
      this.socket = null;
      this.matchId = null;
      this.clearReconnectTimer();
      if (this.manualClose) {
        this.setStatus('idle');
        return;
      }
      if (this.shouldAutoQueue && this.desiredQueueMapId) {
        this.pendingReconnectQueue = true;
      }
      if (this.status !== 'disconnected' && this.status !== 'error') {
        this.setStatus('disconnected');
      }
      this.scheduleReconnect();
    });

    this.socket.addEventListener('error', () => {
      if (this.status !== 'error') {
        this.setStatus('error', 'Connection error');
      }
      if (this.shouldAutoQueue && this.desiredQueueMapId) {
        this.pendingReconnectQueue = true;
      }
      this.scheduleReconnect();
    });
  }

  private flushQueue(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    for (const message of this.messageQueue) {
      this.socket.send(JSON.stringify(message));
    }
    this.messageQueue = [];
  }

  private send(message: ClientToServerMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }

  private scheduleReconnect(): void {
    if (this.manualClose) return;
    if (this.reconnectTimer !== null) {
      return;
    }
    const delay = this.reconnectDelay;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureSocket();
    }, delay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_DELAY);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private resetReconnectBackoff(): void {
    this.reconnectDelay = RECONNECT_BASE_DELAY;
  }

  private handleMessage(message: ServerToClientMessage): void {
    switch (message.type) {
      case 'queued':
        this.setStatus('queued');
        break;
      case 'queue-cancelled':
        this.shouldAutoQueue = false;
        this.desiredQueueMapId = null;
        this.pendingReconnectQueue = false;
        this.setStatus('idle');
        break;
      case 'match-found':
        this.matchId = message.matchId;
        this.setStatus('matched');
        this.shouldAutoQueue = false;
        this.pendingReconnectQueue = false;
        this.desiredQueueMapId = null;
        this.events.onMatchFound({
          matchId: message.matchId,
          team: message.team,
          mapId: message.mapId,
        });
        break;
      case 'action':
        if (!this.matchId || this.matchId !== message.matchId) {
          return;
        }
        this.events.onActionReceived(message.action, message.team);
        break;
      case 'opponent-left':
        if (!this.matchId || this.matchId !== message.matchId) {
          return;
        }
        this.setStatus('opponent-left');
        this.shouldAutoQueue = false;
        this.pendingReconnectQueue = false;
        this.desiredQueueMapId = null;
        this.events.onOpponentLeft();
        break;
      case 'error':
        this.setStatus('error', message.message);
        break;
      default:
        break;
    }
  }

  queueForMatch(mapId: string): void {
    this.ensureSocket();
    if (!this.socket) {
      return;
    }
    this.shouldAutoQueue = true;
    this.desiredQueueMapId = mapId;
    this.pendingReconnectQueue = false;
    if (this.matchId) {
      this.send({ type: 'leave-match', matchId: this.matchId });
      this.matchId = null;
    }
    this.send({ type: 'queue', mapId });
  }

  cancelQueue(): void {
    if (!this.socket) return;
    this.shouldAutoQueue = false;
    this.desiredQueueMapId = null;
    this.pendingReconnectQueue = false;
    this.send({ type: 'cancel-queue' });
  }

  leaveMatch(): void {
    if (!this.matchId) return;
    this.shouldAutoQueue = false;
    this.pendingReconnectQueue = false;
    this.desiredQueueMapId = null;
    this.send({ type: 'leave-match', matchId: this.matchId });
    this.matchId = null;
  }

  submitAction(action: DragAction, team: TeamId): void {
    if (!this.matchId) return;
    this.send({ type: 'action', matchId: this.matchId, team, action });
  }

  disconnect(): void {
    if (!this.socket) return;
    this.manualClose = true;
    this.shouldAutoQueue = false;
    this.desiredQueueMapId = null;
    this.pendingReconnectQueue = false;
    this.clearReconnectTimer();
    this.resetReconnectBackoff();
    try {
      this.socket.close();
    } catch (error) {
      console.error('Failed to close WebSocket', error);
    }
    this.socket = null;
    this.matchId = null;
    this.messageQueue = [];
  }
}
