import { GAME_CONSTANTS, TEAM_LOADOUT, getUnitDefinition } from './config';
import { add, clampMagnitude, distance, length, normalize, scale, subtract } from './math';
import type {
  DragAction,
  GameState,
  SimulationFrame,
  SimulationResult,
  SimulationFrameProjectile,
  SimulationFrameZone,
  TeamId,
  TurnOrderState,
  UnitDefinition,
  UnitState,
  Vector,
  ZoneState,
  StatusEffect,
  MapDefinition,
} from './types';

const PLAYER_TEAM: TeamId = 0;
const BOT_TEAM: TeamId = 1;

interface EngineListeners {
  onState(state: GameState): void;
  onFrame(frame: SimulationFrame): void;
}

interface UnitClone extends UnitState {
  velocity: Vector;
}

interface ProjectileState {
  id: string;
  position: Vector;
  velocity: Vector;
  remainingDistance: number;
  radius: number;
  damage: number;
  knockback: number;
  ownerTeam: TeamId;
  color: string;
}

type ZoneClone = ZoneState;

export class GameEngine {
  private state: GameState;
  private listeners: EngineListeners;
  private pendingBotTimeout: number | null = null;
  private projectileCounter = 0;
  private zoneCounter = 0;
  private map: MapDefinition;
  private readonly loadout: string[];

  constructor(listeners: EngineListeners, map: MapDefinition, loadout: string[] = TEAM_LOADOUT) {
    this.listeners = listeners;
    this.map = structuredClone(map);
    this.loadout = [...loadout];
    this.state = this.createInitialState();
  }

