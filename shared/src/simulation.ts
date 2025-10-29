import type {
  AoeZoneState,
  MatchSummary,
  PlayerRole,
  ProjectileState,
  RoundDiff,
  UnitAction,
  UnitState,
  Vector2,
} from './messages.js';
import type { UnitSchema } from './game-data.js';
import { PHYSICS_CONSTANTS, ROUND_CONFIG } from './constants.js';
import { createIdFactory, sumHp } from './utils.js';
import type { MapSchema, MinimalSnapshot, RuntimeAoe } from './types.js';

const UNIT_RADIUS = 0.8;
const MAX_SIMULATION_MS = 2000;
const TIME_STEP = PHYSICS_CONSTANTS.timestepMs / 1000;
const VELOCITY_SCALE = 0.35;
const GRAVITY = PHYSICS_CONSTANTS.gravity;
const BASE_FRICTION = PHYSICS_CONSTANTS.baseFriction;
const BOUNCE = PHYSICS_CONSTANTS.bounceDamping;

export interface RuntimeUnit extends UnitState {
  velocity: Vector2;
  statuses: DotStatus[];
}

export interface DotStatus {
  id: string;
  owner: PlayerRole;
  remaining: number;
  dmg: number;
}

export interface MatchRuntimeState {
  round: number;
  randomSeed: string;
  map: MapSchema;
  turnOrder: Record<PlayerRole, string[]>;
  cursors: Record<PlayerRole, number>;
  teams: Record<PlayerRole, RuntimeTeam>;
  aoeZones: RuntimeAoe[];
  graveTally: Map<string, { position: Vector2; count: number }>;
}

export interface RuntimeTeam {
  id: string;
  units: RuntimeUnit[];
  name: string;
}

export interface SimulationContext {
  map: MapSchema;
  unitsById: Record<string, UnitSchema>;
}

export interface SimulationOutcome {
  diff: RoundDiff;
  next: MatchRuntimeState;
  snapshot: MinimalSnapshot;
  summary?: MatchSummary;
}

export interface SimulationInput {
  state: MatchRuntimeState;
  actions: Record<PlayerRole, UnitAction | null>;
  actingOrder: PlayerRole[];
}

export function cloneRuntime(state: MatchRuntimeState): MatchRuntimeState {
  return {
    round: state.round,
    randomSeed: state.randomSeed,
    map: state.map,
    turnOrder: {
      you: [...state.turnOrder.you],
      opponent: [...state.turnOrder.opponent],
    },
    cursors: { ...state.cursors },
    teams: {
      you: {
        id: state.teams.you.id,
        name: state.teams.you.name,
        units: state.teams.you.units.map(cloneUnit),
      },
      opponent: {
        id: state.teams.opponent.id,
        name: state.teams.opponent.name,
        units: state.teams.opponent.units.map(cloneUnit),
      },
    },
    aoeZones: state.aoeZones.map(toAoeState),
    graveTally: new Map(state.graveTally),
  };
}

function cloneUnit(unit: RuntimeUnit): RuntimeUnit {
  return {
    id: unit.id,
    type: unit.type,
    hp: unit.hp,
    position: { ...unit.position },
    alive: unit.alive,
    velocity: { ...unit.velocity },
    statuses: unit.statuses.map((s) => ({ ...s })),
  };
}

export function createInitialRuntime(
  map: MapSchema,
  teams: Record<PlayerRole, { id: string; name: string; units: UnitState[] }>,
  turnOrder: Record<PlayerRole, string[]>,
  cursors: Record<PlayerRole, number>,
  firstSeed: string,
): MatchRuntimeState {
  return {
    round: 0,
    randomSeed: firstSeed,
    map,
    turnOrder: {
      you: [...turnOrder.you],
      opponent: [...turnOrder.opponent],
    },
    cursors: { ...cursors },
    teams: {
      you: {
        id: teams.you.id,
        name: teams.you.name,
        units: teams.you.units.map((unit) => ({
          ...unit,
          velocity: { x: 0, y: 0 },
          statuses: [],
        })),
      },
      opponent: {
        id: teams.opponent.id,
        name: teams.opponent.name,
        units: teams.opponent.units.map((unit) => ({
          ...unit,
          velocity: { x: 0, y: 0 },
          statuses: [],
        })),
      },
    },
    aoeZones: [],
    graveTally: new Map(),
  };
}

