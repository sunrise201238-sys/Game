import { DEFAULT_MAP_ID, MAPS, getMapById } from './config';
import { GameEngine } from './engine';
import { OnlineMatchClient } from './online';
import { registerOfflineSupport } from './pwa';
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
const boardControls = document.querySelector('.board-controls') as HTMLDivElement | null;
const body = document.body as HTMLBodyElement;
const fullscreenButton = document.getElementById('fullscreen-toggle') as HTMLButtonElement;
const fireModeToggle = document.getElementById('fire-mode-toggle') as HTMLButtonElement;
const fireControls = document.getElementById('fire-controls') as HTMLDivElement;
const joystickPanel = document.getElementById('joystick-panel') as HTMLDivElement;
const joystickBar = document.getElementById('joystick-bar') as HTMLDivElement;
const joystickDragHandle = document.getElementById('joystick-drag-handle') as HTMLDivElement;
const joystickPad = document.getElementById('joystick-pad') as HTMLDivElement;
const joystickKnob = document.getElementById('joystick-knob') as HTMLDivElement;
const joystickDirectionValue = document.getElementById('joystick-direction') as HTMLSpanElement;
const joystickPowerValue = document.getElementById('joystick-power') as HTMLSpanElement;
const joystickFireButton = document.getElementById('joystick-fire-btn') as HTMLButtonElement;
const joystickDirDecButton = document.getElementById('joystick-dir-dec') as HTMLButtonElement;
const joystickDirIncButton = document.getElementById('joystick-dir-inc') as HTMLButtonElement;
const joystickPowDecButton = document.getElementById('joystick-pow-dec') as HTMLButtonElement;
const joystickPowIncButton = document.getElementById('joystick-pow-inc') as HTMLButtonElement;
const ZOOM_STEP = 1.2;
const DRAG_INPUT_MULTIPLIER = 1.35;
// Rotating the landscape board into a portrait viewport. 90deg clockwise so the
// board's top edge points to the right of the device held upright.
const BOARD_ROTATION_DEG = 90;
// Joystick travel below this fraction of the pad radius is treated as "no aim".
const JOYSTICK_DEADZONE = 0.08;
// Once an aim is set, fine nudges can take power this low and still fire. The
// archer projectile flies at full range for any power > 0; power only controls
// how far the unit itself recoils, so a tiny value is a near-stationary shot.
const MIN_FIRE_POWER = 0.01;
// Fine-adjust step sizes (per tap; hold-to-repeat applies them rapidly).
const JOYSTICK_ANGLE_STEP_DEG = 1;
const JOYSTICK_POWER_STEP = 0.01;
// When the direction is nudged while power is still zero, give power this small
// starting value so the aim line "wakes up" (the two halves can't both be 0).
const JOYSTICK_WAKE_POWER = 0.1;
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
// Joystick is the only fire-control mode now; the drag-mode code paths remain in
// place but are unreachable (kept for reference rather than deleted).
let fireControlMode: FireControlMode = 'joystick';
let boardRotated = false;
// Aim state. aimDir is a normalized WORLD-space launch direction (toward the
// target) and joystickPower is 0..1 of the unit's maxPower. World-space keeps
// the aim stable if the board rotates mid-aim.
let aimDir: Vector | null = null;
let joystickPower = 0;
let joystickHasAim = false;
let joystickPointerId: number | null = null;
// Direct drag-to-aim: grab the active dot and drag; the dot lands at the finger.
let isAiming = false;
let aimPointerId: number | null = null;
const AIM_GRAB_SCREEN_PADDING = 26;

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

