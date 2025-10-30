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

let currentState: GameState;
let isDragging = false;
let dragOrigin: Vector | null = null;
let dragCurrent: Vector | null = null;

const engine = new GameEngine({
  onState: (state) => {
    if (state.mapId !== currentMap.id) {
      currentMap = getMapById(state.mapId);
      renderer.setMap(currentMap);
      mapSelect.value = currentMap.id;
    }
    currentState = state;
    updateUi(state);
    renderer.render(state, {
      dragOrigin: isDragging ? dragOrigin : null,
      dragCurrent: isDragging ? dragCurrent : null,
    });
  },
  onFrame: () => {
    // no-op: renderer re-renders when state updates
  },
}, currentMap, undefined, currentMode);

currentState = engine.getSnapshot();
updateUi(currentState);
renderer.render(currentState);

restartButton.addEventListener('click', () => {
  isDragging = false;
  dragOrigin = null;
  dragCurrent = null;
  engine.startNewGame(currentMap, currentMode);
});

mapSelect.addEventListener('change', () => {
  currentMap = getMapById(mapSelect.value);
  renderer.setMap(currentMap);
  isDragging = false;
  dragOrigin = null;
  dragCurrent = null;
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

canvas.addEventListener('pointerdown', (event) => {
  if (!engine.canPlayerAct()) return;
  const pointer = toWorldPoint(event);
  const activeUnit = getActiveUnit(currentState);
  if (!activeUnit) return;
  const distanceToUnit = Math.hypot(pointer.x - activeUnit.position.x, pointer.y - activeUnit.position.y);
  if (distanceToUnit > activeUnit.def.radius + 12) return;

  isDragging = true;
  dragOrigin = { ...activeUnit.position };
  dragCurrent = pointer;
  canvas.setPointerCapture(event.pointerId);
  renderer.render(currentState, { dragOrigin, dragCurrent });
});

canvas.addEventListener('pointermove', (event) => {
  if (!isDragging) return;
  dragCurrent = toWorldPoint(event);
  renderer.render(currentState, { dragOrigin, dragCurrent });
});

const endDrag = (event: PointerEvent) => {
  if (!isDragging || !dragOrigin) return;
  dragCurrent = toWorldPoint(event);
  const actionVector = {
    x: dragOrigin.x - dragCurrent.x,
    y: dragOrigin.y - dragCurrent.y,
  };
  isDragging = false;
  dragOrigin = null;
  dragCurrent = null;
  renderer.render(currentState);
  engine.beginPlayerAction(actionVector);
};

canvas.addEventListener('pointerup', (event) => {
  endDrag(event);
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener('pointercancel', (event) => {
  endDrag(event);
  canvas.releasePointerCapture(event.pointerId);
});

function toWorldPoint(event: PointerEvent): Vector {
  const rect = canvas.getBoundingClientRect();
  const ratioX = (event.clientX - rect.left) / rect.width;
  const ratioY = (event.clientY - rect.top) / rect.height;
  return {
    x: currentMap.width * ratioX,
    y: currentMap.height * ratioY,
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