  startNewGame(map?: MapDefinition): void {
    if (this.pendingBotTimeout) {
      window.clearTimeout(this.pendingBotTimeout);
      this.pendingBotTimeout = null;
    }
    this.projectileCounter = 0;
    this.zoneCounter = 0;
    if (map) {
      this.map = structuredClone(map);
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
    this.addZones(result.zonesToAdd);
    this.applyStatusInflictions(result.inflictedStatuses);

    const actedOrder = this.state.orders[actingTeam];
    actedOrder.nextIndex = (actedOrder.nextIndex + 1) % actedOrder.queue.length;

    if (actingTeam === BOT_TEAM) {
      this.reduceZoneDurationsAfterRound();
    }
    this.cleanupExpiredZones();

    const otherTeam: TeamId = actingTeam === PLAYER_TEAM ? BOT_TEAM : PLAYER_TEAM;
    this.state.activeTeam = otherTeam;

    if (this.state.activeTeam === PLAYER_TEAM) {
      this.state.round += 1;
    }

    this.applyTurnStartEffects(this.state.activeTeam);

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

    if (this.state.activeTeam === PLAYER_TEAM) {
      this.state.phase = 'aim';
      this.emitState();
    } else {
      this.state.phase = 'bot-planning';
      this.emitState();
      this.scheduleBot();
    }
  }

  private applyFrame(frame: SimulationFrame): void {
    this.state.activeProjectiles = frame.projectiles;
    this.state.activeZones = frame.zones;
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
    this.state.activeProjectiles = [];
    this.refreshPersistentZoneVisuals();
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
    if (deaths.length) {
      this.state.statuses = this.state.statuses.filter((status) => !deaths.includes(status.unitId));
    }
  }

  private simulateAction(action: DragAction): SimulationResult {
    const clones: UnitClone[] = this.state.units.map((unit) => ({
      ...structuredClone(unit),
      velocity: { x: 0, y: 0 },
    }));

    const existingZones: ZoneClone[] = this.state.zones.map((zone) => structuredClone(zone));
    const zoneClones: ZoneClone[] = [...existingZones];
    const frameList: SimulationFrame[] = [];
    const inflictedStatuses = new Map<string, StatusEffect>();

    const attacker = clones.find((u) => u.id === action.unitId);
    if (!attacker) {
      return {
        frames: [],
        finalUnits: this.cloneFinalUnits(clones),
        deaths: [],
        zonesToAdd: [],
        inflictedStatuses: [],
      };
    }

    const map = this.map;
    const launchDir = normalize(action.vector);
    const launchSpeed = action.power * GAME_CONSTANTS.dragPowerScale;
    attacker.velocity = scale(launchDir, launchSpeed);

    const activeVelocities = new Map<string, Vector>();
    if (launchSpeed > 0) {
      activeVelocities.set(attacker.id, { ...attacker.velocity });
    }

    const projectiles: ProjectileState[] = [];
    if (attacker.def.projectile && launchSpeed > 0) {
      const spec = attacker.def.projectile;
      const projectile: ProjectileState = {
        id: `proj-${this.projectileCounter++}`,
        position: { ...attacker.position },
        velocity: scale(launchDir, spec.speed),
        remainingDistance: spec.maxDistance,
        radius: spec.radius,
        damage: spec.damage,
        knockback: spec.knockback,
        ownerTeam: attacker.team,
        color: spec.color,
      };
      projectiles.push(projectile);
    }

    const newZones: ZoneState[] = [];
    if (attacker.def.aoe && launchSpeed > 0) {
      const spec = attacker.def.aoe;
      const placementDistance = Math.min(spec.placementRange, action.power * spec.travelScale);
      const desiredCenter = add(attacker.position, scale(launchDir, placementDistance));
      const center = {
        x: Math.min(map.width - spec.radius, Math.max(spec.radius, desiredCenter.x)),
        y: Math.min(map.height - spec.radius, Math.max(spec.radius, desiredCenter.y)),
      };
      const zone: ZoneState = {
        id: `zone-${this.zoneCounter++}`,
        center,
        radius: spec.radius,
        ownerTeam: attacker.team,
        remainingTurns: spec.duration,
        maxTurns: spec.duration,
        dotDamage: spec.dotDamage,
        dotDuration: spec.dotDuration,
        color: spec.color,
      };
      newZones.push(zone);
      zoneClones.push(zone);
    }

    const processedZoneHits = new Set<string>();
    const damagedUnits = new Set<string>();

    const registerZoneContact = (unit: UnitClone, zone: ZoneClone) => {
      if (!unit.alive || unit.team === zone.ownerTeam) return;
      const key = `${zone.id}:${unit.id}`;
      if (processedZoneHits.has(key)) return;
      processedZoneHits.add(key);
      unit.hp = Math.max(0, unit.hp - zone.dotDamage);
      if (unit.hp === 0) {
        unit.alive = false;
      }
      const existing = inflictedStatuses.get(unit.id);
      if (!existing || existing.damagePerTurn <= zone.dotDamage) {
        inflictedStatuses.set(unit.id, {
          unitId: unit.id,
          remainingTurns: zone.dotDuration,
          damagePerTurn: zone.dotDamage,
        });
      }
    };

    const checkZoneContacts = () => {
      for (const zone of zoneClones) {
        for (const clone of clones) {
          if (!clone.alive || clone.team === zone.ownerTeam) continue;
          const dist = distance(clone.position, zone.center);
          if (dist <= zone.radius + clone.def.radius * 0.5) {
            registerZoneContact(clone, zone);
          }
        }
      }
    };

    checkZoneContacts();

    const maxSteps = Math.floor(GAME_CONSTANTS.maxSimulationSeconds / GAME_CONSTANTS.timeStep);

    for (let step = 0; step < maxSteps; step += 1) {
      for (const clone of clones) {
        const currentVel = activeVelocities.get(clone.id);
        if (!currentVel) continue;
        clone.position = add(clone.position, scale(currentVel, GAME_CONSTANTS.timeStep));
      }

      for (let i = projectiles.length - 1; i >= 0; i -= 1) {
        const projectile = projectiles[i];
        const stepVector = scale(projectile.velocity, GAME_CONSTANTS.timeStep);
        projectile.position = add(projectile.position, stepVector);
        projectile.remainingDistance -= length(stepVector);

        let remove = projectile.remainingDistance <= 0 ||
          !this.pointInsideCircleBounds(projectile.position, projectile.radius);

        if (!remove) {
          for (const wall of map.walls) {
            if (this.pointInRect(projectile.position, wall)) {
              remove = true;
              break;
            }
          }
        }

        if (!remove) {
          for (const clone of clones) {
            if (!clone.alive || clone.team === projectile.ownerTeam) continue;
            const dist = distance(projectile.position, clone.position);
            if (dist <= projectile.radius + clone.def.radius) {
              clone.hp = Math.max(0, clone.hp - projectile.damage);
              if (clone.hp === 0) {
                clone.alive = false;
              }
              const knockDir = normalize(subtract(clone.position, projectile.position));
              const knockVec = scale(knockDir, projectile.knockback * (1 - clone.def.resistance));
              const current = activeVelocities.get(clone.id) ?? { x: 0, y: 0 };
              activeVelocities.set(clone.id, add(current, knockVec));
              remove = true;
              break;
            }
          }
        }

        if (remove) {
          projectiles.splice(i, 1);
        }
      }

      for (const clone of clones) {
        const currentVel = activeVelocities.get(clone.id);
        if (!currentVel) continue;
        const radius = clone.def.radius;
        if (clone.position.x - radius < 0) {
          clone.position.x = radius;
          currentVel.x = -currentVel.x * GAME_CONSTANTS.wallBounce;
        }
        if (clone.position.x + radius > map.width) {
          clone.position.x = map.width - radius;
          currentVel.x = -currentVel.x * GAME_CONSTANTS.wallBounce;
        }
        if (clone.position.y - radius < 0) {
          clone.position.y = radius;
          currentVel.y = -currentVel.y * GAME_CONSTANTS.wallBounce;
        }
        if (clone.position.y + radius > map.height) {
          clone.position.y = map.height - radius;
          currentVel.y = -currentVel.y * GAME_CONSTANTS.wallBounce;
        }
      }

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
            if (!damagedUnits.has(other.id)) {
              other.hp = Math.max(0, other.hp - clone.def.collideDamage);
              if (other.hp === 0) {
                other.alive = false;
              }
              damagedUnits.add(other.id);
            }
            const knockScale = clone.def.knockback * (1 - other.def.resistance);
            const targetVel = add(activeVelocities.get(other.id) ?? { x: 0, y: 0 }, scale(dir, knockScale));
            activeVelocities.set(other.id, targetVel);
            const recoilVec = add(activeVelocities.get(clone.id) ?? { x: 0, y: 0 }, scale(dir, -clone.def.recoil));
            activeVelocities.set(clone.id, recoilVec);
          }
        }
      }

