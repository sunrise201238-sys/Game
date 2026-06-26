import { DEFAULT_MAP_ID, MAPS, getMapById } from './config';
import { GameEngine } from './engine';
import { OnlineMatchClient } from './online';
import { Renderer } from './renderer';
import type { OnlineStatus } from '@slingshot/shared';
import type { GameMode, GameState, MapDefinition, TeamId, UnitState, Vector } from './types';

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const restartButton = document.getElementById('restart-btn') as HTMLButtonElement;
const mapSelect = document.getElementById('map-select') as HTMLSelectElement;
const roundLabel = document.getElementById('round-label') as HTMLSpanElement;
const phaseLabel = document.getElementById('phase-label') as HTMLSpanElement;
const playerList = document.getElementById('player-units') as HTMLUListElement;
const botList = document.getElementById('bot-units') as HTMLUListElement;
const modeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-mode]')
);
const playerHeading = document.getElementById('team-a-label') as HTMLHeadingElement;
const opponentHeading = document.getElementById('team-b-label') as HTMLHeadingElement;
const zoomInButton = document.getElementById('zoom-in') as HTMLButtonElement;
const zoomOutButton = document.getElementById('zoom-out') as HTMLButtonElement;
const zoomResetButton = document.getElementById('zoom-reset') as HTMLButtonElement;
const zoomIndicator = document.getElementById('zoom-indicator') as HTMLSpanElement;
const boardStage = document.getElementById('board-stage') as HTMLDivElement;
const body = document.body as HTMLBodyElement;
const fullscreenButton = document.getElementById('fullscreen-toggle') as HTMLButtonElement;
const fireModeToggle = document.getElementById('fire-mode-toggle') as HTMLButtonElement;
const fireControls = document.getElementById('fire-controls') as HTMLDivElement;
const joystickPanel = document.getElementById('joystick-panel') as HTMLDivElement;
const joystickBody = document.getElementById('joystick-body') as HTMLDivElement;
const joystickPad = document.getElementById('joystick-pad') as HTMLDivElement;
const joystickKnob = document.getElementById('joystick-knob') as HTMLDivElement;
const joystickDirectionValue = document.getElementById('joystick-direction') as HTMLSpanElement;
const joystickPowerValue = document.getElementById('joystick-power') as HTMLSpanElement;
const joystickFireButton = document.getElementById('joystick-fire-btn') as HTMLButtonElement;
const joystickCollapseButton = document.getElementById('joystick-collapse-btn') as HTMLButtonElement;
const joystickReopenButton = document.getElementById('joystick-reopen-btn') as HTMLButtonElement;
const ZOOM_STEP = 1.2;
const DRAG_INPUT_MULTIPLIER = 1.35;
// Rotating the landscape board into a portrait viewport. 90deg clockwise so the
// board's top edge points to the right of the device held upright.
const BOARD_ROTATION_DEG = 90;
// Joystick travel below this fraction of the pad radius is treated as "no aim".
const JOYSTICK_DEADZONE = 0.08;
type FireControlMode = 'drag' | 'joystick';

let currentMap = getMapById(DEFAULT_MAP_ID);
let currentMode: GameMode = 'bot';
let onlineClient: OnlineMatchClient | null = null;
let onlineStatus: OnlineStatus = 'idle';
let onlineStatusMessage: string | undefined;
let onlineTeam: TeamId | null = null;
let onlinePendingAction = false;
let onlineReadyTurn = -1;
let lastReportedTurn = -1;
let onlineAwaitingSyncApply = false;
let pendingOnlineStateSync: { turn: number; state: GameState } | null = null;
let fireControlMode: FireControlMode = 'drag';
let joystickCollapsed = false;
let boardRotated = false;
// Joystick aim state. joystickScreenDir is a normalized direction in SCREEN
// space (independent of board rotation); it is converted to a world vector when
// firing/previewing so it stays intuitive even when the board is rotated.
let joystickScreenDir: Vector | null = null;
let joystickPower = 0;
let joystickHasAim = false;
let joystickPointerId: number | null = null;

for (const map of MAPS) {
  const option = document.createElement('option');
  option.value = map.id;
  option.textContent = map.name;
  mapSelect.append(option);
}
mapSelect.value = currentMap.id;

const renderer = new Renderer(canvas, currentMap);
const zoomLimits = renderer.getZoomLimits();

const isTouchCentric = (() => {
  if (typeof window === 'undefined') {
    return false;
  }
  const touchPoints = navigator.maxTouchPoints ?? 0;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarsePointer || touchPoints > 0 || 'ontouchstart' in window;
})();

const prefersPseudoFullscreen = (() => {
  if (typeof window === 'undefined') {
    return false;
  }
  const touchPoints = navigator.maxTouchPoints ?? 0;
  if (!isTouchCentric) {
    return false;
  }
  const maxScreenDimension = Math.max(window.screen?.width ?? 0, window.screen?.height ?? 0);
  const userAgent = navigator.userAgent ?? '';
  const isiPadLike = /iPad|iPadOS/i.test(userAgent) ||
    (userAgent.includes('Macintosh') && touchPoints > 1);
  const isLargeTouchDisplay = maxScreenDimension >= 1000;
  return isiPadLike || isLargeTouchDisplay;
})();

const setBoardRotated = (rotated: boolean) => {
  if (boardRotated === rotated) {
    return;
  }
  boardRotated = rotated;
  boardStage.classList.toggle('board-stage--rotated', rotated);
};

