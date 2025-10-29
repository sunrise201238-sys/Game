import { I18n } from './i18n';
import { GameStateManager } from './state';
import type { ClientUnitState } from './state';
import { Renderer } from './render';
import { GameSocket } from './network';
import { serializeCommitPayload } from '@slingshot/shared';
import type { ClientMessage } from '@slingshot/shared';

type GameMode = 'pve' | 'pvp';

const urlState = new URL(window.location.href);
if (!urlState.searchParams.has('mode')) {
  urlState.searchParams.set('mode', 'pve');
  window.history.replaceState(null, '', urlState);
}

function getCurrentMode(): GameMode {
  return new URL(window.location.href).searchParams.get('mode') === 'pvp' ? 'pvp' : 'pve';
}

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
const modeBotEl = document.getElementById('mode-bot')! as HTMLButtonElement;
const modeOnlineEl = document.getElementById('mode-online')! as HTMLButtonElement;
const teamYouLabel = document.getElementById('team-you-label')!;
const teamOpponentLabel = document.getElementById('team-opponent-label')!;
const teamYouList = document.getElementById('team-you-list')! as HTMLUListElement;
const teamOpponentList = document.getElementById('team-opponent-list')! as HTMLUListElement;

const renderer = new Renderer(canvas);
let dragStart: { x: number; y: number } | null = null;
let dragVec: { x: number; y: number } = { x: 0, y: 0 };
let pendingAction: { round: number; action: { unitId: string; dragVec: { x: number; y: number }; skill?: string }; nonce: string } | null = null;
let revealOpenedForRound: number | null = null;

function updateModeButtons() {
  const mode = getCurrentMode();
  const isBot = mode === 'pve';
  modeBotEl.classList.toggle('active', isBot);
  modeOnlineEl.classList.toggle('active', !isBot);
  modeBotEl.setAttribute('aria-pressed', String(isBot));
  modeOnlineEl.setAttribute('aria-pressed', String(!isBot));
}

function translateUI() {
  titleEl.textContent = i18n.t('app.title');
  toggleEl.textContent = i18n.t('app.toggle');
  modeBotEl.textContent = i18n.t('ui.playBot');
  modeOnlineEl.textContent = i18n.t('ui.playOnline');
  teamYouLabel.textContent = i18n.t('ui.teamYou');
  teamOpponentLabel.textContent = i18n.t('ui.teamOpponent');
  updateModeButtons();
  const snapshot = state.getSnapshot();
  updateTeamPanel(teamYouList, snapshot.youUnits, state.getActiveUnitId('you'), 'you');
  updateTeamPanel(teamOpponentList, snapshot.opponentUnits, state.getActiveUnitId('opponent'), 'opponent');
}

translateUI();
toggleEl.addEventListener('click', () => {
  i18n.toggleLocale();
  translateUI();
});

modeBotEl.addEventListener('click', (event) => {
  event.preventDefault();
  if (getCurrentMode() === 'pve') return;
  const url = new URL(window.location.href);
  url.searchParams.set('mode', 'pve');
  window.location.href = url.toString();
});

modeOnlineEl.addEventListener('click', (event) => {
  event.preventDefault();
  if (getCurrentMode() === 'pvp') return;
  const url = new URL(window.location.href);
  url.searchParams.set('mode', 'pvp');
  window.location.href = url.toString();
});

state.subscribe((snapshot) => {
  renderer.update(snapshot);
  roundEl.textContent = snapshot.round > 0 ? i18n.t('ui.round', { round: snapshot.round }) : '';
  const mode = getCurrentMode();
  let statusMessage = i18n.t('ui.waiting');
  switch (snapshot.status) {
    case 'connecting':
      statusMessage = i18n.t('ui.connecting');
      break;
    case 'queueing':
      statusMessage = i18n.t(mode === 'pve' ? 'ui.queueBot' : 'ui.queueOpponent');
      break;
    case 'ready':
      statusMessage = i18n.t('ui.ready');
      break;
    case 'waiting':
      statusMessage = i18n.t('ui.waitingTurn');
      break;
    case 'resolving':
      statusMessage = i18n.t('ui.awaitingReveal');
      break;
    case 'finished':
      statusMessage = snapshot.summary
        ? i18n.t('ui.finished', { winner: snapshot.summary.winner })
        : i18n.t('ui.finishedNoWinner');
      break;
    default:
      break;
  }
  statusEl.textContent = statusMessage;
  countdownEl.textContent = snapshot.status === 'ready' && snapshot.countdownMs > 0 ? (snapshot.countdownMs / 1000).toFixed(1) : '';
  updateTeamPanel(teamYouList, snapshot.youUnits, state.getActiveUnitId('you'), 'you');
  updateTeamPanel(teamOpponentList, snapshot.opponentUnits, state.getActiveUnitId('opponent'), 'opponent');
});

