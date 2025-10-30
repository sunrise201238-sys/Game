import { BOT_SPAWNS, GAME_CONSTANTS, PLAYER_SPAWNS, UNIT_DEFINITIONS } from './config';
import { add, clampMagnitude, distance, length, normalize, scale, subtract } from './math';
import type {
  DragAction,
  GameState,
  SimulationFrame,
  SimulationFrameUnit,
  SimulationResult,
  TeamId,
  TurnOrderState,
  UnitDefinition,
  UnitState,
  Vector,
} from './types';
import { MAP_DEFINITION as MAP } from './config';

const PLAYER_TEAM: TeamId = 0;
const BOT_TEAM: TeamId = 1;

interface EngineListeners {
  onState(state: GameState): void;
  onFrame(frame: SimulationFrame): void;
}

interface UnitClone extends UnitState {
  velocity: Vector;
}

export class GameEngine {
  private state: GameState;
  private listeners: EngineListeners;
  private pendingBotTimeout: number | null = null;

  constructor(listeners: EngineListeners) {
    this.listeners = listeners;
    this.state = this.createInitialState();
  }

  startNewGame(): void {
    if (this.pendingBotTimeout) {
      window.clearTimeout(this.pendingBotTimeout);
      this.pendingBotTimeout = null;
    }
    this.state = this.createInitialState();
    this.emitState();
  }

  getSnapshot(): GameState {
    return structuredClone(this.state);
  }

  getActiveUnit(): UnitState | null {
    return this.findNextAlive(this.state.activeTeam).unit;
  }

  canPlayerAct(): boolean {
    return this.state.phase === 'aim' && this.state.activeTeam === PLAYER_TEAM && !this.state.winner;
  }

  beginPlayerAction(actionVector: Vector): void {
    if (!this.canPlayerAct()) return;
    const unit = this.getActiveUnit();
    if (!unit) {
      this.handleWin(BOT_TEAM);
      return;
    }
    const drag = clampMagnitude(actionVector, unit.def.maxPower);
    const power = length(drag);
    const action: DragAction = {
      unitId: unit.id,
      power,
      vector: drag,
    };
    this.executeAction(action, PLAYER_TEAM);
  }

  private scheduleBot(): void {
    if (this.state.phase !== 'bot-planning' || this.state.winner) return;
    if (this.pendingBotTimeout) {
      window.clearTimeout(this.pendingBotTimeout);
    }
    this.pendingBotTimeout = window.setTimeout(() => {
      this.pendingBotTimeout = null;
      const unitInfo = this.findNextAlive(BOT_TEAM);
      if (!unitInfo.unit) {
        this.handleWin(PLAYER_TEAM);
        return;
      }
      const botAction = this.createBotAction(unitInfo.unit);
      this.executeAction(botAction, BOT_TEAM);
    }, 650);
  }

  private executeAction(action: DragAction, actingTeam: TeamId): void {
    const unit = this.state.units.find((u) => u.id === action.unitId && u.alive);
    if (!unit) return;
    this.state.phase = 'animating';
    this.emitState();

    const result = this.simulateAction(action);
    this.animate(result, actingTeam);
  }

  private animate(result: SimulationResult, actingTeam: TeamId): void {
    const frames = result.frames;
    const playNext = (index: number) => {
      if (index >= frames.length) {
        this.finalize(result, actingTeam);
        return;
      }
      this.listeners.onFrame(frames[index]);
      this.applyFrame(frames[index]);
      this.emitState();
      window.requestAnimationFrame(() => playNext(index + 1));
    };
    playNext(0);
  }

  private finalize(result: SimulationResult, actingTeam: TeamId): void {
    this.applyFinalUnits(result.finalUnits);
    this.registerDeaths(result.deaths);

    const actedOrder = this.state.orders[actingTeam];
    actedOrder.nextIndex = (actedOrder.nextIndex + 1) % actedOrder.queue.length;

    const otherTeam: TeamId = actingTeam === PLAYER_TEAM ? BOT_TEAM : PLAYER_TEAM;

    const otherAlive = this.hasAliveUnits(otherTeam);
    const actingAlive = this.hasAliveUnits(actingTeam);
    if (!otherAlive && !actingAlive) {
      this.handleDraw();
      return;
    }
    if (!otherAlive) {
      this.handleWin(actingTeam);
      return;
    }
    if (!actingAlive) {
      this.handleWin(otherTeam);
      return;
    }

    this.state.activeTeam = otherTeam;
    if (this.state.activeTeam === PLAYER_TEAM) {
      this.state.phase = 'aim';
      this.state.round += 1;
      this.emitState();
    } else {
      this.state.phase = 'bot-planning';
      this.emitState();
      this.scheduleBot();
    }
  }