const updateFullscreenSizing = () => {
  if (!boardStage) {
    return;
  }
  if (!isBoardFullscreen()) {
    setBoardRotated(false);
    boardStage.style.removeProperty('--board-fullscreen-width');
    boardStage.style.removeProperty('--board-fullscreen-height');
    boardStage.style.removeProperty('--board-rotated-shift');
    renderer.setWidthOverride(null);
    return;
  }
  const viewportWidth = Math.max(1, window.visualViewport?.width ?? window.innerWidth);
  const viewportHeight = Math.max(1, window.visualViewport?.height ?? window.innerHeight);
  const aspect = currentMap.width / currentMap.height;
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return;
  }
  // Rotate a landscape board into a portrait viewport so it fills the screen
  // instead of shrinking to a thin strip. Only on touch devices to avoid
  // surprising desktop users who maximise a tall window.
  const shouldRotate = isTouchCentric && aspect > 1 && viewportHeight > viewportWidth;
  setBoardRotated(shouldRotate);

  if (shouldRotate) {
    // The board is rotated 90deg: its on-screen footprint is (height x width).
    // Controls overlay the bottom, so reserve the band they occupy and nudge the
    // board upward by half that band to keep it clear. Measuring the controls'
    // top edge folds in the safe-area inset baked into their CSS bottom offset.
    const controlsRect = fireControls?.getBoundingClientRect();
    const controlsBand =
      controlsRect && controlsRect.height > 0 ? viewportHeight - controlsRect.top + 10 : 0;
    const bottomReserve = Math.min(viewportHeight * 0.5, Math.max(0, controlsBand));
    const availWidth = Math.max(1, viewportWidth - 8);
    const availHeight = Math.max(1, viewportHeight - bottomReserve);
    // unrotatedHeight (footprint width) is bounded by both axes once rotated.
    const unrotatedHeight = Math.min(availWidth, availHeight / aspect);
    const unrotatedWidth = unrotatedHeight * aspect;
    boardStage.style.setProperty('--board-fullscreen-width', `${unrotatedWidth}px`);
    boardStage.style.setProperty('--board-fullscreen-height', `${unrotatedHeight}px`);
    boardStage.style.setProperty('--board-rotated-shift', `${bottomReserve / 2}px`);
    renderer.setWidthOverride(unrotatedWidth);
    return;
  }

  boardStage.style.removeProperty('--board-rotated-shift');
  renderer.setWidthOverride(null);
  const controlsHeight = Math.ceil(fireControls?.getBoundingClientRect().height ?? 0);
  const fullscreenChromeReserve = 64;
  const adjustedViewportHeight = Math.max(1, viewportHeight - controlsHeight - fullscreenChromeReserve);
  const viewportAspect = viewportWidth / adjustedViewportHeight;
  let targetWidth = viewportWidth;
  let targetHeight = adjustedViewportHeight;
  if (viewportAspect > aspect) {
    targetHeight = adjustedViewportHeight;
    targetWidth = targetHeight * aspect;
  } else {
    targetWidth = viewportWidth;
    targetHeight = targetWidth / aspect;
  }
  boardStage.style.setProperty('--board-fullscreen-width', `${targetWidth}px`);
  boardStage.style.setProperty('--board-fullscreen-height', `${targetHeight}px`);
};

const applyStageAspect = (map: MapDefinition) => {
  if (boardStage) {
    boardStage.style.setProperty('--board-aspect', `${map.width} / ${map.height}`);
  }
  updateFullscreenSizing();
};


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
let lastAimResetKey: string | null = null;
type PointerPosition = { clientX: number; clientY: number };
const activeTouchPointers = new Map<number, PointerPosition>();
interface PinchState {
  pointerIds: [number, number];
  initialDistance: number;
  initialZoom: number;
  lastCenterClient: { x: number; y: number };
}
let pinchState: PinchState | null = null;
const engine = new GameEngine({
  onState: (state) => {
    if (applyPendingOnlineStateSyncIfReady(state)) {
      return;
    }
    if (state.mapId !== currentMap.id) {
      currentMap = getMapById(state.mapId);
      renderer.setMap(currentMap);
      mapSelect.value = currentMap.id;
      applyStageAspect(currentMap);
      updateZoomUi();
    }
    currentState = state;
    maybeReportOnlineTurnCompletion(state);
    refreshOnlineReadyState();
    updateUi(state);
    renderScene();
  },
  onFrame: () => {
    // no-op: renderer re-renders when state updates
  },
}, currentMap, undefined, currentMode);

currentState = engine.getSnapshot();
const renderScene = () => {
  let localTeam: TeamId = 0;
  if (currentState.mode === 'online') {
    localTeam = onlineTeam ?? engine.getPlayerTeam();
  } else if (currentState.mode === 'hotseat') {
    localTeam = currentState.activeTeam;
  }
  renderer.setPerspectiveTeam(localTeam);
  const aimPreview = fireControlMode === 'joystick' ? getAimPreviewLine() : null;
  const previewOrigin = isDragging ? dragOrigin : aimPreview?.origin ?? null;
  const previewCurrent = isDragging ? dragCurrent : aimPreview?.current ?? null;
  const hasAim = Boolean(previewOrigin && previewCurrent);
  // The magnifier follows the aim tip, but hides while the joystick is collapsed
  // (collapse is for reviewing the whole board before firing).
  const showLoupe = hasAim && !(fireControlMode === 'joystick' && joystickCollapsed);
  renderer.render(currentState, {
    dragOrigin: previewOrigin,
    dragCurrent: previewCurrent,
    showLoupe,
  });
};

