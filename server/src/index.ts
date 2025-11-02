import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { ClientToServerMessage, ServerToClientMessage, TeamId } from '@slingshot/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

const distDir = path.resolve(__dirname, '../../client/dist');
app.use(express.static(distDir));

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

const server = createServer(app);

type ClientStatus = 'idle' | 'queued' | 'matched';

interface ClientSession {
  id: string;
  socket: WebSocket;
  status: ClientStatus;
  mapId: string;
  matchId?: string;
  team?: TeamId;
}

interface MatchSession {
  id: string;
  mapId: string;
  clients: ClientSession[];
}

const waitingQueue: ClientSession[] = [];
const matches = new Map<string, MatchSession>();

const send = (client: ClientSession, message: ServerToClientMessage) => {
  if (client.socket.readyState !== client.socket.OPEN) return;
  client.socket.send(JSON.stringify(message));
};

const removeFromQueue = (client: ClientSession) => {
  const index = waitingQueue.indexOf(client);
  if (index >= 0) {
    waitingQueue.splice(index, 1);
  }
  if (client.status === 'queued') {
    client.status = 'idle';
  }
};

const notifyOpponentLeft = (match: MatchSession, departing: ClientSession) => {
  for (const participant of match.clients) {
    if (participant === departing) continue;
    participant.status = 'idle';
    participant.matchId = undefined;
    participant.team = undefined;
    send(participant, { type: 'opponent-left', matchId: match.id });
  }
};

const leaveMatch = (client: ClientSession, notifyOpponent = true) => {
  if (!client.matchId) {
    client.status = 'idle';
    return;
  }
  const match = matches.get(client.matchId);
  matches.delete(client.matchId);
  client.matchId = undefined;
  client.team = undefined;
  client.status = 'idle';
  if (match && notifyOpponent) {
    notifyOpponentLeft(match, client);
  }
};

const cleanupQueue = () => {
  for (let index = waitingQueue.length - 1; index >= 0; index -= 1) {
    if (waitingQueue[index].socket.readyState !== waitingQueue[index].socket.OPEN) {
      waitingQueue.splice(index, 1);
    }
  }
};

const tryMatchPlayers = () => {
  cleanupQueue();
  while (waitingQueue.length >= 2) {
    const first = waitingQueue.shift();
    const second = waitingQueue.shift();
    if (!first || !second) {
      break;
    }
    const mapId = first.mapId || 'training-grounds';
    const matchId = randomUUID();
    const match: MatchSession = {
      id: matchId,
      mapId,
      clients: [first, second],
    };
    matches.set(matchId, match);

    first.status = 'matched';
    first.matchId = matchId;
    first.team = 0;
    second.status = 'matched';
    second.matchId = matchId;
    second.team = 1;
    second.mapId = mapId;

    send(first, { type: 'match-found', matchId, team: 0, mapId });
    send(second, { type: 'match-found', matchId, team: 1, mapId });
  }
};

interface HeartbeatWebSocket extends WebSocket {
  isAlive?: boolean;
}

const HEARTBEAT_INTERVAL = 30_000;

const wss = new WebSocketServer({ server, path: '/match' });

const getClients = () => (wss as unknown as { clients: Set<WebSocket> }).clients;

const heartbeatTimer = setInterval(() => {
  for (const rawSocket of getClients()) {
    const socket = rawSocket as HeartbeatWebSocket;
    if (socket.readyState === socket.CLOSED || socket.readyState === socket.CLOSING) {
      continue;
    }
    if (socket.isAlive === false) {
      (socket as HeartbeatWebSocket & { terminate?: () => void }).terminate?.();
      continue;
    }
    socket.isAlive = false;
    try {
      (socket as HeartbeatWebSocket & { ping?: () => void }).ping?.();
    } catch {
      (socket as HeartbeatWebSocket & { terminate?: () => void }).terminate?.();
    }
  }
}, HEARTBEAT_INTERVAL);

(wss as unknown as { on(event: 'close', listener: () => void): void }).on('close', () => {
  clearInterval(heartbeatTimer);
});

wss.on('connection', (socket) => {
  const client: ClientSession = {
    id: randomUUID(),
    socket,
    status: 'idle',
    mapId: 'training-grounds',
  };

  (socket as HeartbeatWebSocket).isAlive = true;

  (socket as unknown as { on(event: 'pong', listener: () => void): void }).on('pong', () => {
    (socket as HeartbeatWebSocket).isAlive = true;
  });

  socket.on('message', (data) => {
    let parsed: ClientToServerMessage;
    try {
      parsed = JSON.parse(data.toString()) as ClientToServerMessage;
    } catch (error) {
      send(client, { type: 'error', message: 'Invalid message format' });
      return;
    }

    switch (parsed.type) {
      case 'queue': {
        leaveMatch(client);
        removeFromQueue(client);
        client.mapId = parsed.mapId;
        client.status = 'queued';
        waitingQueue.push(client);
        send(client, { type: 'queued' });
        tryMatchPlayers();
        break;
      }
      case 'cancel-queue': {
        removeFromQueue(client);
        send(client, { type: 'queue-cancelled' });
        break;
      }
      case 'leave-match': {
        if (!client.matchId || client.matchId !== parsed.matchId) {
          send(client, { type: 'queue-cancelled' });
          break;
        }
        leaveMatch(client);
        send(client, { type: 'queue-cancelled' });
        break;
      }
      case 'action': {
        if (!client.matchId || client.matchId !== parsed.matchId) {
          break;
        }
        if (client.team !== parsed.team) {
          break;
        }
        const match = matches.get(parsed.matchId);
        if (!match) {
          break;
        }
        const message: ServerToClientMessage = {
          type: 'action',
          matchId: match.id,
          team: parsed.team,
          action: parsed.action,
        };
        for (const participant of match.clients) {
          send(participant, message);
        }
        break;
      }
      default:
        send(client, { type: 'error', message: 'Unknown message type' });
    }
  });

  socket.on('close', () => {
    removeFromQueue(client);
    leaveMatch(client);
  });

  socket.on('error', () => {
    removeFromQueue(client);
    leaveMatch(client);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