  private applyFrame(frame: SimulationFrame): void {
    for (const unitFrame of frame.units) {
      const unit = this.state.units.find((u) => u.id === unitFrame.id);
      if (!unit) continue;
      unit.position.x = unitFrame.x;
      unit.position.y = unitFrame.y;
      unit.hp = unitFrame.hp;
      unit.alive = unitFrame.alive;
    }
  }

  private applyFinalUnits(finalUnits: UnitState[]): void {
    for (const finalUnit of finalUnits) {
      const unit = this.state.units.find((u) => u.id === finalUnit.id);
      if (!unit) continue;
      unit.position = { ...finalUnit.position };
      unit.velocity = { ...finalUnit.velocity };
      unit.hp = finalUnit.hp;
      unit.alive = finalUnit.alive;
    }
  }

  private registerDeaths(deaths: string[]): void {
    if (deaths.length === 0) return;
    for (const unitId of deaths) {
      const unit = this.state.units.find((u) => u.id === unitId);
      if (!unit) continue;
      unit.alive = false;
      const grave = this.state.graves.find((g) => distance(g.position, unit.position) < unit.def.radius * 0.75);
      if (grave) {
        grave.count += 1;
      } else {
        this.state.graves.push({
          position: { ...unit.position },
          team: unit.team,
          count: 1,
        });
      }
    }
  }