export function runtimeToSnapshot(state: MatchRuntimeState): MinimalSnapshot {
  return {
    round: state.round,
    mapId: state.map.id,
    you: {
      id: state.teams.you.id,
      displayName: state.teams.you.name,
      units: state.teams.you.units.map((unit) => ({
        id: unit.id,
        type: unit.type,
        hp: unit.hp,
        position: { ...unit.position },
        alive: unit.alive,
      })),
    },
    opponent: {
      id: state.teams.opponent.id,
      displayName: state.teams.opponent.name,
      units: state.teams.opponent.units.map((unit) => ({
        id: unit.id,
        type: unit.type,
        hp: unit.hp,
        position: { ...unit.position },
        alive: unit.alive,
      })),
    },
    aoeZones: state.aoeZones.map((zone) => ({
      ...zone,
      position: { ...zone.position },
      dot: { ...zone.dot },
    })),
  };
}

export function simulateRound(
  context: SimulationContext,
  input: SimulationInput,
): SimulationOutcome {
  const state = cloneRuntime(input.state);
  const upcomingRound = input.state.round + 1;
  const diff: RoundDiff = {
    hpChanges: [],
    deaths: [],
    graves: [],
    positions: [],
    projectiles: [],
    aoeUpserts: [],
    aoeExpires: [],
  };

  const cursorUpdates: Record<PlayerRole, number> = {
    you: state.cursors.you,
    opponent: state.cursors.opponent,
  };

  const killedUnits = new Set<string>();
  const nextProjectileId = createIdFactory(upcomingRound, 'proj');
  const nextAoeId = createIdFactory(upcomingRound, 'aoe');
  let forfeitWinner: PlayerRole | null = null;

  for (const role of input.actingOrder) {
    const action = input.actions[role];
    const opponent: PlayerRole = role === 'you' ? 'opponent' : 'you';
    const { unit, index } = findNextActiveUnit(state, role);
    if (!unit) {
      forfeitWinner = opponent;
      continue;
    }
    cursorUpdates[role] = index + 1;
    let resolvedAction: UnitAction = {
      unitId: unit.id,
      dragVec: { x: 0, y: 0 },
      skill: action?.skill,
    };
    if (action && action.unitId === unit.id) {
      resolvedAction = normalizeAction(action);
    }

    const stats = context.unitsById[unit.type];
    const impulses = resolvedAction.dragVec;
    unit.velocity = {
      x: impulses.x * VELOCITY_SCALE,
      y: impulses.y * VELOCITY_SCALE,
    };

    const collisionDamageTracker = new Set<string>();
    const maxSteps = Math.floor(MAX_SIMULATION_MS / PHYSICS_CONSTANTS.timestepMs);
    for (let step = 0; step < maxSteps; step++) {
      integrateUnit(state, unit, stats, diff, collisionDamageTracker, role, opponent, context.unitsById);
      if (Math.abs(unit.velocity.x) < 0.01 && Math.abs(unit.velocity.y) < 0.01) {
        break;
      }
      if (!unit.alive) {
        killedUnits.add(unit.id);
        break;
      }
    }

    if (!unit.alive) {
      killedUnits.add(unit.id);
    }

    if (stats.projectile) {
      const projectile = resolveProjectile(
        unit,
        stats.projectile,
        impulses,
        context,
        state,
        role,
        opponent,
        diff,
        nextProjectileId,
      );
      if (projectile) {
        diff.projectiles.push(projectile);
      }
    }

    if (stats.aoe) {
      const zone = placeAoeZone(unit, stats.aoe, impulses, role, nextAoeId);
      if (zone) {
        addOrRefreshZone(state, zone, diff);
      }
    }

    if (forfeitWinner) {
      break;
    }
  }

  applyAoeEffects(state, diff);
  applyDotDamage(state, diff, killedUnits);

  const recorded = new Set<string>();
  for (const role of ['you', 'opponent'] as PlayerRole[]) {
    for (const unit of state.teams[role].units) {
      if (!recorded.has(unit.id)) {
        diff.positions.push({ unitId: unit.id, position: { ...unit.position } });
        recorded.add(unit.id);
      }
    }
  }

  state.round += 1;
  state.cursors.you = cursorUpdates.you;
  state.cursors.opponent = cursorUpdates.opponent;

  const snapshot = runtimeToSnapshot(state);
  const summary =
    forfeitWinner !== null
      ? {
          rounds: state.round,
          winner: forfeitWinner,
          youRemaining: sumHp(state.teams.you.units),
          oppRemaining: sumHp(state.teams.opponent.units),
        }
      : computeMatchSummary(state);
  state.randomSeed = deriveNextSeed(input.state.randomSeed, state.round);

  return { diff, next: state, snapshot, summary };
}

