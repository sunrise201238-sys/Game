import { DEFAULT_MAP_ID, MAPS, getMapById } from './config';
import { GameEngine } from './engine';
import { Renderer } from './renderer';
import type { GameMode, GameState, TeamId, UnitState, Vector } from './types';

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const restartButton = document.getElementById('restart-btn') as HTMLButtonElement;
const mapSelect = document.getElementById('map-select') as HTMLSelectElement;
const roundLabel = document.getElementById('round-label') as HTMLSpanElement;
const phaseLabel = document.getElementById('phase-label') as HTMLSpanElement;
const playerList = document.getElementById('player-units') as HTMLUListElement;
const botList = document.getElementById('bot-units') as HTMLUListElement;
const hintText = document.getElementById('hint-text') as HTMLParagraphElement;
const modeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-mode]')
);
const playerHeading = document.getElementById('team-a-label') as HTMLHeadingElement;
const opponentHeading = document.getElementById('team-b-label') as HTMLHeadingElement;
const boardWrapper = document.getElementById('board-wrapper') as HTMLElement;
const fullscreenButton = document.getElementById('fullscreen-btn') as HTMLButtonElement;
const zoomInButton = document.getElementById('zoom-in') as HTMLButtonElement;
const zoomOutButton = document.getElementById('zoom-out') as HTMLButtonElement;
const zoomResetButton = document.getElementById('zoom-reset') as HTMLButtonElement;
const zoomIndicator = document.getElementById('zoom-indicator') as HTMLSpanElement;
const appRoot = document.getElementById('app') as HTMLElement;
const ZOOM_STEP = 1.2;
const DRAG_INPUT_MULTIPLIER = 1.35;

let currentMap = getMapById(DEFAULT_MAP_ID);
let currentMode: GameMode = 'bot';

for (const map of MAPS) {
  const option = document.createElement('option');
  option.value = map.id;
  option.textContent = map.name;
  mapSelect.append(option);
}
mapSelect.value = currentMap.id;

const renderer = new Renderer(canvas, currentMap);
const zoomLimits = renderer.getZoomLimits();

let currentState: GameState;
let isDragging = false;
let dragOrigin: Vector | null = null;
let dragCurrent: Vector | null = null;
let dragPointerId: number | null = null;
let dragVector: Vector | null = null;
let isPanning = false;
let panPointerId: number | null = null;
let panLast: { x: number; y: number } | null = null;
let panKeyActive = false;
let pseudoFullscreen = false;

type VendorFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

type VendorFullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void>;
};

const fullscreenElement = boardWrapper as VendorFullscreenElement;
const fullscreenDocument = document as VendorFullscreenDocument;
const hasNativeFullscreen =
  typeof fullscreenElement.requestFullscreen === 'function' ||
  typeof fullscreenElement.webkitRequestFullscreen === 'function';

const engine = new GameEngine({
  onState: (state) => {
    if (state.mapId !== currentMap.id) {
      currentMap = getMapById(state.mapId);
      renderer.setMap(currentMap);
      mapSelect.value = currentMap.id;
      updateZoomUi();
    }
    currentState = state;
    updateUi(state);
    renderScene();
  },
  onFrame: () => {
    // no-op: renderer re-renders when state updates
  },
}, currentMap, undefined, currentMode);

currentState = engine.getSnapshot();
updateUi(currentState);
const renderScene = () => {
  renderer.render(currentState, {
    dragOrigin: isDragging ? dragOrigin : null,
    dragCurrent: isDragging ? dragCurrent : null,
  });
};

const isNativeFullscreenActive = () => document.fullscreenElement === boardWrapper;
const isFullscreenActive = () => isNativeFullscreenActive() || pseudoFullscreen;

const updateFullscreenButton = () => {
  const active = isFullscreenActive();
  fullscreenButton.textContent = active ? 'Exit Fullscreen' : 'Fullscreen';
  fullscreenButton.setAttribute('aria-pressed', active ? 'true' : 'false');
};

const syncFullscreenUi = () => {
  const active = isFullscreenActive();
  document.body.classList.toggle('fullscreen-active', active);
  appRoot.classList.toggle('fullscreen-active', active);
};

