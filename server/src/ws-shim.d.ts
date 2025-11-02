declare module 'ws' {
  import { EventEmitter } from 'events';

  export interface WebSocket extends EventEmitter {
    readonly OPEN: number;
    readonly CLOSED: number;
    readonly CLOSING: number;
    readyState: number;
    send(data: string): void;
    close(): void;
    ping?(callback?: () => void): void;
    terminate?(): void;
    on(event: 'message', listener: (data: unknown) => void): this;
    on(event: 'close' | 'error', listener: () => void): this;
    on(event: 'pong', listener: () => void): this;
  }

  export class WebSocketServer<T = WebSocket> extends EventEmitter {
    constructor(options: { server: unknown; path?: string });
    on(event: 'connection', listener: (socket: WebSocket) => void): this;
  }

  export const OPEN: number;
}
