import type { ClientMessage, ServerMessage } from '@shared/messages';

type MessageHandler = (message: ServerMessage) => void;

type StatusHandler = (status: 'connecting' | 'open' | 'closed' | 'error') => void;

export class GameSocket {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly onMessage: MessageHandler;
  private readonly onStatus: StatusHandler;

  constructor(url: string, onMessage: MessageHandler, onStatus: StatusHandler) {
    this.url = url;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.connect();
  }

  private connect() {
    this.onStatus('connecting');
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('open', () => this.onStatus('open'));
    this.ws.addEventListener('close', () => {
      this.ws = null;
      this.onStatus('closed');
      setTimeout(() => this.connect(), 1000);
    });
    this.ws.addEventListener('error', () => this.onStatus('error'));
    this.ws.addEventListener('message', (event) => {
      try {
        const parsed: ServerMessage = JSON.parse(event.data);
        this.onMessage(parsed);
      } catch (error) {
        console.error('Failed to parse message', error);
      }
    });
  }

  send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }
}
