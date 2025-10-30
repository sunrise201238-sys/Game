import { I18n } from './i18n';
import { GameStateManager } from './state';
import type { ClientUnitState } from './state';
import { Renderer } from './render';
import { GameSocket } from './network';
import { PHYSICS_CONSTANTS } from '@slingshot/shared';
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
const modeDescriptionEl = document.getElementById('mode-description')! as HTMLParagraphElement;
const instructionsEl = document.getElementById('instructions')! as HTMLParagraphElement;
const playAgainEl = document.getElementById('play-again')! as HTMLButtonElement;

const renderer = new Renderer(canvas);
let dragStart: { x: number; y: number } | null = null;
let dragVec: { x: number; y: number } = { x: 0, y: 0 };
let lastMatchId: string | undefined;

function updateModeButtons() {
  const mode = getCurrentMode();
  const isBot = mode === 'pve';
  modeBotEl.classList.toggle('active', isBot);
  modeOnlineEl.classList.toggle('active', !isBot);
  modeBotEl.setAttribute('aria-pressed', String(isBot));
  modeOnlineEl.setAttribute('aria-pressed', String(!isBot));
  modeDescriptionEl.textContent = i18n.t(isBot ? 'ui.botModeDescription' : 'ui.onlineModeDescription');
}

function translateUI() {
  titleEl.textContent = i18n.t('app.title');
  toggleEl.textContent = i18n.t('app.toggle');
  modeBotEl.textContent = i18n.t('ui.playBot');
  modeOnlineEl.textContent = i18n.t('ui.playOnline');
  teamYouLabel.textContent = i18n.t('ui.teamYou');
  teamOpponentLabel.textContent = i18n.t('ui.teamOpponent');
  instructionsEl.textContent = i18n.t('ui.controlsHint');
  playAgainEl.textContent = i18n.t('ui.playAgain');
  updateModeButtons();
  const snapshot = state.getSnapshot();
  updateTeamPanel(teamYouList, snapshot.youUnits, snapshot.activeYouId, 'you');
  updateTeamPanel(teamOpponentList, snapshot.opponentUnits, snapshot.activeOpponentId, 'opponent');
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
  if (snapshot.matchId && snapshot.matchId !== lastMatchId) {
    lastMatchId = snapshot.matchId;
    renderer.reset();
  }
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
      statusMessage = i18n.t('ui.resolvingTurn');
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
  updateTeamPanel(teamYouList, snapshot.youUnits, snapshot.activeYouId, 'you');
  updateTeamPanel(teamOpponentList, snapshot.opponentUnits, snapshot.activeOpponentId, 'opponent');
});

state.onTimeline((frames) => {
  renderer.play(frames);
});

state.onDiff((diff) => {
  if (diff.deaths.length > 0) {
    renderer.triggerDeaths(diff.deaths);
  }
});

state.onMatchEnd(() => {
  renderer.reset();
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
    state.updateFromServer(message);
    if (message.type === 'ROUND_START') {
      // ensure countdown resets when a new round begins
      state.updateCountdown(Math.max(message.payload.deadlineTs - Date.now(), 0));
    }
  },
  (status) => {
    if (status === 'open') {
      state.setStatus('queueing');
      socket.send({ type: 'JOIN_QUEUE', payload: { playerId } });
    } else if (status === 'connecting') {
      state.setStatus('connecting');
    } else if (status === 'closed') {
      state.setStatus('connecting');
    }
  },
);

playAgainEl.addEventListener('click', (event) => {
  event.preventDefault();
  renderer.reset();
  state.setStatus('queueing');
  state.updateCountdown(0);
  socket.send({ type: 'JOIN_QUEUE', payload: { playerId } });
});

function canvasPos(evt: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (evt) => {
  if (!state.canAct()) return;
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

canvas.addEventListener('pointerup', (evt) => {
  if (!dragStart) return;
  canvas.releasePointerCapture(evt.pointerId);
  const pos = canvasPos(evt);
  dragVec = { x: pos.x - dragStart.x, y: pos.y - dragStart.y };
  dragStart = null;
  renderer.setAim(null);
  if (!state.canAct()) {
    powerFillEl.style.width = '0%';
    return;
  }
  const snapshot = stateSnapshot();
  const unitId = state.getActiveUnitId('you');
  if (!unitId) return;
  const vec = normalizeVector(dragVec);
  queueAction(unitId, vec, snapshot.round);
  powerFillEl.style.width = '0%';
});

canvas.addEventListener('pointercancel', () => {
  dragStart = null;
  renderer.setAim(null);
  powerFillEl.style.width = '0%';
});

function queueAction(unitId: string, vec: { x: number; y: number }, round: number) {
  if (!state.canAct()) return;
  const action = { unitId, dragVec: vec };
  state.registerPlayerAction(action);
  const submit: ClientMessage = {
    type: 'ACTION_SUBMIT',
    payload: { round, action },
  };
  socket.send(submit);
  state.updateCountdown(0);
}

function stateSnapshot() {
  return state.getSnapshot();
}

function normalizeVector(vec: { x: number; y: number }) {
  const max = PHYSICS_CONSTANTS.dragImpulseCap;
  const scale = 1 / 55;
  return {
    x: clamp(-vec.x * scale, -max, max),
    y: clamp(-vec.y * scale, -max, max),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