function integrateUnit(
  state: MatchRuntimeState,
  unit: RuntimeUnit,
  stats: UnitSchema,
  diff: RoundDiff,
  collisionDamageTracker: Set<string>,
  owner: PlayerRole,
  opponentRole: PlayerRole,
  unitsById: Record<string, UnitSchema>,
) {
  if (!unit.alive) return;

  unit.velocity.y += GRAVITY * TIME_STEP;
  unit.position.x += unit.velocity.x;
  unit.position.y += unit.velocity.y;

  unit.velocity.x *= stats.moveFriction;
  unit.velocity.y *= stats.moveFriction;
  unit.velocity.x *= BASE_FRICTION;
  unit.velocity.y *= BASE_FRICTION;

  enforceBounds(state.map, unit, stats);

  for (const teamRole of ['you', 'opponent'] as PlayerRole[]) {
    const team = state.teams[teamRole];
    for (const other of team.units) {
      if (other.id === unit.id || !other.alive) continue;
      const dx = unit.position.x - other.position.x;
      const dy = unit.position.y - other.position.y;
      const distSq = dx * dx + dy * dy;
      const minDist = UNIT_RADIUS * 2;
      if (distSq < minDist * minDist && distSq > 0) {
        const distance = Math.sqrt(distSq);
        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = minDist - distance;
        unit.position.x += nx * (overlap / 2);
        unit.position.y += ny * (overlap / 2);
        other.position.x -= nx * (overlap / 2);
        other.position.y -= ny * (overlap / 2);

        if (teamRole !== owner) {
          if (!collisionDamageTracker.has(other.id)) {
            collisionDamageTracker.add(other.id);
            applyDamage(state, other, unitsById[unit.type].collideDmg, diff);
            other.velocity.x += nx * unitsById[unit.type].knockback;
            other.velocity.y += ny * unitsById[unit.type].knockback;
            unit.velocity.x -= nx * unitsById[unit.type].selfRecoil;
            unit.velocity.y -= ny * unitsById[unit.type].selfRecoil;
            if (!other.alive) {
              recordGrave(state, other, diff);
            }
          }
        } else {
          unit.velocity.x -= nx * PHYSICS_CONSTANTS.friendlyPushScale;
          unit.velocity.y -= ny * PHYSICS_CONSTANTS.friendlyPushScale;
          other.velocity.x += nx * PHYSICS_CONSTANTS.friendlyPushScale;
          other.velocity.y += ny * PHYSICS_CONSTANTS.friendlyPushScale;
        }
      }
    }
  }

  if (isInHazard(state.map, unit.position)) {
    unit.alive = false;
    recordGrave(state, unit, diff);
  }
}

function applyDamage(state: MatchRuntimeState, unit: RuntimeUnit, dmg: number, diff: RoundDiff) {
  unit.hp -= dmg;
  diff.hpChanges.push({ unitId: unit.id, delta: -dmg });
  if (unit.hp <= 0 && unit.alive) {
    unit.alive = false;
    recordGrave(state, unit, diff);
  }
}