  private simulateAction(action: DragAction): SimulationResult {
    const clones: UnitClone[] = this.state.units.map((unit) => ({
      ...structuredClone(unit),
      velocity: { x: 0, y: 0 },
    }));

    const frameList: SimulationFrame[] = [];
    const attacker = clones.find((u) => u.id === action.unitId);
    if (!attacker) {
      return { frames: [], finalUnits: this.cloneFinalUnits(clones), deaths: [] };
    }

    const launchDir = normalize(action.vector);
    const launchSpeed = action.power * GAME_CONSTANTS.dragPowerScale;
    attacker.velocity = scale(launchDir, launchSpeed);

    const activeVelocities = new Map<string, Vector>();
    activeVelocities.set(attacker.id, { ...attacker.velocity });
    const damaged = new Set<string>();

    const maxSteps = Math.floor((GAME_CONSTANTS.maxSimulationSeconds / GAME_CONSTANTS.timeStep));

    for (let step = 0; step < maxSteps; step += 1) {
      // update movement for all tracked units
      for (const clone of clones) {
        const currentVel = activeVelocities.get(clone.id);
        if (!currentVel) continue;
        clone.position = add(clone.position, scale(currentVel, GAME_CONSTANTS.timeStep));
      }

      // boundary handling
      for (const clone of clones) {
        const currentVel = activeVelocities.get(clone.id);
        if (!currentVel) continue;
        const radius = clone.def.radius;
        if (clone.position.x - radius < 0) {
          clone.position.x = radius;
          currentVel.x = -currentVel.x * GAME_CONSTANTS.wallBounce;
        }
        if (clone.position.x + radius > MAP.width) {
          clone.position.x = MAP.width - radius;
          currentVel.x = -currentVel.x * GAME_CONSTANTS.wallBounce;
        }
        if (clone.position.y - radius < 0) {
          clone.position.y = radius;
          currentVel.y = -currentVel.y * GAME_CONSTANTS.wallBounce;
        }
        if (clone.position.y + radius > MAP.height) {
          clone.position.y = MAP.height - radius;
          currentVel.y = -currentVel.y * GAME_CONSTANTS.wallBounce;
        }
      }

      // collisions
      for (const clone of clones) {
        const currentVel = activeVelocities.get(clone.id);
        const moving = Boolean(currentVel);
        for (const other of clones) {
          if (clone.id === other.id || !other.alive) continue;
          const dist = distance(clone.position, other.position);
          const minDist = clone.def.radius + other.def.radius;
          if (dist === 0 || dist >= minDist) continue;
          const dir = normalize(subtract(other.position, clone.position));
          const overlap = minDist - dist;
          clone.position = add(clone.position, scale(dir, -overlap / 2));
          other.position = add(other.position, scale(dir, overlap / 2));

          if (clone.team === other.team) {
            const shove = scale(dir, 40);
            const newVelA = add(activeVelocities.get(clone.id) ?? { x: 0, y: 0 }, scale(shove, -0.5));
            const newVelB = add(activeVelocities.get(other.id) ?? { x: 0, y: 0 }, scale(shove, 0.5));
            activeVelocities.set(clone.id, newVelA);
            activeVelocities.set(other.id, newVelB);
          } else if (moving) {
            if (!damaged.has(other.id)) {
              other.hp = Math.max(0, other.hp - clone.def.collideDamage);
              if (other.hp === 0) {
                other.alive = false;
              }
              damaged.add(other.id);
            }
            const knockScale = clone.def.knockback * (1 - other.def.resistance);
            const targetVel = add(
              activeVelocities.get(other.id) ?? { x: 0, y: 0 },
              scale(dir, knockScale)
            );
            activeVelocities.set(other.id, targetVel);
            const recoilVec = add(activeVelocities.get(clone.id) ?? { x: 0, y: 0 }, scale(dir, -clone.def.recoil));
            activeVelocities.set(clone.id, recoilVec);
          }
        }
      }

      // apply walls (obstacles)
      for (const wall of MAP.walls) {
        for (const clone of clones) {
          const currentVel = activeVelocities.get(clone.id);
          if (!currentVel) continue;
          if (this.pointInRect(clone.position, wall)) {
            // push out along smallest axis
            const leftPen = Math.abs(clone.position.x - wall.x);
            const rightPen = Math.abs(clone.position.x - (wall.x + wall.width));
            const topPen = Math.abs(clone.position.y - wall.y);
            const bottomPen = Math.abs(clone.position.y - (wall.y + wall.height));
            const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);
            if (minPen === leftPen) {
              clone.position.x = wall.x - clone.def.radius;
              currentVel.x = -currentVel.x * GAME_CONSTANTS.wallBounce;
            } else if (minPen === rightPen) {
              clone.position.x = wall.x + wall.width + clone.def.radius;
              currentVel.x = -currentVel.x * GAME_CONSTANTS.wallBounce;
            } else if (minPen === topPen) {
              clone.position.y = wall.y - clone.def.radius;
              currentVel.y = -currentVel.y * GAME_CONSTANTS.wallBounce;
            } else {
              clone.position.y = wall.y + wall.height + clone.def.radius;
              currentVel.y = -currentVel.y * GAME_CONSTANTS.wallBounce;
            }
          }
        }
      }

      // apply friction
      for (const [id, vel] of Array.from(activeVelocities.entries())) {
        const slowed = scale(vel, GAME_CONSTANTS.friction);
        if (length(slowed) < GAME_CONSTANTS.minVelocity) {
          activeVelocities.delete(id);
        } else {
          activeVelocities.set(id, slowed);
        }
      }

      frameList.push(this.createFrameSnapshot(clones));
      if (activeVelocities.size === 0) break;
    }

    const deaths: string[] = [];
    for (const clone of clones) {
      if (!clone.alive) {
        deaths.push(clone.id);
        continue;
      }
      if (clone.hp <= 0) {
        clone.alive = false;
        deaths.push(clone.id);
        continue;
      }
      if (!this.pointInsideMap(clone)) {
        clone.alive = false;
        deaths.push(clone.id);
        continue;
      }
      for (const lake of MAP.lakes) {
        if (this.pointInRect(clone.position, lake)) {
          clone.alive = false;
          deaths.push(clone.id);
          break;
        }
      }
    }

    frameList.push(this.createFrameSnapshot(clones));