const applyPendingOnlineStateSyncIfReady = (state: GameState): boolean => {
  if (!pendingOnlineStateSync) {
    return false;
  }
  if (state.mode !== 'online') {
    pendingOnlineStateSync = null;
    onlineAwaitingSyncApply = false;
    return false;
  }
  if (state.phase !== 'aim') {
    return false;
  }
  const payload = pendingOnlineStateSync;
  if (engine.getTurnCounter() > payload.turn) {
    pendingOnlineStateSync = null;
    onlineAwaitingSyncApply = false;
    return false;
  }
  pendingOnlineStateSync = null;
  onlineAwaitingSyncApply = false;
  engine.syncOnlineState(payload.state, payload.turn);
  return true;
};

const hashOnlineState = (state: GameState): string => {
  const units = [...state.units]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((unit) => ({
      id: unit.id,
      hp: unit.hp,
      alive: unit.alive,
      x: Math.round(unit.position.x * 1000) / 1000,
      y: Math.round(unit.position.y * 1000) / 1000,
    }));
  return JSON.stringify({
    activeTeam: state.activeTeam,
    winner: state.winner,
    units,
  });
};

const serializeOnlineState = (state: GameState): string => JSON.stringify(state);

const maybeReportOnlineTurnCompletion = (state: GameState): void => {
  if (state.mode !== 'online' || onlineStatus !== 'matched' || !onlineClient || onlineTeam === null) {
    return;
  }
  if (state.winner !== null || state.phase !== 'aim') {
    return;
  }
  const turn = engine.getTurnCounter();
  if (turn <= 0 || turn <= lastReportedTurn) {
    return;
  }
  lastReportedTurn = turn;
  onlineClient.reportTurnComplete(onlineTeam, turn, hashOnlineState(state), serializeOnlineState(state));
};

const refreshOnlineReadyState = (): void => {
  if (currentMode !== 'online') {
    engine.setOnlineReady(true);
    return;
  }
  const ready = onlineStatus === 'matched' &&
    onlineTeam !== null &&
    onlineReadyTurn === engine.getTurnCounter() &&
    !onlineAwaitingSyncApply &&
    !onlinePendingAction;
  engine.setOnlineReady(ready);
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

const fullscreenDocument = document as Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
};

let pseudoFullscreenActive = false;

const getFullscreenElement = (): Element | null =>
  document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;

const isNativeBoardFullscreen = (): boolean => getFullscreenElement() === boardStage;

const isBoardFullscreen = (): boolean => pseudoFullscreenActive || isNativeBoardFullscreen();

const updateFullscreenUi = () => {
  const active = isBoardFullscreen();
  fullscreenButton.setAttribute('aria-pressed', active ? 'true' : 'false');
  fullscreenButton.textContent = active ? 'Exit' : 'Fullscreen';
  fullscreenButton.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
};

applyStageAspect(currentMap);

const clearPinchState = () => {
  if (!pinchState) {
    return;
  }
  const [firstId, secondId] = pinchState.pointerIds;
  try {
    canvas.releasePointerCapture(firstId);
  } catch (error) {
    // ignore release errors
  }
  try {
    canvas.releasePointerCapture(secondId);
  } catch (error) {
    // ignore release errors
  }
  pinchState = null;
};

const resetPinchTracking = () => {
  clearPinchState();
  activeTouchPointers.clear();
};

const applyFullscreenSideEffects = () => {
  const active = isBoardFullscreen();
  if (active) {
    body.classList.add('board-fullscreen-active');
  } else {
    body.classList.remove('board-fullscreen-active');
  }
  updateFullscreenSizing();
  updateFullscreenUi();
  renderer.refreshViewport();
  updateJoystickKnobVisual();
  renderScene();
  updateZoomUi();
  if (!active) {
    resetPinchTracking();
  }
};

const enterPseudoFullscreen = () => {
  if (pseudoFullscreenActive) {
    return;
  }
  pseudoFullscreenActive = true;
  boardStage.classList.add('board-stage--pseudo-fullscreen');
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  } catch (error) {
    window.scrollTo(0, 0);
  }
  applyFullscreenSideEffects();
};

const exitPseudoFullscreen = () => {
  if (!pseudoFullscreenActive) {
    return;
  }
  pseudoFullscreenActive = false;
  boardStage.classList.remove('board-stage--pseudo-fullscreen');
  applyFullscreenSideEffects();
};

const requestBoardFullscreen = async (): Promise<void> => {
  if (prefersPseudoFullscreen) {
    enterPseudoFullscreen();
    return;
  }
  let requestedNative = false;
  try {
    if (typeof boardStage.requestFullscreen === 'function') {
      const result = boardStage.requestFullscreen();
      requestedNative = true;
      if (result instanceof Promise) {
        await result;
      }
      if (isNativeBoardFullscreen()) {
        return;
      }
    }
  } catch (error) {
    requestedNative = false;
  }
  const stageWithWebkit = boardStage as HTMLDivElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  try {
    if (typeof stageWithWebkit.webkitRequestFullscreen === 'function') {
      const result = stageWithWebkit.webkitRequestFullscreen();
      requestedNative = true;
      if (result instanceof Promise) {
        await result;
      }
      if (isNativeBoardFullscreen()) {
        return;
      }
    }
  } catch (error) {
    requestedNative = false;
  }
  if (!requestedNative || !isNativeBoardFullscreen()) {
    enterPseudoFullscreen();
  }
};

