export interface MapPolygonPoint {
  x: number;
  y: number;
}

export interface MapObstacle {
  polygon: MapPolygonPoint[];
  bounciness: number;
}

export interface LakeSpec {
  polygon: MapPolygonPoint[];
}

export interface SpawnTemplate {
  id: string;
  slotsYou: MapPolygonPoint[];
  slotsOpp: MapPolygonPoint[];
}

export interface RuleFlags {
  maxRounds?: number;
  tieBreak?: "hp" | "survivors";
}

export interface MapSchema {
  id: string;
  nameKey: string;
  bounds: { w: number; h: number };
  lakes: LakeSpec[];
  walls: MapObstacle[];
  spawnTemplates: SpawnTemplate[];
  ruleFlags: RuleFlags;
}

export interface UnitSchema {
  id: string;
  nameKey: string;
  hp: number;
  collideDmg: number;
  knockback: number;
  selfRecoil: number;
  moveFriction: number;
  projectile?: ProjectileSpec;
  aoe?: AoeSpec;
}

export interface ProjectileSpec {
  dmg: number;
  baseRange: number;
  rangeGainPerForce: number;
  passFriend: boolean;
  stopOn: {
    enemy: boolean;
    wall: boolean;
    out: boolean;
  };
  pushbackSmall: boolean;
}

export interface AoeSpec {
  shape: "circle" | "rect";
  size: number;
  ttlRounds: number;
  dot: {
    dmg: number;
    durationRounds: number;
    stack: boolean;
    refresh: boolean;
  };
  maxPlaceDist: number;
  scalesWithForce: boolean;
}
