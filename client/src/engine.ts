import { GAME_CONSTANTS, TEAM_LOADOUT, getUnitDefinition } from './config';
import { add, clampMagnitude, distance, length, normalize, rotate, scale, subtract } from './math';
import type {
  DragAction,
  GameState,
  SimulationFrame,
  SimulationResult,
  SimulationFrameProjectile,
  SimulationFrameZone,
  GameMode,
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

interface UnitSnapshot {
  hp: number;
  alive: boolean;
  team: TeamId;
  position: Vector;
}

export class GameEngine {
  private state: GameState;
  private listeners: EngineListeners;
  private pendingBotTimeout: number | null = null;
  private projectileCounter = 0;
  private zoneCounter = 0;
  private map: MapDefinition;
  private readonly loadout: string[];
  private mode: GameMode;
  private playerTeam: TeamId;
  private onlineReady = true;

  constructor(
    listeners: EngineListeners,
    map: MapDefinition,
    loadout: string[] = TEAM_LOADOUT,
    mode: GameMode = 'bot',
    playerTeam: TeamId = PLAYER_TEAM
  ) {
    this.listeners = listeners;
    this.map = structuredClone(map);
    this.loadout = [...loadout];
    this.mode = mode;
    this.playerTeam = playerTeam;
    this.state = this.createInitialState();
  }

  startNewGame(map?: MapDefinition, mode?: GameMode, playerTeam?: TeamId): void {
    if (this.pendingBotTimeout) {
      window.clearTimeout(this.pendingBotTimeout);
      this.pendingBotTimeout = null;
    }
    this.projectileCounter = 0;
    this.zoneCounter = 0;
    if (mode) {
      this.mode = mode;
    }
    if (map) {
      this.map = structuredClone(map);
    }
    if (playerTeam !== undefined) {
      this.playerTeam = playerTeam;
    }
    this.state = this.createInitialState();
    this.emitState();
  }

  setPlayerTeam(team: TeamId): void {
    this.playerTeam = team;
  }

  setOnlineReady(ready: boolean): void {
    this.onlineReady = ready;
  }

  getPlayerTeam(): TeamId {
    return this.playerTeam;
  }

  private getOpponentTeam(team: TeamId): TeamId {
    return team === PLAYER_TEAM ? BOT_TEAM : PLAYER_TEAM;
  }

  private resolveZoneColor(spec: NonNullable<UnitDefinition['aoe']>, team: TeamId): string {
    const fromTeam = spec.teamColors?.[team];
    return fromTeam ?? spec.color;
  }

  getSnapshot(): GameState {
    return structuredClone(this.state);
  }

  getActiveUnit(): UnitState | null {
    return this.findNextAlive(this.state.activeTeam).unit;
  }

  canPlayerAct(): boolean {
    if (this.state.phase !== 'aim' || this.state.winner) {
      return false;
    }
    if (this.mode === 'hotseat') {
      return true;
    }
    if (this.mode === 'online' && !this.onlineReady) {
      return false;
    }
    return this.state.activeTeam === this.playerTeam;
  }

  beginPlayerAction(actionVector: Vector): void {
    const action = this.createActionFromVector(actionVector);
    if (!action) return;
    const actingTeam = this.state.activeTeam;
    if (this.mode === 'bot' && actingTeam !== this.playerTeam) {
      return;
    }
    if (this.mode === 'online') {
      return;
    }
    this.executeAction(action, actingTeam);
  }

  createActionFromVector(actionVector: Vector): DragAction | null {
    if (!this.canPlayerAct()) return null;
    const actingTeam = this.state.activeTeam;
    const unit = this.getActiveUnit();
    if (!unit) {
      this.handleWin(this.getOpponentTeam(actingTeam));
      return null;
    }
    const drag = clampMagnitude(actionVector, unit.def.maxPower);
    const power = length(drag);
    return {
      unitId: unit.id,
      power,
      vector: drag,
    };
  }

  beginNetworkAction(action: DragAction, actingTeam: TeamId): void {
    if (this.mode !== 'online') {
      return;
    }
    if (this.state.winner || this.state.phase === 'ended') {
      return;
    }
    if (actingTeam !== this.state.activeTeam) {
      return;
    }
    this.executeAction(action, actingTeam);
  }

  private scheduleBot(): void {
    if (this.mode !== 'bot') return;
    if (this.state.phase !== 'bot-planning' || this.state.winner) return;
    if (this.pendingBotTimeout) {
      window.clearTimeout(this.pendingBotTimeout);
    }
    this.pendingBotTimeout = window.setTimeout(() => {
      this.pendingBotTimeout = null;
      const unitInfo = this.findNextAlive(BOT_TEAM);
      if (!unitInfo.unit) {
        this.handleWin(this.playerTeam);
        return;
      }
      const botAction = this.createBotAction(unitInfo.unit);
      this.executeAction(botAction, BOT_TEAM);
    }, 650);
  }

  private executeAction(action: DragAction, actingTeam: TeamId): void {
    const unit = this.state.units.find((u) => u.id === action.unitId && u.alive);
    if (!unit) return;
    const order = this.state.orders[actingTeam];
    const actingIndex = order.queue.indexOf(action.unitId);
    if (actingIndex !== -1) {
      order.nextIndex = actingIndex;
    }
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
    const deathOutcome = this.registerDeaths(result.deaths);
    if (deathOutcome === 'draw') {
      this.handleDraw();
      return;
    }
    if (deathOutcome !== null) {
      const losingTeam = deathOutcome as TeamId;
      const winner = this.getOpponentTeam(losingTeam);
      this.handleWin(winner);
      return;
    }
    this.addZones(result.zonesToAdd);
    this.applyStatusInflictions(result.inflictedStatuses);

    const actedOrder = this.state.orders[actingTeam];
    actedOrder.nextIndex = (actedOrder.nextIndex + 1) % actedOrder.queue.length;

    if (actingTeam === BOT_TEAM) {
      this.reduceZoneDurationsAfterRound();
    }
    this.cleanupExpiredZones();

    const otherTeam: TeamId = this.getOpponentTeam(actingTeam);
    this.state.activeTeam = otherTeam;

    if (this.state.activeTeam === this.playerTeam) {
      this.state.round += 1;
    }

    const statusOutcome = this.applyTurnStartEffects(this.state.activeTeam);
    if (statusOutcome === 'draw') {
      this.handleDraw();
      return;
    }
    if (statusOutcome !== null) {
      const losingTeam = statusOutcome as TeamId;
      const winner = this.getOpponentTeam(losingTeam);
      this.handleWin(winner);
      return;
    }

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

    if (this.mode === 'bot' && this.state.activeTeam === BOT_TEAM) {
      this.state.phase = 'bot-planning';
      this.emitState();
      this.scheduleBot();
    } else {
      this.state.phase = 'aim';
      this.emitState();
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

  private registerDeaths(deaths: string[]): TeamId | 'draw' | null {
    if (deaths.length === 0) return null;
    let outcome: TeamId | 'draw' | null = null;
    for (const unitId of deaths) {
      const unit = this.state.units.find((u) => u.id === unitId);
      if (!unit) continue;
      unit.alive = false;
      this.state.graves.push({
        position: { ...unit.position },
        team: unit.team,
      });
      if (unit.def.loseOnDeath) {
        if (outcome === null) {
          outcome = unit.team;
        } else if (outcome !== unit.team) {
          outcome = 'draw';
        }
      }
    }
    if (deaths.length) {
      this.state.statuses = this.state.statuses.filter((status) => !deaths.includes(status.unitId));
    }
    return outcome;
  }

  private simulateAction(action: DragAction): SimulationResult {
    const clones: UnitClone[] = this.state.units.map((unit) => ({
      ...structuredClone(unit),
      velocity: { x: 0, y: 0 },
    }));

    const aliveAtStart = new Set(clones.filter((unit) => unit.alive).map((unit) => unit.id));

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
        color: this.resolveZoneColor(spec, attacker.team),
      };
      newZones.push(zone);
      zoneClones.push(zone);
    }

    const processedZoneHits = new Set<string>();
    const damagedUnits = new Set<string>();
    const collisionDamageImmunities = new Set<string>();

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
      const collisionDamageMemory = new Set<string>();
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
                activeVelocities.delete(clone.id);
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
        if (!clone.alive) {
          activeVelocities.delete(clone.id);
          continue;
        }
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
        if (!clone.alive) continue;
        const currentVel = activeVelocities.get(clone.id);
        const moving = Boolean(currentVel);
        for (const other of clones) {
          if (clone.id === other.id || !other.alive) continue;
          const dist = distance(clone.position, other.position);
          const minDist = clone.def.radius + other.def.radius;
          if (dist === 0 || dist >= minDist) continue;
          const dir = normalize(subtract(other.position, clone.position));
          const overlap = minDist - dist;
          const cloneImmovable = clone.def.controllable === false;
          const otherImmovable = other.def.controllable === false;
          if (cloneImmovable && otherImmovable) {
            continue;
          }
          if (cloneImmovable) {
            other.position = add(other.position, scale(dir, overlap));
          } else if (otherImmovable) {
            clone.position = add(clone.position, scale(dir, -overlap));
          } else {
            clone.position = add(clone.position, scale(dir, -overlap / 2));
            other.position = add(other.position, scale(dir, overlap / 2));
          }

          if (clone.team === other.team) {
            const shove = scale(dir, 40);
            if (!cloneImmovable) {
              const newVelA = add(activeVelocities.get(clone.id) ?? { x: 0, y: 0 }, scale(shove, -0.5));
              activeVelocities.set(clone.id, newVelA);
            }
            if (!otherImmovable) {
              const newVelB = add(activeVelocities.get(other.id) ?? { x: 0, y: 0 }, scale(shove, 0.5));
              activeVelocities.set(other.id, newVelB);
            }
          } else if (moving) {
            const immunityKey = `${clone.id}|${other.id}`;
            if (collisionDamageImmunities.has(immunityKey)) {
              continue;
            }
            const blockKey = `${clone.id}->${other.id}`;
            if (collisionDamageMemory.has(blockKey)) {
              continue;
            }
            const hittingAttacker = other.id === attacker.id;
            if (!hittingAttacker && !damagedUnits.has(other.id)) {
              other.hp = Math.max(0, other.hp - clone.def.collideDamage);
              if (other.hp === 0) {
                other.alive = false;
                activeVelocities.delete(other.id);
              }
              damagedUnits.add(other.id);
            }
            if (!otherImmovable) {
              const knockScale = clone.def.knockback * (1 - other.def.resistance);
              const targetVel = add(activeVelocities.get(other.id) ?? { x: 0, y: 0 }, scale(dir, knockScale));
              activeVelocities.set(other.id, targetVel);
            }
            const recoilVec = add(activeVelocities.get(clone.id) ?? { x: 0, y: 0 }, scale(dir, -clone.def.recoil));
            activeVelocities.set(clone.id, recoilVec);
            collisionDamageMemory.add(`${other.id}->${clone.id}`);
            collisionDamageImmunities.add(`${other.id}|${clone.id}`);
            if (hittingAttacker) {
              collisionDamageImmunities.add(`${clone.id}|${other.id}`);
            }
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
      const startedAlive = aliveAtStart.has(clone.id);
      let dead = !clone.alive;
      if (!dead && clone.hp <= 0) {
        clone.alive = false;
        activeVelocities.delete(clone.id);
        dead = true;
      }
      if (!dead && !this.pointInsideMap(clone)) {
        clone.alive = false;
        activeVelocities.delete(clone.id);
        dead = true;
      }
      if (!dead && this.isInHazard(clone.position)) {
        clone.alive = false;
        activeVelocities.delete(clone.id);
        dead = true;
      }
      if (dead && startedAlive) {
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

  private applyTurnStartEffects(team: TeamId): TeamId | 'draw' | null {
    if (this.state.statuses.length === 0) return null;
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
      return this.registerDeaths(deaths);
    }
    return null;
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
    const fallbackVector = clampMagnitude({ x: -unit.def.maxPower, y: 0 }, unit.def.maxPower);
    const fallback: DragAction = {
      unitId: unit.id,
      vector: fallbackVector,
      power: length(fallbackVector),
    };

    if (enemies.length === 0) {
      return fallback;
    }

    const baseline = this.snapshotUnits();
    const candidates = this.generateBotCandidates(unit, enemies);
    let bestAction: DragAction = fallback;
    let bestScore = -Infinity;

    for (const vector of candidates) {
      const power = length(vector);
      if (power < 1) continue;
      const action: DragAction = { unitId: unit.id, vector, power };
      const score = this.evaluateBotCandidate(unit, action, baseline);
      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }

    return bestScore === -Infinity ? fallback : bestAction;
  }

  private generateBotCandidates(unit: UnitState, enemies: UnitState[]): Vector[] {
    const candidates: Vector[] = [];
    const seen = new Set<string>();
    const push = (vector: Vector) => {
      const clamped = clampMagnitude(vector, unit.def.maxPower);
      if (length(clamped) < 4) return;
      const key = `${Math.round(clamped.x)}:${Math.round(clamped.y)}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(clamped);
    };

    push({ x: -unit.def.maxPower, y: 0 });

    let nearest: UnitState | null = null;
    let nearestDist = Infinity;

    for (const enemy of enemies) {
      const diff = subtract(enemy.position, unit.position);
      const baseDist = length(diff);
      if (baseDist === 0) continue;
      if (baseDist < nearestDist) {
        nearestDist = baseDist;
        nearest = enemy;
      }
      const baseDir = normalize(diff);
      const stride = Math.max(baseDist, unit.def.maxPower * 0.75);
      push(scale(baseDir, stride));

      const offsets = [Math.PI / 10, -Math.PI / 10, Math.PI / 6, -Math.PI / 6];
      for (const angle of offsets) {
        const rotated = rotate(baseDir, angle);
        push(scale(rotated, stride));
      }

      if (this.map.lakes.length) {
        for (const lake of this.map.lakes) {
          const center = { x: lake.x + lake.width / 2, y: lake.y + lake.height / 2 };
          const towardHazard = normalize(subtract(center, enemy.position));
          if (length(towardHazard) === 0) continue;
          const blended = normalize(add(baseDir, towardHazard));
          if (length(blended) === 0) continue;
          push(scale(blended, Math.max(stride, unit.def.maxPower * 0.85)));
        }
      }
    }

    if (nearest) {
      const retreat = normalize(subtract(unit.position, nearest.position));
      if (length(retreat) > 0) {
        push(scale(retreat, unit.def.maxPower * 0.6));
      }
    }

    push({ x: -unit.def.maxPower * 0.6, y: unit.def.maxPower * 0.35 });
    push({ x: -unit.def.maxPower * 0.6, y: -unit.def.maxPower * 0.35 });

    return candidates;
  }

  private evaluateBotCandidate(unit: UnitState, action: DragAction, baseline: Map<string, UnitSnapshot>): number {
    const savedProjectile = this.projectileCounter;
    const savedZone = this.zoneCounter;
    const result = this.simulateAction(action);
    this.projectileCounter = savedProjectile;
    this.zoneCounter = savedZone;
    return this.scoreSimulation(unit, baseline, result);
  }

  private scoreSimulation(unit: UnitState, baseline: Map<string, UnitSnapshot>, result: SimulationResult): number {
    const actingTeam = unit.team;
    let score = 0;
    const finalLookup = new Map(result.finalUnits.map((entry) => [entry.id, entry]));

    for (const [id, before] of baseline.entries()) {
      const after = finalLookup.get(id);
      if (!after) continue;
      const delta = before.hp - after.hp;
      if (before.team !== actingTeam) {
        if (delta > 0) {
          score += delta * 2.4;
        }
        if (before.alive && !after.alive) {
          score += 500;
        }
      } else {
        if (delta > 0) {
          score -= delta * 1.7;
        }
        if (before.alive && !after.alive) {
          score -= 650;
        }
      }
    }

    for (const status of result.inflictedStatuses) {
      const before = baseline.get(status.unitId);
      if (!before) continue;
      const projected = status.damagePerTurn * status.remainingTurns;
      if (before.team !== actingTeam) {
        score += projected * 1.2;
      } else {
        score -= projected * 1.2;
      }
    }

    for (const zone of result.zonesToAdd) {
      let coverage = 0;
      for (const after of result.finalUnits) {
        if (!after.alive || after.team === actingTeam) continue;
        if (distance(after.position, zone.center) <= zone.radius + after.def.radius) {
          coverage += 1;
        }
      }
      if (coverage > 0) {
        score += coverage * zone.dotDamage * zone.dotDuration * 1.1;
      }
    }

    const actorFinal = finalLookup.get(unit.id);
    if (!actorFinal || !actorFinal.alive) {
      score -= 700;
    } else {
      if (!this.pointInsideCircleBounds(actorFinal.position, actorFinal.def.radius)) {
        score -= 500;
      }
      if (this.isInHazard(actorFinal.position)) {
        score -= 400;
      }
    }

    for (const after of result.finalUnits) {
      if (after.team !== actingTeam || after.id === unit.id) continue;
      const before = baseline.get(after.id);
      if (!before) continue;
      if (after.hp < before.hp) {
        score -= (before.hp - after.hp) * 1.2;
      }
      if (before.alive && !after.alive) {
        score -= 400;
      }
    }

    return score;
  }

  private snapshotUnits(): Map<string, UnitSnapshot> {
    const map = new Map<string, UnitSnapshot>();
    for (const unit of this.state.units) {
      map.set(unit.id, {
        hp: unit.hp,
        alive: unit.alive,
        team: unit.team,
        position: { ...unit.position },
      });
    }
    return map;
  }

  private emitState(): void {
    this.state.mode = this.mode;
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
    return this.state.units.some(
      (u) => u.team === team && u.alive && u.def.controllable !== false,
    );
  }

  private findNextAlive(team: TeamId): { unit: UnitState | null; index: number } {
    const order = this.state.orders[team];
    const { queue } = order;
    for (let offset = 0; offset < queue.length; offset += 1) {
      const index = (order.nextIndex + offset) % queue.length;
      const unitId = queue[index];
      const unit = this.state.units.find((u) => u.id === unitId && u.alive);
      if (unit) {
        return { unit, index };
      }
    }
    return { unit: null, index: order.nextIndex };
  }

  private createInitialState(): GameState {
    const units: UnitState[] = [];
    const map = this.map;

    const createUnit = (
      def: UnitDefinition,
      team: TeamId,
      position: Vector,
      suffix: string | number,
    ): UnitState => ({
      id: `${def.id}-${team}-${suffix}`,
      def,
      team,
      hp: def.maxHp,
      position: { ...position },
      velocity: { x: 0, y: 0 },
      alive: true,
    });

    const playerLoadout = map.teamLoadouts?.[PLAYER_TEAM] ?? this.loadout;
    const botLoadout = map.teamLoadouts?.[BOT_TEAM] ?? this.loadout;
    const maxSlots = Math.max(playerLoadout.length, botLoadout.length);

    for (let index = 0; index < maxSlots; index += 1) {
      if (index < playerLoadout.length) {
        const unitId = playerLoadout[index];
        const def = getUnitDefinition(unitId);
        const spawn = this.ensureSafeSpawn(map.playerSpawns[index % map.playerSpawns.length], def.radius);
        units.push(createUnit(def, PLAYER_TEAM, spawn, index));
      }
      if (index < botLoadout.length) {
        const unitId = botLoadout[index];
        const def = getUnitDefinition(unitId);
        const spawn = this.ensureSafeSpawn(map.botSpawns[index % map.botSpawns.length], def.radius);
        units.push(createUnit(def, BOT_TEAM, spawn, index));
      }
    }

    map.vipUnits?.forEach((vip, index) => {
      const def = getUnitDefinition(vip.unitId ?? 'vip');
      const spawn = this.ensureSafeSpawn(vip.position, def.radius);
      units.push(createUnit(def, vip.team, spawn, `vip-${index}`));
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
      mode: this.mode,
    };

    return state;
  }

  private createOrder(units: UnitState[], team: TeamId): TurnOrderState {
    const teamUnits = units.filter((u) => u.team === team && u.def.controllable !== false);
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

  private ensureSafeSpawn(base: Vector, radius: number): Vector {
    const candidate: Vector = { x: base.x, y: base.y };
    const hazards = [...this.map.lakes, ...this.map.walls];
    const margin = 4;
    const clampWithinBounds = () => {
      candidate.x = Math.min(this.map.width - radius - margin, Math.max(radius + margin, candidate.x));
      candidate.y = Math.min(this.map.height - radius - margin, Math.max(radius + margin, candidate.y));
    };

    clampWithinBounds();
    for (let iter = 0; iter < 8; iter += 1) {
      let adjusted = false;
      for (const hazard of hazards) {
        const left = hazard.x - radius - margin;
        const right = hazard.x + hazard.width + radius + margin;
        const top = hazard.y - radius - margin;
        const bottom = hazard.y + hazard.height + radius + margin;
        if (candidate.x > left && candidate.x < right && candidate.y > top && candidate.y < bottom) {
          const distances = [
            { side: 'left' as const, value: candidate.x - left },
            { side: 'right' as const, value: right - candidate.x },
            { side: 'top' as const, value: candidate.y - top },
            { side: 'bottom' as const, value: bottom - candidate.y },
          ];
          const nearest = distances.reduce((min, current) => (current.value < min.value ? current : min), distances[0]);
          switch (nearest.side) {
            case 'left':
              candidate.x = left - margin;
              break;
            case 'right':
              candidate.x = right + margin;
              break;
            case 'top':
              candidate.y = top - margin;
              break;
            case 'bottom':
              candidate.y = bottom + margin;
              break;
          }
          adjusted = true;
        }
      }
      clampWithinBounds();
      if (!adjusted) {
        break;
      }
    }
    return candidate;
  }
}