state.onHash(({ round, hash }) => {
  const message: ClientMessage = {
    type: 'CLIENT_RESULT_HASH',
    payload: { round, hash },
  };
  socket.send(message);
});

state.onTimeline((frames) => {
  renderer.play(frames);
});

setInterval(() => {
  const snapshot = state.getSnapshot();
  if (!snapshot || snapshot.status !== 'ready') {
    countdownEl.textContent = '';
    return;
  }
  const next = Math.max(0, snapshot.countdownMs - 100);
  state.updateCountdown(next);
}, 100);

const configuredWsUrl =
  import.meta.env.VITE_WS_URL ?? (import.meta.env as Record<string, string | undefined>).WS_URL;

function resolveSocketUrl(baseUrl: string | null): string {
  const search = window.location.search;
  const appendSearch = (url: string) => {
    if (!search) return url;
    return url.includes('?') ? `${url}&${search.slice(1)}` : `${url}${search}`;
  };

  if (baseUrl && baseUrl.trim().length > 0) {
    try {
      const url = new URL(baseUrl);
      if (search) {
        const params = new URLSearchParams(search);
        params.forEach((value, key) => {
          url.searchParams.set(key, value);
        });
      }
      return url.toString();
    } catch (_error) {
      return appendSearch(baseUrl);
    }
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const defaultUrl = `${protocol}://${window.location.host}`;
  return appendSearch(defaultUrl);
}

const WS_URL = resolveSocketUrl(configuredWsUrl ?? null);

const socket = new GameSocket(
  WS_URL,
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
  renderer.setAim(dragStart, dragVec);
});

canvas.addEventListener('pointermove', (evt) => {
  if (!dragStart) return;
  const pos = canvasPos(evt);
  dragVec = { x: pos.x - dragStart.x, y: pos.y - dragStart.y };
  const power = Math.min(1, Math.hypot(dragVec.x, dragVec.y) / 240);
  powerFillEl.style.width = `${Math.min(100, Math.abs(power) * 100)}%`;
  renderer.setAim(dragStart, dragVec);
});

canvas.addEventListener('pointerup', async (evt) => {
  if (!dragStart) return;
  canvas.releasePointerCapture(evt.pointerId);
  const pos = canvasPos(evt);
  dragVec = { x: pos.x - dragStart.x, y: pos.y - dragStart.y };
  dragStart = null;
  renderer.setAim(null);
  const snapshot = stateSnapshot();
  if (snapshot.status !== 'ready') return;
  const unitId = state.getActiveUnitId('you');
  if (!unitId) return;
  const vec = normalizeVector(dragVec);
  await queueAction(unitId, vec, snapshot.round);
  powerFillEl.style.width = '0%';
});

canvas.addEventListener('pointercancel', () => {
  dragStart = null;
  renderer.setAim(null);
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
  state.updateCountdown(0);
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
  const max = 9;
  const scale = 1 / 55;
  return {
    x: clamp(-vec.x * scale, -max, max),
    y: clamp(-vec.y * scale, -max, max),
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

function updateTeamPanel(
  container: HTMLUListElement,
  units: ClientUnitState[],
  activeId: string | null,
  role: 'you' | 'opponent',
) {
  container.innerHTML = '';
  units.forEach((unit) => {
    const li = document.createElement('li');
    li.dataset.alive = String(unit.alive);
    if (unit.id === activeId) {
      li.dataset.active = 'true';
    }
    const name = i18n.t(`unit.${unit.type}`);
    const hpLabel = i18n.t('ui.hpRemaining', { hp: Math.max(0, Math.round(unit.hp)) });
    li.innerHTML = `<span>${name}</span><span>${hpLabel}</span>`;
    container.appendChild(li);
  });

  if (units.length === 0) {
    const li = document.createElement('li');
    li.textContent = role === 'you' ? i18n.t('ui.waitingForMatch') : i18n.t('ui.awaitingOpponent');
    li.classList.add('placeholder');
    container.appendChild(li);
  }
}
