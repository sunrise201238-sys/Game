export type TeamId = 0 | 1;
export type GameMode = 'bot' | 'hotseat';

export interface Vector {
  x: number;
  y: number;
}

export interface ProjectileSpec {
  speed: number;
  radius: number;
  maxDistance: number;
  damage: number;
  knockback: number;
  color: string;
  previewScale?: number;
}

export interface AoeSpec {
  radius: number;
  duration: number;
  dotDamage: number;
  dotDuration: number;
  placementRange: number;
  travelScale: number;
  color: string;
  teamColors?: Partial<Record<TeamId, string>>;
}

export interface UnitDefinition {
  id: string;
  name: string;
  color: string;
  radius: number;
  maxHp: number;
  collideDamage: number;
  knockback: number;
  recoil: number;
  resistance: number;
  maxPower: number;
  projectile?: ProjectileSpec;
  aoe?: AoeSpec;
}

export interface UnitState {
  id: string;
  def: UnitDefinition;
  team: TeamId;
  hp: number;
  position: Vector;
  velocity: Vector;
  alive: boolean;
}

export interface GraveMarker {
  position: Vector;
  team: TeamId;
  count: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  lakes: Rect[];
  walls: Rect[];
  playerSpawns: Vector[];
  botSpawns: Vector[];
  description?: string;
}

export type GamePhase = 'aim' | 'bot-planning' | 'animating' | 'ended';

export interface TurnOrderState {
  nextIndex: number;
  queue: string[];
}

export interface ZoneState {
  id: string;
  center: Vector;
  radius: number;
  ownerTeam: TeamId;
  remainingTurns: number;
  maxTurns: number;
  dotDamage: number;
  dotDuration: number;
  color: string;
}

export interface StatusEffect {
  unitId: string;
  remainingTurns: number;
  damagePerTurn: number;
}

export interface GameState {
  units: UnitState[];
  graves: GraveMarker[];
  activeTeam: TeamId;
  round: number;
  phase: GamePhase;
  winner: TeamId | 'draw' | null;
  orders: Record<TeamId, TurnOrderState>;
  zones: ZoneState[];
  statuses: StatusEffect[];
  activeProjectiles: SimulationFrameProjectile[];
  activeZones: SimulationFrameZone[];
  mapId: string;
  mode: GameMode;
}

export interface SimulationFrameUnit {
  id: string;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
}

export interface SimulationFrameProjectile {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}

export interface SimulationFrameZone {
  id: string;
  x: number;
  y: number;
  radius: number;
  strength: number;
  color: string;
}

export interface SimulationFrame {
  units: SimulationFrameUnit[];
  projectiles: SimulationFrameProjectile[];
  zones: SimulationFrameZone[];
}

export interface SimulationResult {
  frames: SimulationFrame[];
  finalUnits: UnitState[];
  deaths: string[];
  zonesToAdd: ZoneState[];
  inflictedStatuses: StatusEffect[];
}

export interface DragAction {
  unitId: string;
  power: number;
  vector: Vector;
}