const exitBoardFullscreen = async (): Promise<void> => {
  if (pseudoFullscreenActive && !isNativeBoardFullscreen()) {
    exitPseudoFullscreen();
    return;
  }
  try {
    if (typeof document.exitFullscreen === 'function') {
      await document.exitFullscreen();
      return;
    }
  } catch (error) {
    // ignore exit errors
  }
  if (typeof fullscreenDocument.webkitExitFullscreen === 'function') {
    try {
      await fullscreenDocument.webkitExitFullscreen();
      return;
    } catch (error) {
      // ignore exit errors
    }
  }
  if (pseudoFullscreenActive) {
    exitPseudoFullscreen();
  }
};

const handleFullscreenChange = (_event?: Event) => {
  if (isNativeBoardFullscreen()) {
    pseudoFullscreenActive = false;
    boardStage.classList.remove('board-stage--pseudo-fullscreen');
  }
  applyFullscreenSideEffects();
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

const getJoystickRadius = (): number => {
  const rect = joystickPad.getBoundingClientRect();
  const padRadius = Math.min(rect.width, rect.height) / 2;
  if (!Number.isFinite(padRadius) || padRadius <= 0) {
    return 0;
  }
  // Keep the knob (≈36% of the pad) comfortably inside the base.
  return padRadius * 0.7;
};

const updateJoystickKnobVisual = (): void => {
  const radius = getJoystickRadius();
  let knobX = 0;
  let knobY = 0;
  if (joystickScreenDir && joystickPower > 0 && radius > 0) {
    const travel = Math.min(1, joystickPower) * radius;
    knobX = joystickScreenDir.x * travel;
    knobY = joystickScreenDir.y * travel;
  }
  joystickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
  joystickPad.classList.toggle('is-aimed', joystickHasAim && joystickPower >= JOYSTICK_DEADZONE);
};

const resetJoystickAim = (): void => {
  joystickScreenDir = null;
  joystickPower = 0;
  joystickHasAim = false;
  updateJoystickKnobVisual();
};

const getJoystickActionVector = (): Vector | null => {
  if (!engine.canPlayerAct()) {
    return null;
  }
  if (!joystickHasAim || !joystickScreenDir || joystickPower < JOYSTICK_DEADZONE) {
    return null;
  }
  const activeUnit = getActiveUnit(currentState);
  if (!activeUnit) {
    return null;
  }
  const worldDir = rotateScreenVectorToWorld(joystickScreenDir);
  const magnitude = activeUnit.def.maxPower * Math.min(1, joystickPower);
  // Slingshot semantics: pull the knob back, launch the opposite way.
  return {
    x: -worldDir.x * magnitude,
    y: -worldDir.y * magnitude,
  };
};

const getAimPreviewLine = (): { origin: Vector; current: Vector } | null => {
  if (fireControlMode !== 'joystick') {
    return null;
  }
  const activeUnit = getActiveUnit(currentState);
  const vector = getJoystickActionVector();
  if (!activeUnit || !vector) {
    return null;
  }
  return {
    origin: { ...activeUnit.position },
    current: {
      x: activeUnit.position.x - vector.x,
      y: activeUnit.position.y - vector.y,
    },
  };
};

const applyAimResetForTurn = (state: GameState): void => {
  if (state.phase !== 'aim') {
    lastAimResetKey = null;
    return;
  }
  const turnKey = `${state.mode}:${state.round}:${state.activeTeam}:${state.phase}`;
  if (turnKey === lastAimResetKey) {
    return;
  }
  lastAimResetKey = turnKey;
  resetJoystickAim();
};

const updateJoystickCollapsedUi = (): void => {
  joystickBody.hidden = joystickCollapsed;
  joystickReopenButton.hidden = !joystickCollapsed;
};

function updateFireControlUi(): void {
  const joystickMode = fireControlMode === 'joystick';
  boardStage.classList.toggle('board-stage--joystick-mode', joystickMode);
  joystickPanel.hidden = !joystickMode;
  fireModeToggle.textContent = joystickMode ? 'Mode: Joystick' : 'Mode: Drag';
  fireModeToggle.setAttribute('aria-pressed', joystickMode ? 'true' : 'false');
  updateJoystickCollapsedUi();
  // Show the resulting launch direction (opposite of the pulled-back knob).
  let launchAngle = 0;
  if (joystickScreenDir) {
    const deg = (Math.atan2(-joystickScreenDir.y, -joystickScreenDir.x) * 180) / Math.PI;
    launchAngle = ((Math.round(deg) % 360) + 360) % 360;
  }
  joystickDirectionValue.textContent = `${launchAngle}°`;
  joystickPowerValue.textContent = `${Math.round(Math.min(1, joystickPower) * 100)}%`;
  const canAct = engine.canPlayerAct();
  const actionReady = Boolean(getJoystickActionVector());
  const onlineBlocked = currentMode === 'online' && (onlineStatus !== 'matched' || onlinePendingAction);
  fireModeToggle.disabled = currentMode === 'online' && onlineStatus !== 'matched';
  joystickPad.classList.toggle('is-disabled', !joystickMode || !canAct || onlineBlocked);
  joystickFireButton.disabled = !joystickMode || !actionReady || onlineBlocked;
  // Don't reflow mid-drag: the controls keep a stable size while aiming.
  if (isBoardFullscreen() && joystickPointerId === null) {
    updateFullscreenSizing();
  }
}

const updateJoystickFromPointer = (event: PointerEvent): void => {
  const rect = joystickPad.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = event.clientX - centerX;
  const dy = event.clientY - centerY;
  const dist = Math.hypot(dx, dy);
  const radius = getJoystickRadius();
  if (dist < 1 || radius <= 0) {
    joystickScreenDir = null;
    joystickPower = 0;
    joystickHasAim = false;
  } else {
    joystickScreenDir = { x: dx / dist, y: dy / dist };
    joystickPower = Math.min(1, dist / radius);
    joystickHasAim = joystickPower >= JOYSTICK_DEADZONE;
  }
  updateJoystickKnobVisual();
  updateFireControlUi();
  renderScene();
};

const onJoystickPointerDown = (event: PointerEvent): void => {
  if (fireControlMode !== 'joystick' || !engine.canPlayerAct()) {
    return;
  }
  if (currentMode === 'online' && (onlineStatus !== 'matched' || onlinePendingAction)) {
    return;
  }
  event.preventDefault();
  joystickPointerId = event.pointerId;
  joystickPad.classList.add('is-active');
  try {
    joystickPad.setPointerCapture(event.pointerId);
  } catch (error) {
    // ignore capture errors
  }
  updateJoystickFromPointer(event);
};

const onJoystickPointerMove = (event: PointerEvent): void => {
  if (joystickPointerId === null || event.pointerId !== joystickPointerId) {
    return;
  }
  event.preventDefault();
  updateJoystickFromPointer(event);
};

// Stop tracking the joystick pointer and refresh the UI. The aim itself is
// retained so the player can review it before committing with the Fire button.
const finishJoystickPointer = (): void => {
  joystickPointerId = null;
  joystickPad.classList.remove('is-active');
  updateJoystickKnobVisual();
  updateFireControlUi();
  renderScene();
};

const endJoystickPointer = (event: PointerEvent): void => {
  if (joystickPointerId === null || event.pointerId !== joystickPointerId) {
    return;
  }
  try {
    joystickPad.releasePointerCapture(event.pointerId);
  } catch (error) {
    // ignore release errors
  }
  finishJoystickPointer();
};

// If the pad is disabled mid-drag (e.g. the turn ends or an online opponent
// leaves), pointer-events:none implicitly releases capture and fires
// lostpointercapture instead of pointerup/pointercancel — clean up so the
// joystick can't get stuck in an active state.
const onJoystickLostCapture = (event: PointerEvent): void => {
  if (joystickPointerId === null || event.pointerId !== joystickPointerId) {
    return;
  }
  finishJoystickPointer();
};

const submitJoystickAction = (): void => {
  if (fireControlMode !== 'joystick') {
    return;
  }
  const actionVector = getJoystickActionVector();
  if (!actionVector) {
    return;
  }
  if (currentMode === 'online') {
    if (onlineStatus !== 'matched') {
      return;
    }
    const client = onlineClient ?? ensureOnlineClient();
    const team = onlineTeam ?? engine.getPlayerTeam();
    const action = engine.createActionFromVector(actionVector);
    if (!action || !client) {
      return;
    }
    onlinePendingAction = true;
    refreshOnlineReadyState();
    client.submitAction(action, team);
    resetJoystickAim();
    updateFireControlUi();
    return;
  }
  engine.beginPlayerAction(actionVector);
  resetJoystickAim();
  updateFireControlUi();
};

updateUi(currentState);
renderScene();
updateZoomUi();
updateFullscreenUi();
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange as EventListener);
document.addEventListener('fullscreenerror', () => {
  if (!isNativeBoardFullscreen() && !pseudoFullscreenActive) {
    enterPseudoFullscreen();
  }
});
document.addEventListener('webkitfullscreenerror', (() => {
  if (!isNativeBoardFullscreen() && !pseudoFullscreenActive) {
    enterPseudoFullscreen();
  }
}) as EventListener);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && pseudoFullscreenActive && !isNativeBoardFullscreen()) {
    exitPseudoFullscreen();
  }
});

