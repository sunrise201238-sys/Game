import type { MapDefinition, UnitDefinition } from './types';

export const UNIT_DEFINITIONS: UnitDefinition[] = [
  {
    id: 'soldier',
    name: 'Soldier',
    color: '#2563eb',
    radius: 16,
    maxHp: 120,
    collideDamage: 28,
    knockback: 320,
    recoil: 110,
    resistance: 0.7,
    maxPower: 520,
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
    aimCurveExponent: 4.5,
    aimCurveSmoothing: 0.03,
    projectile: {
      speed: 720,
      radius: 6,
      maxDistance: 620,
      damage: 32,
      knockback: 140,
      color: '#7ec8e3',
      previewScale: 1.2,
      previewExtension: 240,
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
      radius: 110,
      duration: 3,
      dotDamage: 4,
      dotDuration: 3,
      placementRange: 280,
      travelScale: 1.15,
      color: 'rgba(255,140,0,0.35)',
      teamColors: {
        0: 'rgba(249,115,22,0.6)',
        1: 'rgba(196,181,253,0.6)',
      },
    },
  },
  {
    id: 'perfect-soldier',
    name: 'Perfect Soldier',
    color: '#c084fc',
    radius: 16,
    maxHp: 2000,
    collideDamage: 20,
    knockback: 500,
    recoil: 110,
    resistance: 0.2,
    maxPower: 1000,
    projectile: {
      speed: 780,
      radius: 8,
      maxDistance: 750,
      damage: 30,
      knockback: 180,
      color: 'rgba(221,214,254,0.95)',
      previewScale: 1.2,
      previewExtension: 240,
    },
    aoe: {
      radius: 120,
      duration: 3,
      dotDamage: 4,
      dotDuration: 3,
      placementRange: 280,
      travelScale: 1.15,
      color: 'rgba(255,182,203,0.45)',
      teamColors: {
        0: 'rgba(233,213,255,0.6)',
        1: 'rgba(244,114,182,0.6)',
      },
    },
  },
];

const UNIT_LOOKUP = new Map(UNIT_DEFINITIONS.map((def) => [def.id, def]));

export const TEAM_LOADOUT: string[] = ['soldier', 'soldier', 'soldier', 'archer', 'archer', 'mage'];

export const MAPS: MapDefinition[] = [
  {
    id: 'training-grounds',
    name: 'Training Grounds',
    description: 'Open field with no hazards — perfect for fundamentals.',
    width: 1024,
    height: 576,
    lakes: [],
    walls: [],
    playerSpawns: [
      { x: 140, y: 120 },
      { x: 210, y: 220 },
      { x: 150, y: 340 },
      { x: 260, y: 160 },
      { x: 280, y: 300 },
      { x: 320, y: 220 },
    ],
    botSpawns: [
      { x: 820, y: 120 },
      { x: 750, y: 220 },
      { x: 810, y: 340 },
      { x: 700, y: 160 },
      { x: 680, y: 300 },
      { x: 640, y: 220 },
    ],
  },
  {
    id: 'balanced-basin',
    name: 'Balanced Basin',
    description: 'Symmetrical arena with central lake and offset walls.',
    width: 1024,
    height: 576,
    lakes: [
      { x: 430, y: 210, width: 100, height: 120 },
    ],
    walls: [
      { x: 300, y: 120, width: 40, height: 120 },
      { x: 620, y: 300, width: 40, height: 140 },
    ],
    playerSpawns: [
      { x: 150, y: 110 },
      { x: 200, y: 210 },
      { x: 130, y: 320 },
      { x: 240, y: 150 },
      { x: 270, y: 280 },
      { x: 320, y: 210 },
    ],
    botSpawns: [
      { x: 810, y: 110 },
      { x: 760, y: 210 },
      { x: 830, y: 320 },
      { x: 720, y: 150 },
      { x: 690, y: 280 },
      { x: 640, y: 210 },
    ],
  },
  {
    id: 'river-pass',
    name: 'River Pass',
    description: 'A narrow river slices the arena with staggered cover.',
    width: 1024,
    height: 576,
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
      { x: 130, y: 90 },
      { x: 180, y: 200 },
      { x: 140, y: 330 },
      { x: 230, y: 150 },
      { x: 210, y: 270 },
      { x: 270, y: 210 },
    ],
    botSpawns: [
      { x: 830, y: 90 },
      { x: 780, y: 200 },
      { x: 820, y: 330 },
      { x: 730, y: 150 },
      { x: 750, y: 270 },
      { x: 690, y: 210 },
    ],
  },
  {
    id: 'cinder-ledge',
    name: 'Cinder Ledge',
    description: 'Twin lava pits guard the center with tight approach lanes.',
    width: 1024,
    height: 576,
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
      { x: 150, y: 120 },
      { x: 210, y: 200 },
      { x: 150, y: 340 },
      { x: 250, y: 160 },
      { x: 270, y: 300 },
      { x: 330, y: 230 },
    ],
    botSpawns: [
      { x: 810, y: 120 },
      { x: 750, y: 200 },
      { x: 810, y: 340 },
      { x: 710, y: 160 },
      { x: 690, y: 300 },
      { x: 630, y: 230 },
    ],
  },
  {
    id: 'twin-bridge',
    name: 'Twin Bridge',
    description: 'A single stone bridge cuts between twin basins — fights bottleneck at the center span.',
    width: 1024,
    height: 576,
    lakes: [
      { x: 220, y: 40, width: 520, height: 160 },
      { x: 220, y: 340, width: 520, height: 160 },
    ],
    walls: [],
    playerSpawns: [
      { x: 140, y: 120 },
      { x: 190, y: 210 },
      { x: 150, y: 360 },
      { x: 240, y: 170 },
      { x: 260, y: 310 },
      { x: 210, y: 420 },
    ],
    botSpawns: [
      { x: 820, y: 120 },
      { x: 770, y: 210 },
      { x: 810, y: 360 },
      { x: 720, y: 170 },
      { x: 700, y: 310 },
      { x: 750, y: 420 },
    ],
  },
  {
    id: 'perfect-soldier',
    name: 'Perfect Soldier',
    description: 'A vast, empty proving ground built for the Perfect Soldier.',
    width: 2048,
    height: 1152,
    lakes: [],
    walls: [],
    playerSpawns: [
      { x: 240, y: 576 },
      { x: 320, y: 456 },
      { x: 320, y: 696 },
      { x: 420, y: 536 },
      { x: 420, y: 616 },
      { x: 520, y: 576 },
    ],
    botSpawns: [
      { x: 1808, y: 336 },
      { x: 1890, y: 456 },
      { x: 1710, y: 576 },
      { x: 1890, y: 696 },
      { x: 1808, y: 816 },
      { x: 1980, y: 576 },
    ],
    teamLoadouts: {
      0: ['perfect-soldier'],
      1: TEAM_LOADOUT,
    },
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