// In pseudo-fullscreen the stage is position:fixed. On iOS a fixed inset:0 box
// (and 100dvh) can extend past the *visible* viewport when browser chrome is
// shown, pushing the centred board down and the bottom controls off-screen.
// Pin the stage to the actual visualViewport so everything stays in frame.
const applyPseudoFullscreenViewport = () => {
  if (!boardStage) {
    return;
  }
  if (!pseudoFullscreenActive) {
    boardStage.style.removeProperty('top');
    boardStage.style.removeProperty('left');
    boardStage.style.removeProperty('right');
    boardStage.style.removeProperty('bottom');
    boardStage.style.removeProperty('width');
    boardStage.style.removeProperty('height');
    return;
  }
  const vv = window.visualViewport;
  const width = Math.max(1, vv?.width ?? window.innerWidth);
  const height = Math.max(1, vv?.height ?? window.innerHeight);
  boardStage.style.top = `${vv?.offsetTop ?? 0}px`;
  boardStage.style.left = `${vv?.offsetLeft ?? 0}px`;
  boardStage.style.right = 'auto';
  boardStage.style.bottom = 'auto';
  boardStage.style.width = `${width}px`;
  boardStage.style.height = `${height}px`;
};

const updateFullscreenSizing = () => {
  if (!boardStage) {
    return;
  }
  applyPseudoFullscreenViewport();
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
// JS-mode anchored popup: tap the active dot to open the joystick beside it.
let joystickPopupOpen = false;
let dotTapPointerId: number | null = null;
let dotTapStartClient: { x: number; y: number } | null = null;
// When the player drags the popup by its handle, remember that position (kept
// within the turn) so auto-placement doesn't override it.
let joystickManualPos: { left: number; top: number } | null = null;
let popupDragPointerId: number | null = null;
let popupDragStart: { pointerX: number; pointerY: number; left: number; top: number } | null = null;
const DOT_TAP_SCREEN_PADDING = 22;
const DOT_TAP_MOVE_THRESHOLD = 8;
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
  // Direct aim: the line is drawn straight to the predicted landing (skip the
  // slingshot curve) so the dot stops under the pointer. Magnifier removed.
  const aimPreview = getAimPreviewLine();
  renderer.render(currentState, {
    dragOrigin: aimPreview?.origin ?? null,
    dragCurrent: aimPreview?.current ?? null,
    skipAimCurve: true,
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
  if (joystickPopupOpen) {
    positionJoystickPopup();
  }
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
  if (aimDir && joystickPower > 0 && radius > 0) {
    const travel = Math.min(1, joystickPower) * radius;
    knobX = aimDir.x * travel;
    knobY = aimDir.y * travel;
  }
  joystickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
  joystickPad.classList.toggle('is-aimed', joystickHasAim && joystickPower >= JOYSTICK_DEADZONE);
};

const resetJoystickAim = (): void => {
  aimDir = null;
  joystickPower = 0;
  joystickHasAim = false;
  updateJoystickKnobVisual();
};

// A sensible starting aim (world-space launch direction) when the player uses
// the fine-tune buttons before dragging: aim toward the enemy.
const defaultAimDirWorld = (): Vector | null => {
  const activeUnit = getActiveUnit(currentState);
  if (!activeUnit) {
    return null;
  }
  const enemies = currentState.units.filter((u) => u.alive && u.team !== activeUnit.team);
  let target: Vector;
  if (enemies.length) {
    target = {
      x: enemies.reduce((s, u) => s + u.position.x, 0) / enemies.length,
      y: enemies.reduce((s, u) => s + u.position.y, 0) / enemies.length,
    };
  } else {
    target = { x: currentMap.width / 2, y: currentMap.height / 2 };
  }
  const launch = { x: target.x - activeUnit.position.x, y: target.y - activeUnit.position.y };
  const len = Math.hypot(launch.x, launch.y);
  // Fall back to a fixed non-zero direction if the target coincides with the unit.
  return len > 1e-3 ? { x: launch.x / len, y: launch.y / len } : { x: 0, y: -1 };
};

// Ensure a direction exists so the fine-tune buttons can wake the aim from zero.
const ensureJoystickDirection = (): boolean => {
  if (aimDir) {
    return true;
  }
  const dir = defaultAimDirWorld();
  if (!dir) {
    return false;
  }
  aimDir = dir;
  return true;
};

// Fine-tune the aim. Rotating the knob direction keeps power fixed and
// vice-versa, so the angle and power are independently adjustable — restoring
// the precise low-power control the dual-lever used to give (e.g. archers).
const nudgeJoystickAngle = (deltaDeg: number): void => {
  if (!ensureJoystickDirection() || !aimDir) {
    return;
  }
  // Nudging direction while power is ~0 wakes the aim with a small power so the
  // line shows (otherwise a direction with zero power is still no aim).
  if (joystickPower < MIN_FIRE_POWER) {
    joystickPower = JOYSTICK_WAKE_POWER;
  }
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { x, y } = aimDir;
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;
  const len = Math.hypot(rx, ry) || 1;
  aimDir = { x: rx / len, y: ry / len };
  joystickHasAim = joystickPower >= MIN_FIRE_POWER;
  updateJoystickKnobVisual();
  updateFireControlUi();
  renderScene();
};

const nudgeJoystickPower = (delta: number): void => {
  if (!ensureJoystickDirection()) {
    return;
  }
  joystickPower = Math.max(0, Math.min(1, joystickPower + delta));
  joystickHasAim = joystickPower >= MIN_FIRE_POWER;
  updateJoystickKnobVisual();
  updateFireControlUi();
  renderScene();
};

const getJoystickActionVector = (): Vector | null => {
  if (!engine.canPlayerAct()) {
    return null;
  }
  if (!joystickHasAim || !aimDir || joystickPower < MIN_FIRE_POWER) {
    return null;
  }
  const activeUnit = getActiveUnit(currentState);
  if (!activeUnit) {
    return null;
  }
  const magnitude = activeUnit.def.maxPower * Math.min(1, joystickPower);
  // Direct aim: launch straight along the world-space aim direction.
  return {
    x: aimDir.x * magnitude,
    y: aimDir.y * magnitude,
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

// Direct aim: set the launch so the active unit's predicted landing is exactly
// the pointer position (capped at the unit's maximum reach). Power is inverted
// from the travel-distance model so the dot stops under the finger.
const updateDirectAim = (event: PointerEvent): void => {
  const activeUnit = getActiveUnit(currentState);
  if (!activeUnit) {
    return;
  }
  const target = toWorldPoint(event);
  const dx = target.x - activeUnit.position.x;
  const dy = target.y - activeUnit.position.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-3 || activeUnit.def.maxPower <= 0) {
    aimDir = null;
    joystickPower = 0;
    joystickHasAim = false;
  } else {
    aimDir = { x: dx / dist, y: dy / dist };
    const maxReach = renderer.estimateTravelDistance(activeUnit.def.maxPower);
    const cappedDist = Math.min(dist, maxReach);
    const power = renderer.powerForTravelDistance(cappedDist, activeUnit.def.maxPower);
    joystickPower = Math.min(1, power / activeUnit.def.maxPower);
    joystickHasAim = joystickPower >= MIN_FIRE_POWER;
  }
  updateFireControlUi();
  renderScene();
};

const endAiming = (): void => {
  if (!isAiming) {
    return;
  }
  const pointerId = aimPointerId;
  isAiming = false;
  aimPointerId = null;
  if (pointerId !== null) {
    try {
      canvas.releasePointerCapture(pointerId);
    } catch (error) {
      // ignore release errors
    }
  }
  // Aim is retained on release; fine-tune / fire from the permanent bar.
  updateFireControlUi();
  renderScene();
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
  // Each new turn starts with the popup closed and auto-placement restored;
  // tap the new active dot to aim.
  joystickPopupOpen = false;
  joystickPanel.hidden = true;
  joystickManualPos = null;
};

function updateFireControlUi(): void {
  const joystickMode = fireControlMode === 'joystick';
  boardStage.classList.toggle('board-stage--joystick-mode', joystickMode);
  fireModeToggle.textContent = joystickMode ? 'Mode: Joystick' : 'Mode: Drag';
  fireModeToggle.setAttribute('aria-pressed', joystickMode ? 'true' : 'false');
  const canAct = engine.canPlayerAct();
  // The readout, fine-tune and Fire live in a permanent bar outside the map,
  // always visible in JS mode. Only the pad floats in the anchored popup.
  joystickBar.hidden = !joystickMode;
  joystickPanel.hidden = !(joystickMode && joystickPopupOpen);
  // Show the launch direction (where the dot will travel).
  let launchAngle = 0;
  if (aimDir) {
    const deg = (Math.atan2(aimDir.y, aimDir.x) * 180) / Math.PI;
    launchAngle = ((Math.round(deg) % 360) + 360) % 360;
  }
  joystickDirectionValue.textContent = `${launchAngle}°`;
  joystickPowerValue.textContent = `${Math.round(Math.min(1, joystickPower) * 100)}%`;
  const actionReady = Boolean(getJoystickActionVector());
  const onlineBlocked = currentMode === 'online' && (onlineStatus !== 'matched' || onlinePendingAction);
  fireModeToggle.disabled = currentMode === 'online' && onlineStatus !== 'matched';
  joystickPad.classList.toggle('is-disabled', !joystickMode || !canAct || onlineBlocked);
  joystickFireButton.disabled = !joystickMode || !actionReady || onlineBlocked;
  // Fine nudges are usable any time it's your turn — they seed a default aim
  // (direction toward the enemy + a small power) so the line activates on its own.
  const nudgeDisabled = !joystickMode || !canAct || onlineBlocked;
  joystickDirDecButton.disabled = nudgeDisabled;
  joystickDirIncButton.disabled = nudgeDisabled;
  joystickPowDecButton.disabled = nudgeDisabled;
  joystickPowIncButton.disabled = nudgeDisabled;
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
    aimDir = null;
    joystickPower = 0;
    joystickHasAim = false;
  } else {
    aimDir = { x: dx / dist, y: dy / dist };
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
    renderScene();
    return;
  }
  engine.beginPlayerAction(actionVector);
  resetJoystickAim();
  updateFireControlUi();
  renderScene();
};

// Place the popup beside the active dot, preferring open space: try several
// anchor sides, keep it on-screen, and penalise covering dots / the controls /
// the firing direction toward the enemy.
const positionJoystickPopup = (): void => {
  if (!joystickPopupOpen) {
    return;
  }
  const activeUnit = getActiveUnit(currentState);
  if (!activeUnit) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return;
  }
  const pw = joystickPanel.offsetWidth || 200;
  const ph = joystickPanel.offsetHeight || 240;
  const vv = window.visualViewport;
  const vLeft = vv?.offsetLeft ?? 0;
  const vTop = vv?.offsetTop ?? 0;
  const vw = vv?.width ?? window.innerWidth;
  const vh = vv?.height ?? window.innerHeight;
  const margin = 8;
  const minX = vLeft + margin;
  const maxX = Math.max(minX, vLeft + vw - pw - margin);
  const minY = vTop + margin;
  const maxY = Math.max(minY, vTop + vh - ph - margin);

  // If the player dragged the popup, honour that position (just keep it
  // on-screen) instead of re-running the automatic placement.
  if (joystickManualPos) {
    const left = Math.min(Math.max(joystickManualPos.left, minX), maxX);
    const top = Math.min(Math.max(joystickManualPos.top, minY), maxY);
    joystickManualPos = { left, top };
    joystickPanel.style.left = `${left}px`;
    joystickPanel.style.top = `${top}px`;
    return;
  }

  const dot = worldToClient(activeUnit.position);
  const view = renderer.getViewSize();
  const scale = (boardRotated ? rect.height : rect.width) / view.x;
  const gap = activeUnit.def.radius * scale + 18;

  const obstacles = currentState.units.filter((u) => u.alive).map((u) => worldToClient(u.position));
  const controlsRect = isBoardFullscreen() ? boardControls?.getBoundingClientRect() ?? null : null;

  const enemies = currentState.units
    .filter((u) => u.alive && u.team !== activeUnit.team)
    .map((u) => worldToClient(u.position));
  let enemyUnit = { x: 0, y: 0 };
  if (enemies.length) {
    const ecx = enemies.reduce((s, p) => s + p.x, 0) / enemies.length;
    const ecy = enemies.reduce((s, p) => s + p.y, 0) / enemies.length;
    const len = Math.hypot(ecx - dot.x, ecy - dot.y) || 1;
    enemyUnit = { x: (ecx - dot.x) / len, y: (ecy - dot.y) / len };
  }

  const candidates = [
    { x: dot.x + gap, y: dot.y - ph / 2 },
    { x: dot.x - gap - pw, y: dot.y - ph / 2 },
    { x: dot.x - pw / 2, y: dot.y + gap },
    { x: dot.x - pw / 2, y: dot.y - gap - ph },
    { x: dot.x + gap, y: dot.y + gap },
    { x: dot.x - gap - pw, y: dot.y + gap },
    { x: dot.x + gap, y: dot.y - gap - ph },
    { x: dot.x - gap - pw, y: dot.y - gap - ph },
  ];

  let best = { x: Math.min(Math.max(dot.x + gap, minX), maxX), y: Math.min(Math.max(dot.y, minY), maxY) };
  let bestScore = Infinity;
  for (const cand of candidates) {
    const x = Math.min(Math.max(cand.x, minX), maxX);
    const y = Math.min(Math.max(cand.y, minY), maxY);
    const l = x;
    const t = y;
    const r = x + pw;
    const b = y + ph;
    let score = 0;
    for (const o of obstacles) {
      if (o.x >= l && o.x <= r && o.y >= t && o.y <= b) {
        score += o.x === dot.x && o.y === dot.y ? 400 : 100;
      }
    }
    if (controlsRect && !(r < controlsRect.left || l > controlsRect.right || b < controlsRect.top || t > controlsRect.bottom)) {
      score += 250;
    }
    score += (Math.abs(x - cand.x) + Math.abs(y - cand.y)) * 0.15;
    const cx = x + pw / 2 - dot.x;
    const cy = y + ph / 2 - dot.y;
    const clen = Math.hypot(cx, cy) || 1;
    const towardEnemy = (cx / clen) * enemyUnit.x + (cy / clen) * enemyUnit.y;
    score += Math.max(0, towardEnemy) * 40;
    if (score < bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  joystickPanel.style.left = `${best.x}px`;
  joystickPanel.style.top = `${best.y}px`;
};

const openJoystickPopup = (): void => {
  if (fireControlMode !== 'joystick' || !engine.canPlayerAct()) {
    return;
  }
  if (currentMode === 'online' && (onlineStatus !== 'matched' || onlinePendingAction)) {
    return;
  }
  if (!getActiveUnit(currentState)) {
    return;
  }
  // Keep any retained aim so re-opening the pad resumes where you left off.
  joystickPopupOpen = true;
  updateFireControlUi(); // reveals the popup so it can be measured
  positionJoystickPopup();
  updateJoystickKnobVisual();
  renderScene();
};

// Dismiss the pad but KEEP the aim: the pre-aim line stays on the board so the
// player can review it and fine-tune/fire from the permanent bar.
const closeJoystickPopup = (): void => {
  if (joystickPointerId !== null) {
    try {
      joystickPad.releasePointerCapture(joystickPointerId);
    } catch (error) {
      // ignore release errors
    }
    joystickPointerId = null;
    joystickPad.classList.remove('is-active');
  }
  joystickPopupOpen = false;
  updateFireControlUi();
  renderScene();
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
  if (isBoardFullscreen()) {
    updateFullscreenSizing();
    renderer.refreshViewport();
    renderScene();
  }
  updateJoystickKnobVisual();
  if (joystickPopupOpen) {
    positionJoystickPopup();
  }
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
  if (isAiming) {
    // A second finger switches to pinch; keep the aim set so far.
    endAiming();
  }
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

  // Direct aim: grab the active dot and drag — the dot's predicted landing
  // follows your finger. Dragging empty space pans; two fingers pinch-zoom.
  if (currentMode === 'online' && onlinePendingAction) {
    event.preventDefault();
    return;
  }
  const canAct = engine.canPlayerAct();
  const aimUnit = canAct ? getActiveUnit(currentState) : null;
  if (aimUnit) {
    const dotClient = worldToClient(aimUnit.position);
    const rect = canvas.getBoundingClientRect();
    const view = renderer.getViewSize();
    const scale = (boardRotated ? rect.height : rect.width) / Math.max(1, view.x);
    const grabRadius = aimUnit.def.radius * scale + AIM_GRAB_SCREEN_PADDING;
    const dScreen = Math.hypot(event.clientX - dotClient.x, event.clientY - dotClient.y);
    if (dScreen <= grabRadius) {
      isAiming = true;
      aimPointerId = event.pointerId;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        // ignore capture errors
      }
      event.preventDefault();
      // Aim updates on move; a tap without moving keeps the current aim.
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
  if (isAiming && event.pointerId === aimPointerId) {
    event.preventDefault();
    updateDirectAim(event);
    return;
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
  if (isAiming && event.pointerId === aimPointerId) {
    endAiming();
    return;
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
  if (isAiming && event.pointerId === aimPointerId) {
    endAiming();
    return;
  }
  if (isPanning && event.pointerId === panPointerId) {
    stopPan();
    return;
  }
  endDrag(event, true);
});

// Tapping anywhere outside the pad closes it — except the permanent controls
// bar (so fine-tuning/Fire don't dismiss the pad) and the board canvas (handled
// in the canvas pointerdown above).
document.addEventListener('pointerdown', (event) => {
  if (!joystickPopupOpen) {
    return;
  }
  const target = event.target as Node | null;
  if (!target) {
    return;
  }
  if (
    joystickPanel.contains(target) ||
    fireControls.contains(target) ||
    target === canvas ||
    canvas.contains(target)
  ) {
    return;
  }
  closeJoystickPopup();
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
  joystickPopupOpen = false;
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

// Drag the handle to move the whole popup; the chosen spot sticks for the turn.
const onPopupDragDown = (event: PointerEvent): void => {
  event.preventDefault();
  const rect = joystickPanel.getBoundingClientRect();
  popupDragPointerId = event.pointerId;
  popupDragStart = { pointerX: event.clientX, pointerY: event.clientY, left: rect.left, top: rect.top };
  joystickDragHandle.classList.add('is-dragging');
  try {
    joystickDragHandle.setPointerCapture(event.pointerId);
  } catch (error) {
    // ignore capture errors
  }
};

const onPopupDragMove = (event: PointerEvent): void => {
  if (popupDragPointerId === null || event.pointerId !== popupDragPointerId || !popupDragStart) {
    return;
  }
  event.preventDefault();
  const pw = joystickPanel.offsetWidth;
  const ph = joystickPanel.offsetHeight;
  const vv = window.visualViewport;
  const vLeft = vv?.offsetLeft ?? 0;
  const vTop = vv?.offsetTop ?? 0;
  const vw = vv?.width ?? window.innerWidth;
  const vh = vv?.height ?? window.innerHeight;
  const margin = 8;
  const minX = vLeft + margin;
  const maxX = Math.max(minX, vLeft + vw - pw - margin);
  const minY = vTop + margin;
  const maxY = Math.max(minY, vTop + vh - ph - margin);
  const left = Math.min(Math.max(popupDragStart.left + (event.clientX - popupDragStart.pointerX), minX), maxX);
  const top = Math.min(Math.max(popupDragStart.top + (event.clientY - popupDragStart.pointerY), minY), maxY);
  joystickManualPos = { left, top };
  joystickPanel.style.left = `${left}px`;
  joystickPanel.style.top = `${top}px`;
};

const endPopupDrag = (event: PointerEvent): void => {
  if (popupDragPointerId === null || event.pointerId !== popupDragPointerId) {
    return;
  }
  try {
    joystickDragHandle.releasePointerCapture(event.pointerId);
  } catch (error) {
    // ignore release errors
  }
  popupDragPointerId = null;
  popupDragStart = null;
  joystickDragHandle.classList.remove('is-dragging');
};

joystickDragHandle.addEventListener('pointerdown', onPopupDragDown);
joystickDragHandle.addEventListener('pointermove', onPopupDragMove);
joystickDragHandle.addEventListener('pointerup', endPopupDrag);
joystickDragHandle.addEventListener('pointercancel', endPopupDrag);
joystickDragHandle.addEventListener('lostpointercapture', endPopupDrag);
// Tap = one step; press-and-hold = rapid repeat after a short delay.
const bindRepeatPress = (button: HTMLButtonElement, action: () => void): void => {
  let holdTimeout: number | null = null;
  let repeatTimer: number | null = null;
  const stop = () => {
    if (holdTimeout !== null) {
      window.clearTimeout(holdTimeout);
      holdTimeout = null;
    }
    if (repeatTimer !== null) {
      window.clearInterval(repeatTimer);
      repeatTimer = null;
    }
  };
  button.addEventListener('pointerdown', (event) => {
    if (button.disabled) {
      return;
    }
    event.preventDefault();
    action();
    holdTimeout = window.setTimeout(() => {
      repeatTimer = window.setInterval(() => {
        if (button.disabled) {
          stop();
          return;
        }
        action();
      }, 70);
    }, 300);
  });
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('pointerleave', stop);
  // Keyboard activation (Enter/Space) reports a click with detail 0; pointer
  // taps already ran via pointerdown, so only act on the keyboard case here.
  button.addEventListener('click', (event) => {
    if (event.detail === 0 && !button.disabled) {
      action();
    }
  });
};

bindRepeatPress(joystickDirDecButton, () => nudgeJoystickAngle(-JOYSTICK_ANGLE_STEP_DEG));
bindRepeatPress(joystickDirIncButton, () => nudgeJoystickAngle(JOYSTICK_ANGLE_STEP_DEG));
bindRepeatPress(joystickPowDecButton, () => nudgeJoystickPower(-JOYSTICK_POWER_STEP));
bindRepeatPress(joystickPowIncButton, () => nudgeJoystickPower(JOYSTICK_POWER_STEP));

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

// Inverse of toWorldPointFromClient: world coordinates -> client (viewport) px,
// rotation-aware. Used to anchor the joystick popup beside the active dot.
function worldToClient(world: Vector): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { x: rect.left, y: rect.top };
  }
  const offset = renderer.getOffset();
  const view = renderer.getViewSize();
  const ratioX = (world.x - offset.x) / view.x;
  const ratioY = (world.y - offset.y) / view.y;
  if (boardRotated) {
    const unrotatedWidth = rect.height;
    const unrotatedHeight = rect.width;
    const localX = ratioX * unrotatedWidth - unrotatedWidth / 2;
    const localY = ratioY * unrotatedHeight - unrotatedHeight / 2;
    // forward 90deg cw rotation: screenX = -localY, screenY = localX
    return {
      x: rect.left + rect.width / 2 - localY,
      y: rect.top + rect.height / 2 + localX,
    };
  }
  return {
    x: rect.left + ratioX * rect.width,
    y: rect.top + ratioY * rect.height,
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
          // The free-tier host spins down when idle, so this wait is usually
          // the server cold-starting — name it so a long pause reads as
          // progress rather than the app being stuck.
          phaseText = 'Booting the server…';
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

// Enable offline play: cache the app shell so VS Bot / Hotseat open without
// waking the online server (online still connects on demand when you queue).
registerOfflineSupport();