const handleViewportResize = () => {
  if (!isBoardFullscreen()) {
    updateJoystickKnobVisual();
    return;
  }
  updateFullscreenSizing();
  renderer.refreshViewport();
  updateJoystickKnobVisual();
  renderScene();
};

window.addEventListener('resize', handleViewportResize);
window.addEventListener('orientationchange', handleViewportResize);
window.visualViewport?.addEventListener('resize', handleViewportResize);
window.visualViewport?.addEventListener('scroll', handleViewportResize);

fullscreenButton.addEventListener('click', () => {
  if (isBoardFullscreen()) {
    void exitBoardFullscreen();
  } else {
    void requestBoardFullscreen();
  }
});

const ensureOnlineClient = (): OnlineMatchClient => {
  if (onlineClient) {
    return onlineClient;
  }
  onlineClient = new OnlineMatchClient({
    onStatusChange: (status, message) => {
      onlineStatus = status;
      onlineStatusMessage = message;
      if (status !== 'matched') {
        onlinePendingAction = false;
        onlineReadyTurn = -1;
        lastReportedTurn = -1;
        onlineAwaitingSyncApply = false;
        pendingOnlineStateSync = null;
        refreshOnlineReadyState();
      } else {
        refreshOnlineReadyState();
      }
      updateUi(currentState);
    },
    onMatchFound: ({ matchId, team, mapId }) => {
      onlineTeam = team;
      onlinePendingAction = false;
      onlineReadyTurn = -1;
      lastReportedTurn = -1;
      onlineAwaitingSyncApply = false;
      pendingOnlineStateSync = null;
      const map = getMapById(mapId);
      if (currentMap.id !== map.id) {
        currentMap = map;
        renderer.setMap(currentMap);
        mapSelect.value = currentMap.id;
        applyStageAspect(currentMap);
        updateZoomUi();
      }
      onlineStatusMessage = team === 0 ? 'You go first.' : 'Opponent goes first.';
      engine.setPlayerTeam(team);
      engine.startNewGame(currentMap, 'online', team);
      refreshOnlineReadyState();
    },
    onActionReceived: (action, team) => {
      onlinePendingAction = false;
      engine.beginNetworkAction(action, team);
      refreshOnlineReadyState();
    },
    onStateSync: (turn, stateJson) => {
      try {
        const parsed = JSON.parse(stateJson) as GameState;
        if (currentState.mode === 'online' && currentState.phase === 'animating') {
          pendingOnlineStateSync = { turn, state: parsed };
          onlineAwaitingSyncApply = true;
          onlineStatusMessage = 'Syncing turn…';
        } else {
          onlineAwaitingSyncApply = false;
          pendingOnlineStateSync = null;
          engine.syncOnlineState(parsed, turn);
        }
      } catch (error) {
        onlineStatusMessage = 'Failed to sync match state';
      }
      refreshOnlineReadyState();
      updateUi(currentState);
    },
    onTurnReady: (turn) => {
      onlineReadyTurn = Math.max(onlineReadyTurn, turn);
      refreshOnlineReadyState();
      updateUi(currentState);
    },
    onSyncError: (message) => {
      onlineStatusMessage = message;
      onlinePendingAction = false;
      refreshOnlineReadyState();
      updateUi(currentState);
    },
    onOpponentLeft: () => {
      onlinePendingAction = false;
      onlineReadyTurn = -1;
      onlineAwaitingSyncApply = false;
      pendingOnlineStateSync = null;
      refreshOnlineReadyState();
      updateUi(currentState);
    },
  });
  return onlineClient;
};

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
  resetJoystickAim();
  updateFireControlUi();
  stopPan();
  if (currentMode === 'online') {
    const client = ensureOnlineClient();
    if (onlineStatus === 'queued' || onlineStatus === 'connecting') {
      client.cancelQueue();
    } else {
      if (onlineStatus === 'matched') {
        client.leaveMatch();
      }
      onlineReadyTurn = -1;
      lastReportedTurn = -1;
      onlineAwaitingSyncApply = false;
      pendingOnlineStateSync = null;
      refreshOnlineReadyState();
      client.queueForMatch(currentMap.id);
    }
    return;
  }
  engine.startNewGame(currentMap, currentMode);
});

