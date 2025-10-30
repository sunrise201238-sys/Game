import { DEFAULT_MAP_ID, MAPS, getMapById } from './config';
import { GameEngine } from './engine';
import { Renderer } from './renderer';
import type { GameState, TeamId, UnitState, Vector } from './types';

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const restartButton = document.getElementById('restart-btn') as HTMLButtonElement;
const mapSelect = document.getElementById('map-select') as HTMLSelectElement;
const roundLabel = document.getElementById('round-label') as HTMLSpanElement;
const phaseLabel = document.getElementById('phase-label') as HTMLSpanElement;
const playerList = document.getElementById('player-units') as HTMLUListElement;
const botList = document.getElementById('bot-units') as HTMLUListElement;
const hintText = document.getElementById('hint-text') as HTMLParagraphElement;

let currentMap = getMapById(DEFAULT_MAP_ID);

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
}, currentMap);

currentState = engine.getSnapshot();
updateUi(currentState);
renderer.render(currentState);

restartButton.addEventListener('click', () => {
  isDragging = false;
  dragOrigin = null;
  dragCurrent = null;
  engine.startNewGame(currentMap);
});

mapSelect.addEventListener('change', () => {
  currentMap = getMapById(mapSelect.value);
  renderer.setMap(currentMap);
  isDragging = false;
  dragOrigin = null;
  dragCurrent = null;
  engine.startNewGame(currentMap);
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
  if (state.winner !== null) {
    phaseLabel.textContent = state.winner === 0 ? 'Victory!' : state.winner === 1 ? 'Defeat' : 'Draw';
  } else if (state.phase === 'aim') {
    phaseLabel.textContent = 'Your turn';
  } else if (state.phase === 'bot-planning') {
    phaseLabel.textContent = 'Bot planning';
  } else if (state.phase === 'animating') {
    phaseLabel.textContent = 'Resolving';
  } else {
    phaseLabel.textContent = '';
  }

  updateUnitList(playerList, state, 0, activeUnit?.id ?? null);
  updateUnitList(botList, state, 1, activeUnit?.id ?? null);

  const baseHint = state.phase === 'aim'
    ? 'Drag your highlighted unit away from where you want it to travel, then release.'
    : state.phase === 'bot-planning'
    ? 'Bot is preparing a move…'
    : state.winner !== null
    ? 'Tap "Start New Game" to play again.'
    : 'Resolving actions…';
  const mapMeta = getMapById(state.mapId);
  const mapDetails = mapMeta.description ? ` • ${mapMeta.name}: ${mapMeta.description}` : '';
  hintText.textContent = `${baseHint}${mapDetails}`;
}

function updateUnitList(container: HTMLUListElement, state: GameState, team: TeamId, activeId: string | null) {
  container.replaceChildren(...state.units
    .filter((unit) => unit.team === team)
    .map((unit) => {
      const li = document.createElement('li');
      li.textContent = `${unit.def.name}: ${Math.max(0, Math.round(unit.hp))} HP`;
      li.className = unit.alive ? 'unit alive' : 'unit dead';
      if (unit.id === activeId && state.activeTeam === team && state.phase !== 'ended') {
        li.classList.add('active');
      }
      return li;
    }));
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
