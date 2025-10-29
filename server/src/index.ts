import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';

import { loadConfig } from './config.js';
import { createAnalyticsStore } from './analytics.js';
import { loadResources } from './resources.js';
import { MatchController } from './match.js';
import type { ClientMessage, PlayerRole } from '@slingshot/shared';
import type { MatchContext } from './types';

const BOT_WAIT_MS = 4000;

interface ConnectionState {
  socket: WebSocket;
  playerId: string | null;
  displayName: string;
  wantsBot: boolean;
  match?: {
    controller: MatchController;
    role: PlayerRole;
  };
  botTimer?: NodeJS.Timeout;
}

interface QueueTicket {
  playerId: string;
  displayName: string;
  socket: WebSocket;
  wantsBot: boolean;
  connection: ConnectionState;
}

const config = loadConfig();
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(moduleDir, '../../client/dist');
const clientIndexPath = path.join(clientDistDir, 'index.html');
const hasClientBundle = existsSync(clientIndexPath);

const analytics = createAnalyticsStore(config.analyticsMode);
const resourcesPromise = loadResources();

const waitingQueue: QueueTicket[] = [];
const matches = new Map<string, MatchController>();
const playerToMatch = new Map<string, { controller: MatchController; role: PlayerRole }>();

if (hasClientBundle) {
  app.use(express.static(clientDistDir));
  app.get('/', (_req, res) => {
    res.sendFile(clientIndexPath);
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send('Slingshot game server is running. Connect via WebSocket at /ws.');
  });
}

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get('/admin/metrics', (_req, res) => {
  if (config.analyticsMode !== 'minimal') {
    return res.status(404).json({ error: 'analytics disabled' });
  }
  res.json(analytics.snapshot);
});

wss.on('connection', (socket, request) => {
  const origin = request.headers.origin;
  const host = request.headers.host;

  if (!isOriginPermitted(origin, host, config.allowOrigins)) {
    socket.close(1008, 'origin not allowed');
    return;
  }

  const url = new URL(request.url ?? '/', 'http://localhost');
  const wantsBot = url.searchParams.get('mode') === 'pve';
  const displayName = url.searchParams.get('name') ?? 'Player';

  const state: ConnectionState = {
    socket,
    playerId: null,
    displayName,
    wantsBot,
  };


  socket.on('message', async (raw) => {
    const message = parseClientMessage(raw.toString());
    if (!message) return;
    let resources: Awaited<ReturnType<typeof loadResources>>;
    try {
      resources = await resourcesPromise;
    } catch (error) {
      console.error('Failed to load game resources', error);
      socket.close(1011, 'server error');
      return;
    }
    if (message.type === 'JOIN_QUEUE') {
      handleJoinQueue(state, message.payload.playerId, resources);
      return;
    }
    if (!state.match) return;
    state.match.controller.handleMessage(state.match.role, message);
  });

  socket.on('close', () => {
    if (state.match) {
      state.match.controller.handleDisconnect(state.match.role);
    }
    removeFromQueue(state);
  });
});

server.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});

function handleJoinQueue(state: ConnectionState, playerId: string, resources: Awaited<ReturnType<typeof loadResources>>) {
  state.playerId = playerId;

  const existing = playerToMatch.get(playerId);
  if (existing) {
    existing.controller.reconnect(existing.role, state.socket);
    state.match = existing;
    return;
  }

  const ticket: QueueTicket = {
    playerId,
    displayName: state.displayName,
    socket: state.socket,
    wantsBot: state.wantsBot,
    connection: state,
  };

  enqueueTicket(ticket, resources);
}

function isOriginPermitted(origin: string | undefined, host: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin || allowedOrigins.length === 0) {
    return true;
  }

  const normalized = new Set<string>();

  for (const entry of allowedOrigins) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed === '*') {
      return true;
    }
    try {
      const parsed = new URL(trimmed);
      normalized.add(parsed.origin.toLowerCase());
    } catch {
      const withoutTrailingSlash = trimmed.replace(/\/+$/, '').toLowerCase();
      if (withoutTrailingSlash) {
        normalized.add(`https://${withoutTrailingSlash}`);
        normalized.add(`http://${withoutTrailingSlash}`);
      }
    }
  }

  if (host) {
    const lowerHost = host.toLowerCase();
    normalized.add(`https://${lowerHost}`);
    normalized.add(`http://${lowerHost}`);
  }

  try {
    const parsedOrigin = new URL(origin);
    return normalized.has(parsedOrigin.origin.toLowerCase());
  } catch {
    return normalized.has(origin.toLowerCase());
  }
}