const requestNativeFullscreen = (): Promise<void> | null => {
  if (typeof fullscreenElement.requestFullscreen === 'function') {
    try {
      const result = fullscreenElement.requestFullscreen();
      if (result && typeof (result as Promise<void>).then === 'function') {
        return result as Promise<void>;
      }
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }
  if (typeof fullscreenElement.webkitRequestFullscreen === 'function') {
    return new Promise<void>((resolve, reject) => {
      try {
        fullscreenElement.webkitRequestFullscreen!();
        resolve();
      } catch (error) {
        reject(error as Error);
      }
    });
  }
  return null;
};

const exitNativeFullscreen = (): Promise<void> | null => {
  if (typeof fullscreenDocument.exitFullscreen === 'function') {
    try {
      const result = fullscreenDocument.exitFullscreen();
      if (result && typeof (result as Promise<void>).then === 'function') {
        return result as Promise<void>;
      }
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }
  if (typeof fullscreenDocument.webkitExitFullscreen === 'function') {
    return new Promise<void>((resolve, reject) => {
      try {
        fullscreenDocument.webkitExitFullscreen!();
        resolve();
      } catch (error) {
        reject(error as Error);
      }
    });
  }
  return null;
};

const enterPseudoFullscreen = () => {
  if (pseudoFullscreen) return;
  pseudoFullscreen = true;
  document.body.classList.add('pseudo-fullscreen-active');
  boardWrapper.classList.add('pseudo-fullscreen');
  updateFullscreenButton();
  syncFullscreenUi();
  renderer.refreshViewport();
  renderScene();
};

const exitPseudoFullscreen = () => {
  if (!pseudoFullscreen) return;
  pseudoFullscreen = false;
  document.body.classList.remove('pseudo-fullscreen-active');
  boardWrapper.classList.remove('pseudo-fullscreen');
  updateFullscreenButton();
  syncFullscreenUi();
  renderer.refreshViewport();
  renderScene();
};

const updateZoomUi = () => {
  const zoom = renderer.getZoom();
  const percent = Math.round(zoom * 100);
  zoomIndicator.textContent = `${percent}%`;
  const minThreshold = zoomLimits.min + 0.01;
  const maxThreshold = zoomLimits.max - 0.01;
  zoomOutButton.disabled = zoom <= minThreshold;
  zoomInButton.disabled = zoom >= maxThreshold;
};

const getCameraCenter = (): Vector => {
  const offset = renderer.getOffset();
  const view = renderer.getViewSize();
  return {
    x: offset.x + view.x / 2,
    y: offset.y + view.y / 2,
  };
};

const applyZoomFactor = (factor: number, anchor?: Vector) => {
  renderer.setZoom(renderer.getZoom() * factor, anchor);
  renderScene();
  updateZoomUi();
};

renderScene();
updateZoomUi();
updateFullscreenButton();
syncFullscreenUi();

restartButton.addEventListener('click', () => {
  isDragging = false;
  dragOrigin = null;
  dragCurrent = null;
  dragVector = null;
  if (dragPointerId !== null) {
    try {
      canvas.releasePointerCapture(dragPointerId);
    } catch (error) {
      // ignore if pointer capture already released
    }
  }
  dragPointerId = null;
  stopPan();
  engine.startNewGame(currentMap, currentMode);
});

mapSelect.addEventListener('change', () => {
  currentMap = getMapById(mapSelect.value);
  renderer.setMap(currentMap);
  isDragging = false;
  dragOrigin = null;
  dragCurrent = null;
  dragVector = null;
  if (dragPointerId !== null) {
    try {
      canvas.releasePointerCapture(dragPointerId);
    } catch (error) {
      // ignore if pointer capture already released
    }
  }
  dragPointerId = null;
  stopPan();
  updateZoomUi();
  engine.startNewGame(currentMap, currentMode);
});

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.dataset.mode as GameMode | undefined;
    if (!mode || mode === currentMode) return;
    currentMode = mode;
    setActiveModeButton(mode);
    engine.startNewGame(currentMap, currentMode);
  });
});

const beginPan = (event: PointerEvent) => {
  isPanning = true;
  panPointerId = event.pointerId;
  panLast = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('pan-ready');
  canvas.classList.add('pan-active');
};

const updateDragPreview = (event: PointerEvent) => {
  if (!isDragging || !dragOrigin) return;
  const pointerWorld = toWorldPoint(event);
  const rawVector = {
    x: dragOrigin.x - pointerWorld.x,
    y: dragOrigin.y - pointerWorld.y,
  };
  const zoom = renderer.getZoom();
  dragVector = {
    x: rawVector.x * zoom * DRAG_INPUT_MULTIPLIER,
    y: rawVector.y * zoom * DRAG_INPUT_MULTIPLIER,
  };
  dragCurrent = {
    x: dragOrigin.x - dragVector.x,
    y: dragOrigin.y - dragVector.y,
  };
  renderScene();
};

const updatePanFromPointer = (event: PointerEvent) => {
  if (!isPanning || event.pointerId !== panPointerId || !panLast) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const view = renderer.getViewSize();
  const deltaX = event.clientX - panLast.x;
  const deltaY = event.clientY - panLast.y;
  const worldDelta = {
    x: (-deltaX / rect.width) * view.x,
    y: (-deltaY / rect.height) * view.y,
  };
  panLast = { x: event.clientX, y: event.clientY };
  renderer.panBy(worldDelta);
  renderScene();
};