function recordGrave(state: MatchRuntimeState, unit: RuntimeUnit, diff: RoundDiff) {
  const key = `${unit.position.x.toFixed(2)}:${unit.position.y.toFixed(2)}`;
  const entry = state.graveTally.get(key) ?? { position: { ...unit.position }, count: 0 };
  entry.count += 1;
  state.graveTally.set(key, entry);
  if (!diff.deaths.some((death) => death.unitId === unit.id)) {
    diff.deaths.push({ unitId: unit.id, position: { ...unit.position } });
  }
  diff.graves = Array.from(state.graveTally.values()).map((grave) => ({
    position: { ...grave.position },
    unitId: `${grave.position.x}:${grave.position.y}`,
    count: grave.count,
  }));
}

function enforceBounds(map: MapSchema, unit: RuntimeUnit, stats: UnitSchema) {
  const minX = UNIT_RADIUS;
  const maxX = map.bounds.w - UNIT_RADIUS;
  const minY = UNIT_RADIUS;
  const maxY = map.bounds.h - UNIT_RADIUS;

  if (unit.position.x < minX) {
    unit.position.x = minX;
    unit.velocity.x = Math.abs(unit.velocity.x) * BOUNCE;
  } else if (unit.position.x > maxX) {
    unit.position.x = maxX;
    unit.velocity.x = -Math.abs(unit.velocity.x) * BOUNCE;
  }
  if (unit.position.y < minY) {
    unit.position.y = minY;
    unit.velocity.y = Math.abs(unit.velocity.y) * BOUNCE;
  } else if (unit.position.y > maxY) {
    unit.position.y = maxY;
    unit.velocity.y = -Math.abs(unit.velocity.y) * BOUNCE;
  }

  for (const wall of map.walls) {
    const bounds = polygonBounds(wall.polygon);
    if (
      unit.position.x >= bounds.minX - UNIT_RADIUS &&
      unit.position.x <= bounds.maxX + UNIT_RADIUS &&
      unit.position.y >= bounds.minY - UNIT_RADIUS &&
      unit.position.y <= bounds.maxY + UNIT_RADIUS
    ) {
      const prevX = clamp(unit.position.x, bounds.minX, bounds.maxX);
      const prevY = clamp(unit.position.y, bounds.minY, bounds.maxY);
      const dx = unit.position.x - prevX;
      const dy = unit.position.y - prevY;
      if (Math.abs(dx) > Math.abs(dy)) {
        unit.position.x = dx > 0 ? bounds.maxX + UNIT_RADIUS : bounds.minX - UNIT_RADIUS;
        unit.velocity.x = -unit.velocity.x * wall.bounciness;
      } else {
        unit.position.y = dy > 0 ? bounds.maxY + UNIT_RADIUS : bounds.minY - UNIT_RADIUS;
        unit.velocity.y = -unit.velocity.y * wall.bounciness;
      }
    }
  }
}

function isInHazard(map: MapSchema, point: Vector2): boolean {
  if (point.x < 0 || point.y < 0 || point.x > map.bounds.w || point.y > map.bounds.h) {
    return true;
  }
  return map.lakes.some((lake) => pointInPolygon(point, lake.polygon));
}

function clampImpulse(vec: Vector2): Vector2 {
  const mag = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
  if (mag <= PHYSICS_CONSTANTS.dragImpulseCap) {
    return { ...vec };
  }
  const scale = PHYSICS_CONSTANTS.dragImpulseCap / (mag || 1);
  return { x: vec.x * scale, y: vec.y * scale };
}

function normalizeAction(action: UnitAction): UnitAction {
  return {
    unitId: action.unitId,
    dragVec: clampImpulse(action.dragVec),
    skill: action.skill,
  };
}