mapSelect.addEventListener('change', () => {
  currentMap = getMapById(mapSelect.value);
  renderer.setMap(currentMap);
  applyStageAspect(currentMap);
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
  resetJoystickAim();
  stopPan();
  updateZoomUi();
  updateFireControlUi();
  if (currentMode === 'online') {
    const client = ensureOnlineClient();
    if (onlineStatus === 'matched') {
      client.leaveMatch();
    } else if (onlineStatus === 'queued' || onlineStatus === 'connecting') {
      client.cancelQueue();
    }
    onlineReadyTurn = -1;
    lastReportedTurn = -1;
    onlineAwaitingSyncApply = false;
    pendingOnlineStateSync = null;
    refreshOnlineReadyState();
    return;
  }
  engine.startNewGame(currentMap, currentMode);
});

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.dataset.mode as GameMode | undefined;
    if (!mode || mode === currentMode) return;
    if (mode !== 'online' && currentMode === 'online') {
      onlineClient?.disconnect();
      onlineClient = null;
      onlineStatus = 'idle';
      onlineStatusMessage = undefined;
      onlineTeam = null;
      onlinePendingAction = false;
      onlineReadyTurn = -1;
      lastReportedTurn = -1;
      onlineAwaitingSyncApply = false;
      pendingOnlineStateSync = null;
      refreshOnlineReadyState();
    }
    currentMode = mode;
    setActiveModeButton(mode);
    if (mode === 'online') {
      ensureOnlineClient();
      onlineReadyTurn = -1;
      lastReportedTurn = -1;
      onlineAwaitingSyncApply = false;
      pendingOnlineStateSync = null;
      refreshOnlineReadyState();
      engine.startNewGame(currentMap, currentMode);
    } else {
      engine.startNewGame(currentMap, currentMode);
    }
  });
});

const cancelActiveDrag = () => {
  if (!isDragging) {
    return;
  }
  const pointerId = dragPointerId;
  isDragging = false;
  dragPointerId = null;
  dragOrigin = null;
  dragCurrent = null;
  dragVector = null;
  if (pointerId !== null) {
    try {
      canvas.releasePointerCapture(pointerId);
    } catch (error) {
      // ignore release errors
    }
  }
  renderScene();
  updateFireControlUi();
};

const beginPinchGesture = () => {
  if (pinchState || !isBoardFullscreen() || activeTouchPointers.size !== 2) {
    return;
  }
  const entries = Array.from(activeTouchPointers.entries());
  const [firstEntry, secondEntry] = entries;
  if (!firstEntry || !secondEntry) {
    return;
  }
  const [firstId, firstPosition] = firstEntry;
  const [secondId, secondPosition] = secondEntry;
  const distance = Math.hypot(firstPosition.clientX - secondPosition.clientX, firstPosition.clientY - secondPosition.clientY);
  if (!Number.isFinite(distance) || distance <= 0) {
    return;
  }
  stopPan();
  cancelActiveDrag();
  const center = {
    x: (firstPosition.clientX + secondPosition.clientX) / 2,
    y: (firstPosition.clientY + secondPosition.clientY) / 2,
  };
  pinchState = {
    pointerIds: [firstId, secondId],
    initialDistance: distance,
    initialZoom: renderer.getZoom(),
    lastCenterClient: center,
  };
  try {
    canvas.setPointerCapture(firstId);
  } catch (error) {
    // ignore capture errors
  }
  try {
    canvas.setPointerCapture(secondId);
  } catch (error) {
    // ignore capture errors
  }
};

