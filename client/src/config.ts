import type { MapDefinition, UnitDefinition } from './types';

export const UNIT_DEFINITIONS: UnitDefinition[] = [
  {
    id: 'soldier',
    name: 'Soldier',
    color: '#f94144',
    radius: 16,
    maxHp: 120,
    collideDamage: 28,
    knockback: 320,
    recoil: 110,
    resistance: 0.7,
    maxPower: 420,
  },
  {
    id: 'archer',
    name: 'Archer',
    color: '#277da1',
    radius: 15,
    maxHp: 80,
    collideDamage: 18,
    knockback: 260,
    recoil: 90,
    resistance: 0.55,
    maxPower: 340,
    projectile: {
      speed: 720,
      radius: 6,
      maxDistance: 620,
      damage: 32,
      knockback: 140,
      color: '#7ec8e3',
    },
  },
  {
    id: 'mage',
    name: 'Mage',
    color: '#f8961e',
    radius: 15,
    maxHp: 70,
    collideDamage: 20,
    knockback: 220,
    recoil: 100,
    resistance: 0.5,
    maxPower: 320,
    aoe: {
      radius: 90,
      duration: 4,
      dotDamage: 6,
      dotDuration: 3,
      placementRange: 260,
      travelScale: 1.15,
      color: 'rgba(255,140,0,0.4)',
    },
  },
];

const UNIT_LOOKUP = new Map(UNIT_DEFINITIONS.map((def) => [def.id, def]));

export const TEAM_LOADOUT: string[] = ['soldier', 'soldier', 'archer', 'archer', 'mage'];

export const MAPS: MapDefinition[] = [
  {
    id: 'balanced-basin',
    name: 'Balanced Basin',
    description: 'Symmetrical arena with central lake and offset walls.',
    width: 960,
    height: 540,
    lakes: [
      { x: 430, y: 210, width: 100, height: 120 },
    ],
    walls: [
      { x: 300, y: 120, width: 40, height: 120 },
      { x: 620, y: 300, width: 40, height: 140 },
    ],
    playerSpawns: [
      { x: 150, y: 130 },
      { x: 150, y: 220 },
      { x: 150, y: 320 },
      { x: 230, y: 180 },
      { x: 230, y: 360 },
    ],
    botSpawns: [
      { x: 810, y: 130 },
      { x: 810, y: 220 },
      { x: 810, y: 320 },
      { x: 730, y: 180 },
      { x: 730, y: 360 },
    ],
  },
  {
    id: 'river-pass',
    name: 'River Pass',
    description: 'A narrow river slices the arena with staggered cover.',
    width: 960,
    height: 540,
    lakes: [
      { x: 440, y: 0, width: 80, height: 540 },
    ],
    walls: [
      { x: 280, y: 80, width: 40, height: 120 },
      { x: 640, y: 340, width: 40, height: 120 },
      { x: 360, y: 320, width: 50, height: 80 },
      { x: 560, y: 140, width: 50, height: 80 },
    ],
    playerSpawns: [
      { x: 140, y: 110 },
      { x: 140, y: 230 },
      { x: 140, y: 350 },
      { x: 210, y: 180 },
      { x: 210, y: 410 },
    ],
    botSpawns: [
      { x: 820, y: 110 },
      { x: 820, y: 230 },
      { x: 820, y: 350 },
      { x: 750, y: 180 },
      { x: 750, y: 410 },
    ],
  },
  {
    id: 'cinder-ledge',
    name: 'Cinder Ledge',
    description: 'Twin lava pits guard the center with tight approach lanes.',
    width: 960,
    height: 540,
    lakes: [
      { x: 360, y: 160, width: 80, height: 90 },
      { x: 520, y: 300, width: 80, height: 90 },
    ],
    walls: [
      { x: 280, y: 260, width: 30, height: 140 },
      { x: 650, y: 120, width: 30, height: 140 },
      { x: 460, y: 220, width: 40, height: 100 },
    ],
    playerSpawns: [
      { x: 160, y: 150 },
      { x: 160, y: 260 },
      { x: 160, y: 360 },
      { x: 230, y: 200 },
      { x: 230, y: 400 },
    ],
    botSpawns: [
      { x: 800, y: 150 },
      { x: 800, y: 260 },
      { x: 800, y: 360 },
      { x: 730, y: 200 },
      { x: 730, y: 400 },
    ],
  },
];

export const DEFAULT_MAP_ID = MAPS[0].id;

export function getUnitDefinition(id: string): UnitDefinition {
  const found = UNIT_LOOKUP.get(id);
  if (!found) {
    throw new Error(`Unknown unit definition: ${id}`);
  }
  return found;
}

export function getMapById(id: string): MapDefinition {
  return MAPS.find((map) => map.id === id) ?? MAPS[0];
}

export const GAME_CONSTANTS = {
  timeStep: 1 / 60,
  maxSimulationSeconds: 3.6,
  friction: 0.94,
  minVelocity: 10,
  dragPowerScale: 1.75,
  wallBounce: 0.55,
};

export const HP_BAR_HEIGHT = 6;
