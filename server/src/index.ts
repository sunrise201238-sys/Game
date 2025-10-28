import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';

import { loadConfig } from './config.js';
import { createAnalyticsStore } from './analytics.js';
import { loadResources } from './resources.js';
import { createSimulationEngine } from './simulation.js';
import { createMatchContext, MatchController } from './match.js';
import type {
  PlayerRole,
  ClientMessage,
  ServerMessage,
  MatchFoundMessage,
  RoundStartMessage,
  RevealOpenMessage,
  MinimalSnapshot,
  PlayerSnapshot,
} from '@slingshot/shared';
import { hashAction, serializeCommitPayload } from '@slingshot/shared';
import type { MatchContext, PlayerContext } from './types.js';

const config = loadConfig();
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const analytics = createAnalyticsStore(config.analyticsMode);
const simulation = createSimulationEngine();
const resourcesPromise = loadResources();

const matches = new Map<string, MatchController>();

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get('/admin/metrics', (_req, res) => {
  if (config.analyticsMode !== 'minimal') {
    return res.status(404).json({ error: 'analytics disabled' });
  }
  res.json(analytics.snapshot);
});

wss.on('connection', async (socket, request) => {
  const origin = request.headers.origin;
  if (config.allowOrigins.length > 0 && origin && !config.allowOrigins.includes(origin)) {
    socket.close(1008, 'origin not allowed');
    return;
  }

  const socketId = randomUUID();
  const resources = await resourcesPromise;
  const map = resources.maps[0];
  const units = resources.units;
  const timers = new Set<NodeJS.Timeout>();

  const players: Record<PlayerRole, PlayerContext> = {
    you: {
      id: socketId,
      socketId,
      displayName: 'Player',
      units: seedUnits(units),
    },
    opponent: {
      id: 'bot-' + socketId,
      socketId: 'bot-' + socketId,
      displayName: 'Bot',
      units: seedUnits(units),
    },
  };

  const match = createMatchContext(map.id, players);
  const controller = new MatchController(
    match,
    simulation,
    analytics,
    (message: ServerMessage) => {
      socket.send(JSON.stringify(message));
    },
    (ctx) => {
      const timer = setTimeout(() => {
        scheduleRoundStart(ctx, controller, socket, timers);
        timers.delete(timer);
      }, config.revealMs);
      timers.add(timer);
    },
    config.secretSalt,
  );

  matches.set(match.id, controller);
  analytics.increment('matchesStarted');

  const matchFound: MatchFoundMessage = {
    type: 'MATCH_FOUND',
    payload: {
      matchId: match.id,
      you: toPlayerSnapshot(match.players.you),
      opponent: toPlayerSnapshot(match.players.opponent),
      firstMover: match.firstMover,
      mapId: map.id,
      turnOrderYou: match.turnOrder.you,
      turnOrderOpp: match.turnOrder.opponent,
      cursorYou: match.cursors.you,
      cursorOpp: match.cursors.opponent,
    },
  };
  socket.send(JSON.stringify(matchFound));
  scheduleRoundStart(match, controller, socket, timers);

  socket.on('message', (data) => {
    const parsed = parseClientMessage(data.toString());
    if (!parsed) return;
    controller.handleMessage('you', parsed);
  });

  socket.on('close', () => {
    matches.delete(match.id);
    analytics.increment('matchesCompleted');
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
  });
});

server.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});

function seedUnits(unitSchemas: Array<{ id: string; hp: number }>): PlayerContext['units'] {
  return unitSchemas.slice(0, 3).map((schema, idx) => ({
    id: `${schema.id}-${idx}`,
    type: schema.id,
    hp: schema.hp,
    position: { x: 0, y: idx * 2 },
    alive: true,
  }));
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

function scheduleRoundStart(
  match: MatchContext,
  controller: MatchController,
  socket: WebSocket,
  timers: Set<NodeJS.Timeout>,
) {
  const roundNumber = match.round + 1;
  const deadline = Date.now() + config.planningMs;
  const snapshot = toMinimalSnapshot(match);
  const message: RoundStartMessage = {
    type: 'ROUND_START',
    payload: {
      round: roundNumber,
      deadlineTs: deadline,
      randomSeed: match.randomSeed,
      snapshot,
    },
  };
  socket.send(JSON.stringify(message));
  queueBotAction(controller, roundNumber);
  const timer = setTimeout(() => {
    const reveal: RevealOpenMessage = {
      type: 'REVEAL_OPEN',
      payload: { round: roundNumber },
    };
    socket.send(JSON.stringify(reveal));
    timers.delete(timer);
  }, config.planningMs);
  timers.add(timer);
}

function queueBotAction(controller: MatchController, round: number) {
  const opponentUnits = controller.getUnits('opponent');
  const unit = opponentUnits.find((u) => u.alive) ?? opponentUnits[0];
  if (!unit) return;
  const action = {
    unitId: unit.id,
    dragVec: { x: (Math.sin(round) * 6) % 4, y: -2 },
  };
  const nonce = randomUUID();
  const commitPayload = serializeCommitPayload(action, nonce, config.secretSalt);
  const hash = createHash('sha256').update(commitPayload).digest('hex');
  controller.handleMessage('opponent', {
    type: 'ACTION_COMMIT',
    payload: { round, hash },
  });
  controller.handleMessage('opponent', {
    type: 'ACTION_REVEAL',
    payload: { round, action, nonce },
  });
  controller.handleMessage('opponent', {
    type: 'CLIENT_RESULT_HASH',
    payload: { round, hash: hashAction({ action, round }, config.secretSalt) },
  });
}

function toMinimalSnapshot(match: MatchContext): MinimalSnapshot {
  return {
    round: match.round,
    mapId: match.map.id,
    you: toPlayerSnapshot(match.players.you),
    opponent: toPlayerSnapshot(match.players.opponent),
    aoeZones: [],
  };
}

function toPlayerSnapshot(player: PlayerContext): PlayerSnapshot {
  return {
    id: player.id,
    displayName: player.displayName,
    units: player.units.map((unit) => ({ ...unit })),
  };
}