function findNextActiveUnit(state: MatchRuntimeState, role: PlayerRole) {
  const turnOrder = state.turnOrder[role];
  const cursor = Math.min(state.cursors[role], turnOrder.length - 1);
  for (let idx = cursor; idx < turnOrder.length; idx++) {
    const unitId = turnOrder[idx];
    const unit = state.teams[role].units.find((u) => u.id === unitId && u.alive);
    if (unit) {
      return { unit, index: idx };
    }
  }
  return { unit: null, index: turnOrder.length };
}

function resolveProjectile(
  unit: RuntimeUnit,
  spec: UnitSchema['projectile'],
  impulse: Vector2,
  context: SimulationContext,
  state: MatchRuntimeState,
  owner: PlayerRole,
  opponentRole: PlayerRole,
  diff: RoundDiff,
  idFactory?: () => string,
): ProjectileState | null {
  if (!spec) return null;
  const makeId = idFactory ?? (() => `${unit.id}-projectile-${Date.now()}`);
  const direction = normalizeVector(impulse);
  if (direction.x === 0 && direction.y === 0) {
    return null;
  }
  const range = spec.baseRange + spec.rangeGainPerForce * magnitude(impulse);
  const step = 0.5;
  let travelled = 0;
  let pos = { ...unit.position };
  while (travelled < range) {
    pos = { x: pos.x + direction.x * step, y: pos.y + direction.y * step };
    travelled += step;
    if (isInHazard(context.map, pos) && spec.stopOn.out) {
      break;
    }
    for (const enemy of state.teams[opponentRole].units) {
      if (!enemy.alive) continue;
      const distSq = distanceSq(enemy.position, pos);
      if (distSq < UNIT_RADIUS * UNIT_RADIUS) {
        applyDamage(state, enemy, spec.dmg, diff);
        if (spec.pushbackSmall) {
          const dir = normalizeVector({
            x: enemy.position.x - unit.position.x,
            y: enemy.position.y - unit.position.y,
          });
          enemy.velocity.x += dir.x * PHYSICS_CONSTANTS.enemyKnockbackScale;
          enemy.velocity.y += dir.y * PHYSICS_CONSTANTS.enemyKnockbackScale;
        }
        return {
          id: makeId(),
          owner,
          position: pos,
          velocity: { x: direction.x * step, y: direction.y * step },
        };
      }
    }
    if (context.map.walls.some((wall) => pointInPolygon(pos, wall.polygon)) && spec.stopOn.wall) {
      break;
    }
  }
  return {
    id: makeId(),
    owner,
    position: pos,
    velocity: { x: direction.x * step, y: direction.y * step },
  };
}

function placeAoeZone(
  unit: RuntimeUnit,
  spec: NonNullable<UnitSchema['aoe']>,
  impulse: Vector2,
  owner: PlayerRole,
  idFactory?: () => string,
): RuntimeAoe | null {
  const direction = normalizeVector(impulse);
  const force = magnitude(impulse);
  const distance = spec.scalesWithForce ? Math.min(spec.maxPlaceDist, force) : spec.maxPlaceDist;
  const position = {
    x: unit.position.x + direction.x * distance,
    y: unit.position.y + direction.y * distance,
  };
  return {
    id: idFactory ? idFactory() : `${unit.id}-aoe-${Date.now()}`,
    ttl: spec.ttlRounds,
    position,
    radius: spec.size / 2,
    owner,
    dot: {
      dmg: spec.dot.dmg,
      duration: spec.dot.durationRounds,
      refresh: spec.dot.refresh,
      stack: spec.dot.stack,
    },
  };
}

function addOrRefreshZone(state: MatchRuntimeState, zone: RuntimeAoe, diff: RoundDiff) {
  const existing = state.aoeZones.find((current) => distanceSq(current.position, zone.position) < 1);
  if (existing) {
    existing.ttl = zone.ttl;
    diff.aoeUpserts.push(toAoeState(existing));
    return;
  }
  state.aoeZones.push(zone);
  diff.aoeUpserts.push(toAoeState(zone));
}

