import { I18n } from './i18n';
import { GameStateManager } from './state';
import { Renderer } from './render';
import { GameSocket } from './network';
import { serializeCommitPayload } from 'aslingshot/shared/commit';
import type { ClientMessage } from 'aslingshot/shared/messages';

const PLAYER_ID_KEY = 'slingshot.playerId';
const COMMIT_SALT = import.meta.env.VITE_COMMIT_SALT ?? 'client-salt';

function loadPlayerId(): string {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

const playerId = loadPlayerId();

const i18n = new I18n(import.meta.env.VITE_LANGUAGE_DEFAULT);
const state = new GameStateManager();

const titleEl = document.getElementById('title')!;
const toggleEl = document.getElementById('language-toggle')! as HTMLButtonElement;
const statusEl = document.getElementById('status')!;
const roundEl = document.getElementById('round')!;
const countdownEl = document.getElementById('countdown')!;
const powerFillEl = document.getElementById('power-fill')!;
const canvas = document.getElementById('battle-canvas')! as HTMLCanvasElement;
const botLink = document.getElementById('bot-link')! as HTMLAnchorElement;

const renderer = new Renderer(canvas);
let dragStart: { x: number; y: number } | null = null;
let dragVec: { x: number; y: number } = { x: 0, y: 0 };
let pendingAction: { round: number; action: { unitId: string; dragVec: { x: number; y: number }; skill?: string }; nonce: string } | null = null;
let revealOpenedForRound: number | null = null;

function translateUI() {
  titleEl.textContent = i18n.t('app.title');
  toggleEl.textContent = i18n.t('app.toggle');
  botLink.textContent = i18n.t('ui.playBot');
}

translateUI();
toggleEl.addEventListener('click', () => {
  i18n.toggleLocale();
  translateUI();
});

botLink.addEventListener('click', (event) => {
  event.preventDefault();
  const url = new URL(window.location.href);
  url.searchParams.set('mode', 'pve');
  window.location.href = url.toString();
});

state.subscribe((snapshot) => {
  renderer.update(snapshot);
  roundEl.textContent = snapshot.round > 0 ? i18n.t('ui.round', { round: snapshot.round }) : '';
  let statusKey = 'ui.waiting';
  if (snapshot.status === 'connecting') statusKey = 'ui.connecting';
  if (snapshot.status === 'ready') statusKey = 'ui.ready';
  if (snapshot.status === 'finished' && snapshot.summary) {
    statusKey = 'ui.finished';
  }
  statusEl.textContent = i18n.t(statusKey, snapshot.summary ? { winner: snapshot.summary.winner } : {});
  countdownEl.textContent = snapshot.countdownMs > 0 ? (snapshot.countdownMs / 1000).toFixed(1) : '';
});

state.onHash(({ round, hash }) => {
  const message: ClientMessage = {
    type: 'CLIENT_RESULT_HASH',
    payload: { round, hash },
  };
  socket.send(message);
});

setInterval(() => {
  const snapshot = state.getSnapshot();
  if (!snapshot || snapshot.status !== 'ready') {
    countdownEl.textContent = '';
    return;
  }
  const next = Math.max(0, snapshot.countdownMs - 100);
  state.updateCountdown(next);
  countdownEl.textContent = (next / 1000).toFixed(1);
}, 100);

const configuredWsUrl =
  import.meta.env.VITE_WS_URL ?? (import.meta.env as Record<string, string | undefined>).WS_URL;
const WS_URL = configuredWsUrl && configuredWsUrl.length > 0 ? configuredWsUrl : `ws://${window.location.hostname}:3001`;

const socket = new GameSocket(
  WS_URL + window.location.search,
  (message) => {
    if (message.type === 'REVEAL_OPEN') {
      revealOpenedForRound = message.payload.round;
      sendPendingReveal();
      return;
    }
    state.updateFromServer(message);
    if (message.type === 'ROUND_START') {
      revealOpenedForRound = null;
      pendingAction = null;
    }
  },
  (status) => {
    if (status === 'open') {
      state.setStatus('queueing');
      socket.send({ type: 'JOIN_QUEUE', payload: { playerId } });
    } else if (status === 'connecting') {
      state.setStatus('connecting');
    }
  },
);

function canvasPos(evt: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (evt) => {
  if (stateSnapshot().status !== 'ready') return;
  dragStart = canvasPos(evt);
  dragVec = { x: 0, y: 0 };
  canvas.setPointerCapture(evt.pointerId);
});

canvas.addEventListener('pointermove', (evt) => {
  if (!dragStart) return;
  const pos = canvasPos(evt);
  dragVec = { x: pos.x - dragStart.x, y: pos.y - dragStart.y };
  const power = Math.min(1, Math.hypot(dragVec.x, dragVec.y) / 240);
  powerFillEl.style.width = `${Math.min(100, Math.abs(power) * 100)}%`;
});

canvas.addEventListener('pointerup', async (evt) => {
  if (!dragStart) return;
  canvas.releasePointerCapture(evt.pointerId);
  const pos = canvasPos(evt);
  dragVec = { x: pos.x - dragStart.x, y: pos.y - dragStart.y };
  dragStart = null;
  const snapshot = stateSnapshot();
  if (snapshot.status !== 'ready') return;
  const unitId = state.getActiveUnitId('you');
  if (!unitId) return;
  const vec = normalizeVector(dragVec);
  await queueAction(unitId, vec, snapshot.round);
  powerFillEl.style.width = '0%';
});

async function queueAction(unitId: string, vec: { x: number; y: number }, round: number) {
  const action = { unitId, dragVec: vec };
  const nonce = crypto.randomUUID();
  const commitHash = await sha256(serializeCommitPayload(action, nonce, COMMIT_SALT));
  const commitMessage: ClientMessage = {
    type: 'ACTION_COMMIT',
    payload: { round, hash: commitHash },
  };
  socket.send(commitMessage);
  pendingAction = { round, action, nonce };
  sendPendingReveal();
  state.setStatus('waiting');
}

function sendPendingReveal() {
  if (!pendingAction || revealOpenedForRound !== pendingAction.round) return;
  const reveal: ClientMessage = {
    type: 'ACTION_REVEAL',
    payload: { round: pendingAction.round, action: pendingAction.action, nonce: pendingAction.nonce },
  };
  socket.send(reveal);
  pendingAction = null;
}

function stateSnapshot() {
  return state.getSnapshot();
}

function normalizeVector(vec: { x: number; y: number }) {
  const max = 12;
  return {
    x: clamp(-vec.x / 40, -max, max),
    y: clamp(-vec.y / 40, -max, max),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

async function sha256(value: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