    return {
      frames: frameList,
      finalUnits: this.cloneFinalUnits(clones),
      deaths,
    };
  }

  private cloneFinalUnits(clones: UnitClone[]): UnitState[] {
    return clones.map((clone) => ({
      id: clone.id,
      def: clone.def,
      team: clone.team,
      hp: Math.max(0, Math.round(clone.hp)),
      position: { ...clone.position },
      velocity: { ...clone.velocity },
      alive: clone.alive && clone.hp > 0,
    }));
  }

  private createFrameSnapshot(clones: UnitClone[]): SimulationFrame {
    const units: SimulationFrameUnit[] = clones.map((clone) => ({
      id: clone.id,
      x: clone.position.x,
      y: clone.position.y,
      hp: Math.max(0, clone.hp),
      alive: clone.alive && clone.hp > 0,
    }));
    return { units };
  }

  private pointInRect(point: Vector, rect: { x: number; y: number; width: number; height: number }): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
  }

  private pointInsideMap(unit: UnitClone): boolean {
    const { radius } = unit.def;
    return (
      unit.position.x >= radius &&
      unit.position.x <= MAP.width - radius &&
      unit.position.y >= radius &&
      unit.position.y <= MAP.height - radius
    );
  }

  private createBotAction(unit: UnitState): DragAction {
    const enemies = this.state.units.filter((u) => u.team === PLAYER_TEAM && u.alive);
    if (enemies.length === 0) {
      return { unitId: unit.id, vector: { x: -unit.def.maxPower, y: 0 }, power: unit.def.maxPower };
    }
    const target = enemies.reduce((closest, current) => {
      const distCurrent = distance(unit.position, current.position);
      const distClosest = distance(unit.position, closest.position);
      return distCurrent < distClosest ? current : closest;
    });
    const aimVec = subtract(target.position, unit.position);
    const drag = clampMagnitude(aimVec, unit.def.maxPower);
    return {
      unitId: unit.id,
      vector: drag,
      power: length(drag),
    };
  }

  private emitState(): void {
    this.listeners.onState(this.getSnapshot());
  }

  private handleWin(winner: TeamId): void {
    this.state.phase = 'ended';
    this.state.winner = winner;
    this.emitState();
  }

  private handleDraw(): void {
    this.state.phase = 'ended';
    this.state.winner = 'draw';
    this.emitState();
  }

  private hasAliveUnits(team: TeamId): boolean {
    return this.state.units.some((u) => u.team === team && u.alive);
  }

  private findNextAlive(team: TeamId): { unit: UnitState | null; index: number } {
    const order = this.state.orders[team];
    const { queue } = order;
    for (let offset = 0; offset < queue.length; offset += 1) {
      const index = (order.nextIndex + offset) % queue.length;
      const unitId = queue[index];
      const unit = this.state.units.find((u) => u.id === unitId && u.alive);
      if (unit) {
        order.nextIndex = index;
        return { unit, index };
      }
    }
    return { unit: null, index: order.nextIndex };
  }

  private createInitialState(): GameState {
    const units: UnitState[] = [];
    const createUnit = (def: UnitDefinition, team: TeamId, position: Vector, suffix: number): UnitState => ({
      id: `${def.id}-${team}-${suffix}`,
      def,
      team,
      hp: def.maxHp,
      position: { ...position },
      velocity: { x: 0, y: 0 },
      alive: true,
    });

    UNIT_DEFINITIONS.forEach((def, index) => {
      units.push(createUnit(def, PLAYER_TEAM, PLAYER_SPAWNS[index % PLAYER_SPAWNS.length], index));
      units.push(createUnit(def, BOT_TEAM, BOT_SPAWNS[index % BOT_SPAWNS.length], index));
    });

    const orderPlayer = this.createOrder(units, PLAYER_TEAM);
    const orderBot = this.createOrder(units, BOT_TEAM);

    const state: GameState = {
      units,
      graves: [],
      activeTeam: PLAYER_TEAM,
      round: 1,
      phase: 'aim',
      winner: null,
      orders: {
        0: orderPlayer,
        1: orderBot,
      },
    } as GameState;

    return state;
  }

  private createOrder(units: UnitState[], team: TeamId): TurnOrderState {
    const teamUnits = units.filter((u) => u.team === team);
    const queue = teamUnits
      .slice()
      .sort((a, b) => {
        if (a.position.y === b.position.y) {
          return a.position.x - b.position.x;
        }
        return a.position.y - b.position.y;
      })
      .map((unit) => unit.id);
    return { queue, nextIndex: 0 };
  }
}
