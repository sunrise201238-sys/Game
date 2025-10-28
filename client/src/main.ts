import { I18n } from './i18n';
import { GameStateManager, buildClientAction } from './state';
import { Renderer } from './render';
import { GameSocket } from './network';
import type { ClientMessage } from '@shared/messages';
import { serializeCommitPayload } from '@shared/commit';

const i18n = new I18n(import.meta.env.VITE_LANGUAGE_DEFAULT);
const state = new GameStateManager();

const titleEl = document.getElementById('title')!;
const toggleEl = document.getElementById('language-toggle')! as HTMLButtonElement;
const statusEl = document.getElementById('status')!;
const roundEl = document.getElementById('round')!;
const countdownEl = document.getElementById('countdown')!;
const powerFillEl = document.getElementById('power-fill')!;
const canvas = document.getElementById('battle-canvas')! as HTMLCanvasElement;

const renderer = new Renderer(canvas);
let dragStart: { x: number; y: number } | null = null;
let dragVec: { x: number; y: number } = { x: 0, y: 0 };

function translateUI(current = state.getSnapshot()) {
  titleEl.textContent = i18n.t('app.title');
  toggleEl.textContent =
    current.status === 'ready'
      ? `${i18n.t('app.toggle')} (${i18n.t('app.language.zh')}/${i18n.t('app.language.en')})`
      : `${i18n.t('app.toggle')}`;
}

translateUI();
toggleEl.addEventListener('click', () => {
  i18n.toggleLocale();
  translateUI();
});

state.subscribe((snapshot) => {
  renderer.update(snapshot);
  const roundLabel = snapshot.round > 0 ? i18n.t('ui.round', { round: snapshot.round }) : '';
  roundEl.textContent = roundLabel;
  statusEl.textContent = i18n.t(
    snapshot.status === 'connecting' ? 'ui.connecting' : snapshot.status === 'ready' ? 'ui.ready' : 'ui.waiting',
  );
  powerFillEl.style.width = `${Math.min(100, Math.abs(snapshot.power) * 100)}%`;
});

setInterval(() => {
  const snapshot = state.getSnapshot();
  if (snapshot.status !== 'ready') {
    countdownEl.textContent = '';
    return;
  }
  const next = Math.max(0, snapshot.countdownMs - 100);
  state.updateCountdown(next);
  countdownEl.textContent = (next / 1000).toFixed(1);
}, 100);

const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${window.location.hostname}:3001`;
const COMMIT_SALT = import.meta.env.VITE_COMMIT_SALT ?? 'client-salt';

const socket = new GameSocket(
  WS_URL,
  (message) => {
    state.updateFromServer(message);
  },
  (status) => {
    if (status === 'open') {
      state.setStatus('waiting');
      socket.send({
        type: 'JOIN_QUEUE',
        payload: { playerId: crypto.randomUUID() },
      });
    } else if (status === 'connecting') {
      state.setStatus('connecting');
    } else if (status === 'closed' || status === 'error') {
      state.setStatus('connecting');
    }
  },
);

function canvasPos(evt: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (evt) => {
  if (state.getSnapshot().status !== 'ready') return;
  dragStart = canvasPos(evt);
  dragVec = { x: 0, y: 0 };
  canvas.setPointerCapture(evt.pointerId);
});

canvas.addEventListener('pointermove', (evt) => {
  if (!dragStart) return;
  const pos = canvasPos(evt);
  dragVec = { x: pos.x - dragStart.x, y: pos.y - dragStart.y };
  const power = Math.min(1, Math.hypot(dragVec.x, dragVec.y) / 240);
  state.setPower(power);
});

canvas.addEventListener('pointerup', async (evt) => {
  if (!dragStart) return;
  canvas.releasePointerCapture(evt.pointerId);
  const pos = canvasPos(evt);
  dragVec = { x: pos.x - dragStart.x, y: pos.y - dragStart.y };
  dragStart = null;
  const snapshot = state.getSnapshot();
  const activeUnit = snapshot.units.find((unit) => unit.alive);
  if (!activeUnit) return;
  const vec = normalizeVector(dragVec);
  await sendAction(activeUnit.id, vec);
  state.setPower(0);
  state.setStatus('waiting');
});

async function sendAction(unitId: string, vec: { x: number; y: number }) {
  const action = buildClientAction({ unitId, dragVec: vec });
  const nonce = crypto.randomUUID();
  const commitHash = await sha256(serializeCommitPayload(action, nonce, COMMIT_SALT));
  const round = state.getSnapshot().round;
  const commitMessage: ClientMessage = {
    type: 'ACTION_COMMIT',
    payload: { round, hash: commitHash },
  };
  const revealMessage: ClientMessage = {
    type: 'ACTION_REVEAL',
    payload: { round, action, nonce },
  };
  socket.send(commitMessage);
  socket.send(revealMessage);
  const resultHash: ClientMessage = {
    type: 'CLIENT_RESULT_HASH',
    payload: { round, hash: await sha256(JSON.stringify({ action, round })) },
  };
  socket.send(resultHash);
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
