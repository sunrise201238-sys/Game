import type { MapDefinition, UnitDefinition, Vector } from './types';

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
    maxPower: 340,
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
    maxPower: 280,
    projectile: {
      speed: 680,
      radius: 6,
      maxDistance: 520,
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
    maxPower: 270,
    aoe: {
      radius: 80,
      duration: 4,
      dotDamage: 18,
      dotDuration: 3,
      placementRange: 240,
      travelScale: 1.1,
      color: 'rgba(255,140,0,0.45)',
    },
  },
];

export const MAP_DEFINITION: MapDefinition = {
  width: 960,
  height: 540,
  lakes: [
    { x: 440, y: 200, width: 80, height: 140 },
  ],
  walls: [
    { x: 320, y: 120, width: 40, height: 100 },
    { x: 600, y: 320, width: 40, height: 110 },
  ],
};

export const PLAYER_SPAWNS: Vector[] = [
  { x: 160, y: 160 },
  { x: 120, y: 280 },
  { x: 170, y: 400 },
];

export const BOT_SPAWNS: Vector[] = [
  { x: MAP_DEFINITION.width - 160, y: 160 },
  { x: MAP_DEFINITION.width - 120, y: 280 },
  { x: MAP_DEFINITION.width - 170, y: 400 },
];

export const GAME_CONSTANTS = {
  timeStep: 1 / 60,
  maxSimulationSeconds: 3.6,
  friction: 0.94,
  minVelocity: 10,
  dragPowerScale: 1.55,
  wallBounce: 0.55,
};

export const HP_BAR_HEIGHT = 6;