const stopPan = () => {
  if (panPointerId !== null) {
    try {
      canvas.releasePointerCapture(panPointerId);
    } catch (error) {
      // ignore release errors if pointer capture is already cleared
    }
  }
  isPanning = false;
  panPointerId = null;
  panLast = null;
  canvas.classList.remove('pan-active');
  if (!panKeyActive) {
    canvas.classList.remove('pan-ready');
  }
};

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || panKeyActive) return;
  const target = event.target as HTMLElement | null;
  if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) {
    return;
  }
  panKeyActive = true;
  canvas.classList.add('pan-ready');
  event.preventDefault();
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (pseudoFullscreen && !isNativeFullscreenActive()) {
    exitPseudoFullscreen();
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code !== 'Space') return;
  panKeyActive = false;
  if (!isPanning) {
    canvas.classList.remove('pan-ready');
  }
});

window.addEventListener('blur', () => {
  panKeyActive = false;
  if (!isPanning) {
    canvas.classList.remove('pan-ready');
  }
});

canvas.addEventListener('pointerdown', (event) => {
  const wantsPanByButton = event.button === 1 || event.button === 2;
  const wantsPanByModifier = panKeyActive && event.button === 0;
  if (wantsPanByButton || wantsPanByModifier) {
    event.preventDefault();
    beginPan(event);
    return;
  }

  if (event.button !== 0) {
    return;
  }

  const pointer = toWorldPoint(event);
  const canAct = engine.canPlayerAct();
  const activeUnit = canAct ? getActiveUnit(currentState) : null;
  if (canAct && activeUnit) {
    const distanceToUnit = Math.hypot(pointer.x - activeUnit.position.x, pointer.y - activeUnit.position.y);
    if (distanceToUnit <= activeUnit.def.radius + 12) {
      isDragging = true;
      dragOrigin = { ...activeUnit.position };
      dragCurrent = { ...dragOrigin };
      dragPointerId = event.pointerId;
      dragVector = { x: 0, y: 0 };
      canvas.setPointerCapture(event.pointerId);
      renderScene();
      return;
    }
  }

  event.preventDefault();
  beginPan(event);
});

canvas.addEventListener('pointermove', (event) => {
  if (isPanning && event.pointerId === panPointerId) {
    updatePanFromPointer(event);
    return;
  }
  if (!isDragging || event.pointerId !== dragPointerId) return;
  updateDragPreview(event);
});

const endDrag = (event: PointerEvent, cancel = false) => {
  if (!isDragging || event.pointerId !== dragPointerId || !dragOrigin) return;
  updateDragPreview(event);
  const actionVector = dragVector ?? { x: 0, y: 0 };
  isDragging = false;
  const pointerId = dragPointerId;
  dragPointerId = null;
  dragOrigin = null;
  dragCurrent = null;
  dragVector = null;
  if (pointerId !== null) {
    try {
      canvas.releasePointerCapture(pointerId);
    } catch (error) {
      // ignore if pointer capture already released
    }
  }
  renderScene();
  if (!cancel) {
    engine.beginPlayerAction(actionVector);
  }
};

canvas.addEventListener('pointerup', (event) => {
  if (isPanning && event.pointerId === panPointerId) {
    stopPan();
    return;
  }
  endDrag(event);
});

canvas.addEventListener('pointercancel', (event) => {
  if (isPanning && event.pointerId === panPointerId) {
    stopPan();
    return;
  }
  endDrag(event, true);
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const anchor = toWorldPoint(event);
  const factor = event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
  applyZoomFactor(factor, anchor);
});

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

zoomInButton.addEventListener('click', () => {
  applyZoomFactor(ZOOM_STEP, getCameraCenter());
});

zoomOutButton.addEventListener('click', () => {
  applyZoomFactor(1 / ZOOM_STEP, getCameraCenter());
});

zoomResetButton.addEventListener('click', () => {
  renderer.resetCamera();
  renderer.refreshViewport();
  renderScene();
  updateZoomUi();
});

fullscreenButton.addEventListener('click', () => {
  if (isNativeFullscreenActive()) {
    const result = exitNativeFullscreen();
    if (result) {
      result.catch(() => undefined);
    }
    return;
  }

  if (pseudoFullscreen) {
    exitPseudoFullscreen();
    return;
  }

  if (hasNativeFullscreen) {
    const result = requestNativeFullscreen();
    if (result) {
      result.catch(() => {
        enterPseudoFullscreen();
      });
      return;
    }
  }

  enterPseudoFullscreen();
});

document.addEventListener('fullscreenchange', () => {
  updateFullscreenButton();
  syncFullscreenUi();
  renderer.refreshViewport();
  renderScene();
});