      for (const wall of map.walls) {
        for (const clone of clones) {
          const currentVel = activeVelocities.get(clone.id);
          if (!currentVel) continue;
          if (this.pointInRect(clone.position, wall)) {
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

      checkZoneContacts();

      for (const [id, vel] of Array.from(activeVelocities.entries())) {
        const slowed = scale(vel, GAME_CONSTANTS.friction);
        if (length(slowed) < GAME_CONSTANTS.minVelocity) {
          activeVelocities.delete(id);
        } else {
          activeVelocities.set(id, slowed);
        }
      }

      frameList.push(this.createFrameSnapshot(clones, projectiles, zoneClones));
      if (activeVelocities.size === 0 && projectiles.length === 0) {
        break;
      }
    }

    checkZoneContacts();

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
      if (this.isInHazard(clone.position)) {
        clone.alive = false;
        deaths.push(clone.id);
      }
    }

    for (const clone of clones) {
      clone.velocity = { x: 0, y: 0 };
    }

    frameList.push(this.createFrameSnapshot(clones, projectiles, zoneClones));

    return {
      frames: frameList,
      finalUnits: this.cloneFinalUnits(clones),
      deaths,
      zonesToAdd: newZones,
      inflictedStatuses: Array.from(inflictedStatuses.values()),
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

  private createFrameSnapshot(
    clones: UnitClone[],
    projectiles: ProjectileState[],
    zones: ZoneClone[],
  ): SimulationFrame {
    const units = clones.map((clone) => ({
      id: clone.id,
      x: clone.position.x,
      y: clone.position.y,
      hp: Math.max(0, clone.hp),
      alive: clone.alive && clone.hp > 0,
    }));
    const projectileFrames: SimulationFrameProjectile[] = projectiles.map((projectile) => ({
      id: projectile.id,
      x: projectile.position.x,
      y: projectile.position.y,
      radius: projectile.radius,
      color: projectile.color,
    }));
    const zoneFrames: SimulationFrameZone[] = zones.map((zone) => this.zoneToFrame(zone));
    return { units, projectiles: projectileFrames, zones: zoneFrames };
  }

  private refreshPersistentZoneVisuals(): void {
    this.state.activeZones = this.state.zones.map((zone) => this.zoneToFrame(zone));
  }

  private zoneToFrame(zone: ZoneState): SimulationFrameZone {
    const intensityBase = zone.maxTurns > 0 ? zone.remainingTurns / zone.maxTurns : 0;
    const strength = Math.max(0.2, Math.min(1, intensityBase));
    return {
      id: zone.id,
      x: zone.center.x,
      y: zone.center.y,
      radius: zone.radius,
      strength,
      color: zone.color,
    };
  }

  private addZones(zones: ZoneState[]): void {
    if (!zones.length) return;
    this.state.zones.push(
      ...zones.map((zone) => structuredClone(zone))
    );
    this.refreshPersistentZoneVisuals();
  }

  private applyStatusInflictions(effects: StatusEffect[]): void {
    if (!effects.length) return;
    for (const effect of effects) {
      const unit = this.state.units.find((u) => u.id === effect.unitId && u.alive);
      if (!unit) continue;
      const existing = this.state.statuses.find((status) => status.unitId === effect.unitId);
      if (existing) {
        existing.remainingTurns = Math.max(existing.remainingTurns, effect.remainingTurns);
        existing.damagePerTurn = effect.damagePerTurn;
      } else {
        this.state.statuses.push({ ...effect });
      }
    }
  }

  private applyTurnStartEffects(team: TeamId): void {
    if (this.state.statuses.length === 0) return;
    const remaining: StatusEffect[] = [];
    const deaths: string[] = [];
    for (const effect of this.state.statuses) {
      const unit = this.state.units.find((u) => u.id === effect.unitId && u.alive);
      if (!unit) continue;
      if (unit.team !== team) {
        remaining.push(effect);
        continue;
      }
      if (effect.remainingTurns <= 0) continue;
      unit.hp = Math.max(0, unit.hp - effect.damagePerTurn);
      effect.remainingTurns -= 1;
      if (unit.hp <= 0) {
        unit.alive = false;
        deaths.push(unit.id);
      }
      if (effect.remainingTurns > 0 && unit.alive) {
        remaining.push(effect);
      }
    }
    this.state.statuses = remaining;
    if (deaths.length) {
      this.registerDeaths(deaths);
    }
  }

  private reduceZoneDurationsAfterRound(): void {
    if (this.state.zones.length === 0) return;
    this.state.zones = this.state.zones
      .map((zone) => ({ ...zone, remainingTurns: zone.remainingTurns - 1 }))
      .filter((zone) => zone.remainingTurns > 0);
    this.refreshPersistentZoneVisuals();
  }

  private cleanupExpiredZones(): void {
    const before = this.state.zones.length;
    this.state.zones = this.state.zones.filter((zone) => zone.remainingTurns > 0);
    if (this.state.zones.length !== before) {
      this.refreshPersistentZoneVisuals();
    }
  }

  private pointInRect(point: Vector, rect: { x: number; y: number; width: number; height: number }): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
  }

  private pointInsideMap(unit: UnitClone): boolean {
    const { radius } = unit.def;
    const map = this.map;
    return (
      unit.position.x >= radius &&
      unit.position.x <= map.width - radius &&
      unit.position.y >= radius &&
      unit.position.y <= map.height - radius
    );
  }

  private pointInsideCircleBounds(position: Vector, radius: number): boolean {
    const map = this.map;
    return (
      position.x >= radius &&
      position.x <= map.width - radius &&
      position.y >= radius &&
      position.y <= map.height - radius
    );
  }

  private isInHazard(position: Vector): boolean {
    return this.map.lakes.some((lake) => this.pointInRect(position, lake));
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
    const map = this.map;

    const createUnit = (def: UnitDefinition, team: TeamId, position: Vector, suffix: number): UnitState => ({
      id: `${def.id}-${team}-${suffix}`,
      def,
      team,
      hp: def.maxHp,
      position: { ...position },
      velocity: { x: 0, y: 0 },
      alive: true,
    });

    this.loadout.forEach((unitId, index) => {
      const def = getUnitDefinition(unitId);
      const playerSpawn = map.playerSpawns[index % map.playerSpawns.length];
      const botSpawn = map.botSpawns[index % map.botSpawns.length];
      units.push(createUnit(def, PLAYER_TEAM, playerSpawn, index));
      units.push(createUnit(def, BOT_TEAM, botSpawn, index));
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
      zones: [],
      statuses: [],
      activeProjectiles: [],
      activeZones: [],
      mapId: map.id,
    };

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
