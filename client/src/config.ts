import type { MapDefinition, UnitDefinition } from './types';

export const UNIT_DEFINITIONS: UnitDefinition[] = [
  {
    id: 'soldier',
    name: 'Soldier',
    color: '#2563eb',
    radius: 12,
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
    radius: 11,
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
    radius: 11,
    maxHp: 70,
    collideDamage: 20,
    knockback: 220,
    recoil: 100,
    resistance: 0.5,
    maxPower: 320,
    aoe: {
      radius: 110,
      duration: 3,
      dotDamage: 5,
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
  {
    id: 'vip',
    name: 'VIP',
    color: '#facc15',
    radius: 14,
    maxHp: 1,
    collideDamage: 0,
    knockback: 0,
    recoil: 0,
    resistance: 1,
    maxPower: 0,
    controllable: false,
    loseOnDeath: true,
  },
];

const UNIT_LOOKUP = new Map(UNIT_DEFINITIONS.map((def) => [def.id, def]));

export const TEAM_LOADOUT: string[] = ['soldier', 'soldier', 'soldier', 'mage', 'archer', 'archer'];

export const MAPS: MapDefinition[] = [
  {
    id: 'training-grounds',
    name: 'Training Grounds',
    description: 'Open field with no hazards — perfect for fundamentals.',
    width: 2048,
    height: 1152,
    lakes: [],
    walls: [],
    playerSpawns: [
      { x: 640, y: 440 },
      { x: 560, y: 600 },
      { x: 520, y: 320 },
      { x: 420, y: 440 },
      { x: 300, y: 680 },
      { x: 280, y: 240 },
    ],
    botSpawns: [
      { x: 1280, y: 440 },
      { x: 1360, y: 600 },
      { x: 1400, y: 320 },
      { x: 1500, y: 440 },
      { x: 1620, y: 680 },
      { x: 1640, y: 240 },
    ],
  },
  {
    id: 'balanced-basin',
    name: 'Balanced Basin',
    description: 'Symmetrical arena with central lake and offset walls.',
    width: 2048,
    height: 1152,
    lakes: [
      { x: 860, y: 420, width: 200, height: 240 },
    ],
    walls: [
      { x: 600, y: 240, width: 80, height: 240 },
      { x: 1240, y: 600, width: 80, height: 280 },
    ],
    playerSpawns: [
      { x: 640, y: 420 },
      { x: 540, y: 560 },
      { x: 480, y: 300 },
      { x: 400, y: 420 },
      { x: 300, y: 220 },
      { x: 260, y: 640 },
    ],
    botSpawns: [
      { x: 1280, y: 420 },
      { x: 1380, y: 560 },
      { x: 1440, y: 300 },
      { x: 1520, y: 420 },
      { x: 1620, y: 220 },
      { x: 1660, y: 640 },
    ],
  },
  {
    id: 'river-pass',
    name: 'River Pass',
    description: 'A narrow river slices the arena with staggered cover.',
    width: 2048,
    height: 1152,
    lakes: [
      { x: 900, y: 0, width: 120, height: 1080 },
    ],
    walls: [
      { x: 560, y: 160, width: 80, height: 240 },
      { x: 1280, y: 680, width: 80, height: 240 },
      { x: 720, y: 640, width: 100, height: 160 },
      { x: 1120, y: 280, width: 100, height: 160 },
    ],
    playerSpawns: [
      { x: 540, y: 420 },
      { x: 460, y: 300 },
      { x: 420, y: 540 },
      { x: 360, y: 400 },
      { x: 280, y: 660 },
      { x: 260, y: 180 },
    ],
    botSpawns: [
      { x: 1380, y: 420 },
      { x: 1460, y: 300 },
      { x: 1500, y: 540 },
      { x: 1560, y: 400 },
      { x: 1640, y: 660 },
      { x: 1660, y: 180 },
    ],
  },
  {
    id: 'cinder-ledge',
    name: 'Cinder Ledge',
    description: 'Twin lava pits guard the center with tight approach lanes.',
    width: 2048,
    height: 1152,
    lakes: [
      { x: 720, y: 320, width: 160, height: 180 },
      { x: 1040, y: 600, width: 160, height: 180 },
    ],
    walls: [
      { x: 560, y: 520, width: 60, height: 280 },
      { x: 1300, y: 240, width: 60, height: 280 },
      { x: 920, y: 440, width: 80, height: 200 },
    ],
    playerSpawns: [
      { x: 660, y: 460 },
      { x: 540, y: 600 },
      { x: 500, y: 320 },
      { x: 420, y: 460 },
      { x: 300, y: 680 },
      { x: 300, y: 240 },
    ],
    botSpawns: [
      { x: 1260, y: 460 },
      { x: 1380, y: 600 },
      { x: 1420, y: 320 },
      { x: 1500, y: 460 },
      { x: 1620, y: 240 },
      { x: 1620, y: 680 },
    ],
  },
  {
    id: 'lone-bridge',
    name: 'Lone Island',
    description: 'One resilient isle links mirrored reservoirs—control the solitary land bridge.',
    width: 2048,
    height: 1152,
    lakes: [
      { x: 0, y: 0, width: 2048, height: 336 },
      { x: 0, y: 816, width: 2048, height: 336 },
      { x: 0, y: 336, width: 480, height: 480 },
      { x: 1568, y: 336, width: 480, height: 480 },
    ],
    walls: [],
    playerSpawns: [
      { x: 640, y: 576 },
      { x: 700, y: 516 },
      { x: 700, y: 636 },
      { x: 760, y: 576 },
      { x: 820, y: 516 },
      { x: 820, y: 636 },
    ],
    botSpawns: [
      { x: 1408, y: 576 },
      { x: 1348, y: 516 },
      { x: 1348, y: 636 },
      { x: 1288, y: 576 },
      { x: 1228, y: 516 },
      { x: 1228, y: 636 },
    ],
  },
  {
    id: 'bridge',
    name: 'Bridge',
    description: 'Face off across a straight causeway suspended between mirrored lakes.',
    width: 1024,
    height: 576,
    // Lakes only occupy the middle third; left & right columns are LAND.
    lakes: [
      { x: 256, y: 0, width: 512, height: 192 },
      { x: 256, y: 384, width: 512, height: 192 },
    ],
    walls: [],
    // Team 0 (left/home). Spread across lanes by role:
    // Soldiers (front, closest to center), Mages (mid), Archers (back).
    playerSpawns: [
      // Soldiers – front line facing right
      { x: 192, y: 240 },
      { x: 192, y: 288 },
      { x: 192, y: 336 },
      // Mages – middle line
      { x: 144, y: 240 },
      { x: 144, y: 288 },
      { x: 144, y: 336 },
      // Archers – back line
      { x: 96, y: 240 },
      { x: 96, y: 288 },
      { x: 96, y: 336 },
    ],
    // Team 1 (right/home). Mirrored layout:
    botSpawns: [
      // Soldiers – front line facing left
      { x: 832, y: 240 },
      { x: 832, y: 288 },
      { x: 832, y: 336 },
      // Mages – middle line
      { x: 880, y: 240 },
      { x: 880, y: 288 },
      { x: 880, y: 336 },
      // Archers – back line
      { x: 928, y: 240 },
      { x: 928, y: 288 },
      { x: 928, y: 336 },
    ],
  },
  {
    id: 'vip-stronghold',
    name: 'VIP Stronghold',
    description: 'Protect the immovable VIP stationed at each base—any hit spells defeat.',
    width: 2048,
    height: 1152,
    lakes: [
      { x: 896, y: 256, width: 256, height: 160 },
      { x: 896, y: 736, width: 256, height: 160 },
    ],
    walls: [
      { x: 640, y: 320, width: 60, height: 512 },
      { x: 1348, y: 320, width: 60, height: 512 },
      { x: 928, y: 448, width: 192, height: 72 },
      { x: 928, y: 632, width: 192, height: 72 },
    ],
    playerSpawns: [
      { x: 520, y: 576 },
      { x: 480, y: 500 },
      { x: 480, y: 652 },
      { x: 440, y: 420 },
      { x: 440, y: 732 },
      { x: 380, y: 576 },
    ],
    botSpawns: [
      { x: 1528, y: 576 },
      { x: 1568, y: 500 },
      { x: 1568, y: 652 },
      { x: 1608, y: 420 },
      { x: 1608, y: 732 },
      { x: 1668, y: 576 },
    ],
    vipUnits: [
      { team: 0, position: { x: 320, y: 576 } },
      { team: 1, position: { x: 1728, y: 576 } },
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
      { x: 1650, y: 456 },
      { x: 1650, y: 576 },
      { x: 1650, y: 696 },
      { x: 1750, y: 416 },
      { x: 1750, y: 536 },
      { x: 1750, y: 656 },
      { x: 1850, y: 476 },
      { x: 1850, y: 596 },
      { x: 1850, y: 716 },
      { x: 1950, y: 456 },
      { x: 1950, y: 576 },
      { x: 1950, y: 696 },
      { x: 2010, y: 396 },
      { x: 2010, y: 476 },
      { x: 2010, y: 556 },
      { x: 2010, y: 636 },
      { x: 2010, y: 716 },
      { x: 2010, y: 796 },
    ],
    teamLoadouts: {
      0: ['perfect-soldier'],
      1: [
        'soldier',
        'soldier',
        'soldier',
        'soldier',
        'soldier',
        'soldier',
        'soldier',
        'soldier',
        'soldier',
        'mage',
        'mage',
        'mage',
        'archer',
        'archer',
        'archer',
        'archer',
        'archer',
        'archer',
      ],
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