document.addEventListener('fullscreenerror', () => {
  if (!pseudoFullscreen) {
    enterPseudoFullscreen();
  }
  syncFullscreenUi();
});

function toWorldPoint(event: PointerEvent | WheelEvent): Vector {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0 };
  }
  const ratioX = (event.clientX - rect.left) / rect.width;
  const ratioY = (event.clientY - rect.top) / rect.height;
  const offset = renderer.getOffset();
  const view = renderer.getViewSize();
  return {
    x: offset.x + view.x * ratioX,
    y: offset.y + view.y * ratioY,
  };
}

function updateUi(state: GameState): void {
  const activeUnit = getActiveUnit(state);
  roundLabel.textContent = `Round ${state.round}`;
  setActiveModeButton(state.mode);
  if (state.winner !== null) {
    phaseLabel.textContent = state.winner === 0 ? 'Team One Wins!' : state.winner === 1 ? (state.mode === 'bot' ? 'Bot Wins!' : 'Team Two Wins!') : 'Draw';
  } else if (state.phase === 'aim') {
    if (state.mode === 'hotseat') {
      phaseLabel.textContent = state.activeTeam === 0 ? 'Team One: Aim' : 'Team Two: Aim';
    } else {
      phaseLabel.textContent = state.activeTeam === 0 ? 'Your turn' : 'Bot turn';
    }
  } else if (state.phase === 'bot-planning') {
    phaseLabel.textContent = 'Bot planning';
  } else if (state.phase === 'animating') {
    phaseLabel.textContent = 'Resolving';
  } else {
    phaseLabel.textContent = '';
  }

  const activeId = activeUnit?.id ?? null;
  updateUnitList(playerList, state, 0, activeId);
  updateUnitList(botList, state, 1, activeId);

  if (state.mode === 'hotseat') {
    playerHeading.textContent = 'Team One';
    opponentHeading.textContent = 'Team Two';
  } else {
    playerHeading.textContent = 'Your Squad';
    opponentHeading.textContent = 'Bot Squad';
  }

  const baseHint = (() => {
    if (state.winner !== null) {
      return 'Tap "Start New Game" to play again.';
    }
    if (state.phase === 'animating') {
      return 'Resolving actions…';
    }
    if (state.mode === 'bot' && state.phase === 'bot-planning') {
      return 'Bot is preparing a move…';
    }
    if (state.mode === 'hotseat') {
      return state.activeTeam === 0
        ? 'Team One: drag the highlighted unit opposite your desired path.'
        : 'Team Two: drag the highlighted unit opposite your desired path.';
    }
    return state.activeTeam === 0
      ? 'Drag your highlighted unit away from where you want it to travel, then release.'
      : 'Bot is acting — watch the field.';
  })();

  const mapMeta = getMapById(state.mapId);
  const mapDetails = mapMeta.description ? ` • ${mapMeta.name}: ${mapMeta.description}` : '';
  hintText.textContent = `${baseHint}${mapDetails}`;
}

function updateUnitList(container: HTMLUListElement, state: GameState, team: TeamId, activeId: string | null) {
  const entries = state.units
    .filter((unit) => unit.team === team)
    .map((unit) => {
      const li = document.createElement('li');
      li.className = `unit ${unit.alive ? 'alive' : 'dead'} team-${team}`;
      if (unit.id === activeId && state.activeTeam === team && state.phase !== 'ended') {
        li.classList.add('active');
      }

      const name = document.createElement('span');
      name.className = 'unit-name';
      name.textContent = unit.def.name;

      const hp = document.createElement('span');
      hp.className = 'unit-hp';
      hp.textContent = `${Math.max(0, Math.round(unit.hp))} HP`;

      const bar = document.createElement('div');
      bar.className = 'unit-hp-bar';
      const fill = document.createElement('div');
      fill.className = 'unit-hp-fill';
      fill.style.width = `${Math.max(0, Math.min(1, unit.hp / unit.def.maxHp)) * 100}%`;
      bar.append(fill);

      li.append(name, hp, bar);
      return li;
    });

  container.replaceChildren(...entries);
}

function getActiveUnit(state: GameState): UnitState | null {
  const order = state.orders[state.activeTeam];
  for (let offset = 0; offset < order.queue.length; offset += 1) {
    const index = (order.nextIndex + offset) % order.queue.length;
    const unitId = order.queue[index];
    const unit = state.units.find((u) => u.id === unitId && u.alive);
    if (unit) {
      return unit;
    }
  }
  return null;
}

// make sure restart button is always visible status
restartButton.hidden = false;

function setActiveModeButton(mode: GameMode): void {
  modeButtons.forEach((button) => {
    if (button.dataset.mode === mode) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }
  });
}

setActiveModeButton(currentMode);