function enqueueTicket(ticket: QueueTicket, resources: Awaited<ReturnType<typeof loadResources>>) {
  if (waitingQueue.length > 0) {
    const opponent = waitingQueue.shift();
    if (opponent?.connection.botTimer) {
      clearTimeout(opponent.connection.botTimer);
      opponent.connection.botTimer = undefined;
    }
    if (opponent) {
      createMatch(resources, opponent, ticket);
      return;
    }
  }

  if (ticket.wantsBot) {
    createBotMatch(resources, ticket);
    return;
  }

  waitingQueue.push(ticket);
  ticket.connection.botTimer = setTimeout(() => {
    removeFromQueue(ticket.connection);
    if (!ticket.connection.match) {
      createBotMatch(resources, ticket);
    }
  }, BOT_WAIT_MS);
}

function removeFromQueue(state: ConnectionState) {
  const index = waitingQueue.findIndex((entry) => entry.connection === state);
  if (index >= 0) {
    waitingQueue.splice(index, 1);
  }
  if (state.botTimer) {
    clearTimeout(state.botTimer);
    state.botTimer = undefined;
  }
}

function createMatch(
  resources: Awaited<ReturnType<typeof loadResources>>,
  ticketA: QueueTicket,
  ticketB: QueueTicket,
) {
  const map = resources.maps[0];
  const { players, connections } = assignRoles(ticketA, ticketB);
  const controller = new MatchController(map, players, {
    config,
    analytics,
    secretSalt: config.secretSalt,
    units: resources.units,
    unitsById: resources.unitsById,
    onComplete: (match) => cleanupMatch(match, [ticketA, ticketB]),
  });

  registerMatch(controller, players, connections);
  controller.start();
}

function createBotMatch(resources: Awaited<ReturnType<typeof loadResources>>, ticket: QueueTicket) {
  const map = resources.maps[0];
  const botId = `bot-${randomUUID()}`;
  const players = {
    you: { id: ticket.playerId, displayName: ticket.displayName, socket: ticket.socket, isBot: false },
    opponent: { id: botId, displayName: 'Bot', socket: null, isBot: true },
  } as const satisfies Record<PlayerRole, { id: string; displayName: string; socket: WebSocket | null; isBot: boolean }>;
  const connections = {
    you: ticket.connection,
    opponent: undefined,
  } as Record<PlayerRole, ConnectionState | undefined>;

  const controller = new MatchController(map, players, {
    config,
    analytics,
    secretSalt: config.secretSalt,
    units: resources.units,
    unitsById: resources.unitsById,
    onComplete: (match) => cleanupMatch(match, [ticket]),
  });

  registerMatch(controller, players, connections);
  controller.start();
}

function assignRoles(ticketA: QueueTicket, ticketB: QueueTicket): {
  players: Record<PlayerRole, { id: string; displayName: string; socket: WebSocket | null; isBot: boolean }>;
  connections: Record<PlayerRole, ConnectionState>;
} {
  const flip = Math.random() < 0.5;
  const first = flip ? ticketA : ticketB;
  const second = flip ? ticketB : ticketA;
  return {
    players: {
      you: { id: first.playerId, displayName: first.displayName, socket: first.socket, isBot: false },
      opponent: { id: second.playerId, displayName: second.displayName, socket: second.socket, isBot: false },
    },
    connections: {
      you: first.connection,
      opponent: second.connection,
    },
  };
}

function registerMatch(
  controller: MatchController,
  players: Record<PlayerRole, { id: string; displayName: string; socket: WebSocket | null; isBot: boolean }>,
  connections: Record<PlayerRole, ConnectionState | undefined>,
) {
  matches.set(controller.match.id, controller);

  for (const role of ['you', 'opponent'] as PlayerRole[]) {
    const playerId = players[role].id;
    if (players[role].isBot) continue;
    playerToMatch.set(playerId, { controller, role });
    const connection = connections[role];
    if (connection) {
      connection.match = { controller, role };
      if (connection.botTimer) {
        clearTimeout(connection.botTimer);
        connection.botTimer = undefined;
      }
    }
  }
}

function cleanupMatch(match: MatchContext, tickets: QueueTicket[]) {
  matches.delete(match.id);
  for (const ticket of tickets) {
    playerToMatch.delete(ticket.playerId);
    if (ticket.connection.match?.controller.match.id === match.id) {
      ticket.connection.match = undefined;
    }
  }
}

function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.type !== 'string') return null;
    return parsed as ClientMessage;
  } catch (error) {
    return null;
  }
}