function applyAoeEffects(state: MatchRuntimeState, diff: RoundDiff) {
  for (const zone of state.aoeZones) {
    for (const role of ['you', 'opponent'] as PlayerRole[]) {
      for (const unit of state.teams[role].units) {
        if (!unit.alive) continue;
        if (distanceSq(unit.position, zone.position) <= zone.radius * zone.radius) {
          const existing = unit.statuses.find((status) => status.id === zone.id);
          if (existing && zone.dot.refresh) {
            existing.remaining = Math.max(existing.remaining, zone.dot.duration);
            existing.dmg = zone.dot.dmg;
          }
          if (!existing) {
            unit.statuses.push({
              id: zone.id,
              owner: zone.owner,
              remaining: zone.dot.duration,
              dmg: zone.dot.dmg,
            });
          } else if (zone.dot.stack) {
            unit.statuses.push({
              id: `${zone.id}-${unit.statuses.length}`,
              owner: zone.owner,
              remaining: zone.dot.duration,
              dmg: zone.dot.dmg,
            });
          }
        }
      }
    }
  }
}

function applyDotDamage(state: MatchRuntimeState, diff: RoundDiff, killedUnits: Set<string>) {
  const expiredZones: string[] = [];
  for (const zone of state.aoeZones) {
    zone.ttl -= 1;
    if (zone.ttl <= 0) {
      expiredZones.push(zone.id);
    }
  }
  if (expiredZones.length > 0) {
    state.aoeZones = state.aoeZones.filter((zone) => zone.ttl > 0);
    diff.aoeExpires.push(...expiredZones);
  }

  for (const role of ['you', 'opponent'] as PlayerRole[]) {
    for (const unit of state.teams[role].units) {
      if (!unit.alive) continue;
      unit.statuses = unit.statuses.filter((status) => {
        applyDamage(state, unit, status.dmg, diff);
        status.remaining -= 1;
        if (unit.hp <= 0 && !killedUnits.has(unit.id)) {
          killedUnits.add(unit.id);
          recordGrave(state, unit, diff);
        }
        return status.remaining > 0;
      });
    }
  }
}

function toAoeState(zone: RuntimeAoe): AoeZoneState {
  return {
    id: zone.id,
    ttl: zone.ttl,
    position: { ...zone.position },
    radius: zone.radius,
    owner: zone.owner,
  };
}

function computeMatchSummary(state: MatchRuntimeState): MatchSummary | undefined {
  const youAlive = state.teams.you.units.filter((unit) => unit.alive);
  const oppAlive = state.teams.opponent.units.filter((unit) => unit.alive);
  if (youAlive.length === 0 || oppAlive.length === 0) {
    const winner = youAlive.length > 0 ? 'you' : oppAlive.length > 0 ? 'opponent' : 'draw';
    return {
      rounds: state.round,
      winner,
      youRemaining: youAlive.reduce((sum, unit) => sum + Math.max(unit.hp, 0), 0),
      oppRemaining: oppAlive.reduce((sum, unit) => sum + Math.max(unit.hp, 0), 0),
    };
  }
  return undefined;
}

export function encodeRoundHashPayload(diff: RoundDiff, randomSeed: string): string {
  const payload = {
    randomSeed,
    diff,
  };
  return JSON.stringify(payload, (_, value) => (typeof value === 'number' ? Number(value.toFixed(5)) : value));
}

function deriveNextSeed(previous: string, round: number): string {
  let hash = 0;
  for (let i = 0; i < previous.length; i++) {
    hash = (hash * 31 + previous.charCodeAt(i)) & 0xffffffff;
  }
  hash = (hash + round * 97) & 0xffffffff;
  return `seed-${hash >>> 0}`;
}

function polygonBounds(points: Vector2[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function pointInPolygon(point: Vector2, polygon: Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 0.00001) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function normalizeVector(vec: Vector2): Vector2 {
  const mag = magnitude(vec);
  if (mag === 0) return { x: 0, y: 0 };
  return { x: vec.x / mag, y: vec.y / mag };
}

function magnitude(vec: Vector2): number {
  return Math.sqrt(vec.x * vec.x + vec.y * vec.y);
}

function distanceSq(a: Vector2, b: Vector2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
