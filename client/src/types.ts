export type TeamId = 0 | 1;

export interface Vector {
  x: number;
  y: number;
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
  width: number;
  height: number;
  lakes: Rect[];
  walls: Rect[];
}

export type GamePhase = 'aim' | 'bot-planning' | 'animating' | 'ended';

export interface TurnOrderState {
  nextIndex: number;
  queue: string[];
}

export interface GameState {
  units: UnitState[];
  graves: GraveMarker[];
  activeTeam: TeamId;
  round: number;
  phase: GamePhase;
  winner: TeamId | 'draw' | null;
  orders: Record<TeamId, TurnOrderState>;
}

export interface SimulationFrameUnit {
  id: string;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
}

export interface SimulationFrame {
  units: SimulationFrameUnit[];
}

export interface SimulationResult {
  frames: SimulationFrame[];
  finalUnits: UnitState[];
  deaths: string[];
}

export interface DragAction {
  unitId: string;
  power: number;
  vector: Vector;
}