const updatePinchGesture = () => {
  if (!pinchState) {
    return;
  }
  const [firstId, secondId] = pinchState.pointerIds;
  const first = activeTouchPointers.get(firstId);
  const second = activeTouchPointers.get(secondId);
  if (!first || !second || activeTouchPointers.size !== 2) {
    if (!first || !second) {
      clearPinchState();
    }
    return;
  }
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return;
  }
  const centerClient = {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
  const deltaClientX = centerClient.x - pinchState.lastCenterClient.x;
  const deltaClientY = centerClient.y - pinchState.lastCenterClient.y;
  if (deltaClientX !== 0 || deltaClientY !== 0) {
    renderer.panBy(clientDeltaToWorldDelta(deltaClientX, deltaClientY));
  }
  const initialDistance = pinchState.initialDistance;
  if (initialDistance > 0) {
    const currentDistance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    if (Number.isFinite(currentDistance) && currentDistance > 0) {
      const factor = currentDistance / initialDistance;
      const anchor = toWorldPointFromClient(centerClient.x, centerClient.y);
      renderer.setZoom(pinchState.initialZoom * factor, anchor);
    }
  }
  pinchState.lastCenterClient = centerClient;
  renderScene();
  updateZoomUi();
};

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
  const deltaX = event.clientX - panLast.x;
  const deltaY = event.clientY - panLast.y;
  const worldDelta = clientDeltaToWorldDelta(deltaX, deltaY);
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
  if (event.pointerType === 'touch') {
    if (isBoardFullscreen() && activeTouchPointers.size >= 2) {
      // ignore additional touches beyond the first two while fullscreen pinch is active
    } else {
      activeTouchPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    }
    if (pinchState) {
      event.preventDefault();
      return;
    }
    if (isBoardFullscreen() && activeTouchPointers.size === 2) {
      beginPinchGesture();
      event.preventDefault();
      return;
    }
  }
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
  if (fireControlMode === 'joystick') {
    // Aiming happens on the joystick pad; the board itself only pans.
    event.preventDefault();
    beginPan(event);
    return;
  }

  if (currentMode === 'online' && onlinePendingAction) {
    event.preventDefault();
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
  if (event.pointerType === 'touch') {
    if (pinchState && pinchState.pointerIds.includes(event.pointerId)) {
      activeTouchPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      event.preventDefault();
      updatePinchGesture();
      return;
    }
    if (isBoardFullscreen()) {
      activeTouchPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    }
  }
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
  if (cancel) {
    return;
  }
  if (currentMode === 'online') {
    if (onlineStatus !== 'matched') {
      return;
    }
    const client = onlineClient ?? ensureOnlineClient();
    const team = onlineTeam ?? engine.getPlayerTeam();
    const action = engine.createActionFromVector(actionVector);
    if (!action || !client) {
      return;
    }
    onlinePendingAction = true;
    refreshOnlineReadyState();
    client.submitAction(action, team);
    updateFireControlUi();
    return;
  }
  engine.beginPlayerAction(actionVector);
  updateFireControlUi();
};

canvas.addEventListener('pointerup', (event) => {
  if (event.pointerType === 'touch') {
    event.preventDefault();
    activeTouchPointers.delete(event.pointerId);
    if (pinchState && pinchState.pointerIds.includes(event.pointerId)) {
      clearPinchState();
      renderScene();
      updateZoomUi();
      return;
    }
  }
  if (isPanning && event.pointerId === panPointerId) {
    stopPan();
    return;
  }
  endDrag(event);
});

canvas.addEventListener('pointercancel', (event) => {
  if (event.pointerType === 'touch') {
    event.preventDefault();
    activeTouchPointers.delete(event.pointerId);
    if (pinchState && pinchState.pointerIds.includes(event.pointerId)) {
      clearPinchState();
      renderScene();
      updateZoomUi();
      return;
    }
  }
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

fireModeToggle.addEventListener('click', () => {
  fireControlMode = fireControlMode === 'drag' ? 'joystick' : 'drag';
  joystickCollapsed = false;
  cancelActiveDrag();
  resetJoystickAim();
  updateFireControlUi();
  renderScene();
});

joystickPad.addEventListener('pointerdown', onJoystickPointerDown);
joystickPad.addEventListener('pointermove', onJoystickPointerMove);
joystickPad.addEventListener('pointerup', endJoystickPointer);
joystickPad.addEventListener('pointercancel', endJoystickPointer);
joystickPad.addEventListener('lostpointercapture', onJoystickLostCapture);
joystickFireButton.addEventListener('click', () => {
  submitJoystickAction();
});
joystickCollapseButton.addEventListener('click', () => {
  joystickCollapsed = true;
  updateFireControlUi();
  renderScene();
});
joystickReopenButton.addEventListener('click', () => {
  joystickCollapsed = false;
  updateFireControlUi();
  updateJoystickKnobVisual();
  renderScene();
});

function toWorldPoint(event: PointerEvent | WheelEvent): Vector {
  return toWorldPointFromClient(event.clientX, event.clientY);
}

function toWorldPointFromClient(clientX: number, clientY: number): Vector {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0 };
  }
  const offset = renderer.getOffset();
  const view = renderer.getViewSize();
  let ratioX: number;
  let ratioY: number;
  if (boardRotated) {
    // The canvas is CSS-rotated 90deg clockwise about its centre. Undo that to
    // recover unrotated local coordinates. For a 90deg rotation the on-screen
    // bounding box is (unrotatedHeight x unrotatedWidth), so unrotated width
    // equals rect.height and unrotated height equals rect.width.
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const sx = clientX - centerX;
    const sy = clientY - centerY;
    const localX = sy; // inverse of 90deg cw: localX = screenY
    const localY = -sx; //                     localY = -screenX
    const unrotatedWidth = rect.height;
    const unrotatedHeight = rect.width;
    ratioX = (localX + unrotatedWidth / 2) / unrotatedWidth;
    ratioY = (localY + unrotatedHeight / 2) / unrotatedHeight;
  } else {
    ratioX = (clientX - rect.left) / rect.width;
    ratioY = (clientY - rect.top) / rect.height;
  }
  return {
    x: offset.x + view.x * ratioX,
    y: offset.y + view.y * ratioY,
  };
}

