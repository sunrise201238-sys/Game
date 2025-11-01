declare module 'ws' {
  import { EventEmitter } from 'events';

  export interface WebSocket extends EventEmitter {
    readyState: number;
    send(data: string): void;
    close(): void;
    on(event: 'message', listener: (data: unknown) => void): this;
    on(event: 'close' | 'error', listener: () => void): this;
  }

  export class WebSocketServer<T = WebSocket> extends EventEmitter {
    constructor(options: { server: unknown; path?: string });
    on(event: 'connection', listener: (socket: WebSocket) => void): this;
  }

  export const OPEN: number;
}