// Convert a screen-space pointer delta into a world-space pan delta, accounting
// for board rotation. Preserves the existing sign convention (drag content to
// follow the pointer).
function clientDeltaToWorldDelta(deltaClientX: number, deltaClientY: number): Vector {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0 };
  }
  const view = renderer.getViewSize();
  if (boardRotated) {
    const localDX = deltaClientY;
    const localDY = -deltaClientX;
    const unrotatedWidth = rect.height;
    const unrotatedHeight = rect.width;
    return {
      x: (-localDX / unrotatedWidth) * view.x,
      y: (-localDY / unrotatedHeight) * view.y,
    };
  }
  return {
    x: (-deltaClientX / rect.width) * view.x,
    y: (-deltaClientY / rect.height) * view.y,
  };
}

// Rotate a screen-space direction into world space. World x/y share a uniform
// pixel scale, so only the rotation matters (no anisotropic scaling).
function rotateScreenVectorToWorld(vector: Vector): Vector {
  if (!boardRotated) {
    return { ...vector };
  }
  return { x: vector.y, y: -vector.x };
}

function updateUi(state: GameState): void {
  applyAimResetForTurn(state);
  const activeUnit = getActiveUnit(state);
  roundLabel.textContent = `Round ${state.round}`;
  setActiveModeButton(state.mode);
  const localTeam: TeamId = state.mode === 'online' ? onlineTeam ?? engine.getPlayerTeam() : 0;

  let phaseText = '';
  if (state.mode === 'online') {
    const lockMap = ['connecting', 'queued', 'matched'] as const;
    mapSelect.disabled = lockMap.includes(onlineStatus);
    restartButton.textContent =
      onlineStatus === 'queued' || onlineStatus === 'connecting'
        ? 'Cancel Search'
        : onlineStatus === 'matched'
        ? 'Start New Match'
        : 'Find Match';
    if (state.winner !== null) {
      phaseText =
        state.winner === 'draw'
          ? 'Draw'
          : state.winner === localTeam
          ? 'You win!'
          : 'Opponent wins!';
    } else if (onlineStatus !== 'matched') {
      switch (onlineStatus) {
        case 'connecting':
          phaseText = 'Connecting…';
          break;
        case 'queued':
          phaseText = 'Searching for opponent…';
          break;
        case 'opponent-left':
          phaseText = 'Opponent disconnected';
          break;
        case 'disconnected':
          phaseText = 'Connection lost';
          break;
        case 'error':
          phaseText = onlineStatusMessage ?? 'Matchmaking error';
          break;
        default:
          phaseText = 'Find an opponent to begin';
          break;
      }
    } else if (state.phase === 'aim') {
      if (!engine.canPlayerAct() && state.activeTeam === localTeam) {
        phaseText = 'Syncing positions…';
      } else {
        phaseText = state.activeTeam === localTeam ? 'Your turn' : 'Opponent turn';
      }
    } else if (state.phase === 'animating') {
      phaseText = 'Resolving';
    }
  } else {
    mapSelect.disabled = false;
    restartButton.textContent = 'Start New Game';
    if (state.winner !== null) {
      phaseText =
        state.winner === 'draw'
          ? 'Draw'
          : state.winner === 0
          ? 'Team One Wins!'
          : state.mode === 'bot'
          ? 'Bot Wins!'
          : 'Team Two Wins!';
    } else if (state.phase === 'aim') {
      if (state.mode === 'hotseat') {
        phaseText = state.activeTeam === 0 ? 'Team One: Aim' : 'Team Two: Aim';
      } else {
        phaseText = state.activeTeam === 0 ? 'Your turn' : 'Bot turn';
      }
    } else if (state.phase === 'bot-planning') {
      phaseText = 'Bot planning';
    } else if (state.phase === 'animating') {
      phaseText = 'Resolving';
    }
  }
  phaseLabel.textContent = phaseText;

  const activeId = activeUnit?.id ?? null;
  updateUnitList(playerList, state, 0, activeId);
  updateUnitList(botList, state, 1, activeId);

  if (state.mode === 'hotseat') {
    playerHeading.textContent = 'Team One';
    opponentHeading.textContent = 'Team Two';
  } else if (state.mode === 'online') {
    playerHeading.textContent = 'You';
    opponentHeading.textContent = 'Opponent';
  } else {
    playerHeading.textContent = 'Your Squad';
    opponentHeading.textContent = 'Bot Squad';
  }

  updateFireControlUi();
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
updateFireControlUi();
