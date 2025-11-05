import type { MapDefinition, Rect, UnitDefinition, Vector } from './types';

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
      dotDamage: 11,
      dotDuration: 3,
      placementRange: 280,
      travelScale: 1.15,
      color: 'rgba(255,140,0,0.35)',
      teamColors: {
        0: 'rgba(196,181,253,0.6)',
        1: 'rgba(249,115,22,0.6)',
      },
    },
  },
  {
    id: 'perfect-soldier',
    name: 'Perfect Soldier',
    color: '#c084fc',
    radius: 16,
    maxHp: 300,
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
      dotDamage: 11,
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
  {
    id: 'base',
    name: 'Base',
    color: '#facc15',
    radius: 18,
    maxHp: 50,
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

// --- The Rift ---------------------------------------------------------------
// Rectangles are top-left anchored. Units spawn centered at their points.

type XY = Vector;

const RIFT_WIDTH = 1152;
const RIFT_HEIGHT = 1152;

// Inner lake “box” (blue area before carving the X corridors)
const RIFT_X_LEFT = 180; // left margin (matches corridor width for uniform passages)
const RIFT_X_RIGHT = RIFT_WIDTH - RIFT_X_LEFT; // right margin
const RIFT_Y_TOP = 180; // top margin (matches corridor width for uniform passages)
const RIFT_Y_BOTTOM = RIFT_HEIGHT - RIFT_Y_TOP; // bottom margin

// X corridor geometry (two bands connecting opposite corners)
const RIFT_CORRIDOR_WIDTH = 180; // visual width of each diagonal ground lane

// Utility: scanline carve (returns rectangles for “lakes” after removing the two corridors)
function buildRiftLakes(step = 16): Rect[] {
  const lakes: Rect[] = [];

  // TL->BR line: a1 x + b1 y + c1 = 0
  const dx = RIFT_X_RIGHT - RIFT_X_LEFT;
  const dy = RIFT_Y_BOTTOM - RIFT_Y_TOP;
  const a1 = dy;
  const b1 = -dx;
  const c1 = -(a1 * RIFT_X_LEFT + b1 * RIFT_Y_TOP);

  // TR->BL line: a2 x + b2 y + c2 = 0
  const a2 = dy;
  const b2 = +dx;
  const c2 = -(a2 * RIFT_X_RIGHT + b2 * RIFT_Y_TOP);

  const denom = Math.hypot(a1, b1);
  const D = (RIFT_CORRIDOR_WIDTH / 2) * denom;

  for (let y = RIFT_Y_TOP; y < RIFT_Y_BOTTOM; y += step) {
    // Corridor interval on this y for each band
    const k1 = b1 * y + c1;
    const k2 = b2 * y + c2;
    let L1a = (-D - k1) / a1;
    let L1b = (D - k1) / a1;
    if (L1a > L1b) [L1a, L1b] = [L1b, L1a];
    let L2a = (-D - k2) / a2;
    let L2b = (D - k2) / a2;
    if (L2a > L2b) [L2a, L2b] = [L2b, L2a];

    // Clip to inner box
    L1a = Math.max(L1a, RIFT_X_LEFT);
    L1b = Math.min(L1b, RIFT_X_RIGHT);
    L2a = Math.max(L2a, RIFT_X_LEFT);
    L2b = Math.min(L2b, RIFT_X_RIGHT);

    // Sort + union the two corridor intervals
    const segs = [
      [L1a, L1b],
      [L2a, L2b],
    ]
      .filter(([a, b]) => a < b)
      .sort((A, B) => A[0] - B[0]);
    const union: Array<[number, number]> = [];
    for (const s of segs) {
      if (!union.length || s[0] > union[union.length - 1][1]) {
        union.push([s[0], s[1]]);
      } else {
        union[union.length - 1][1] = Math.max(union[union.length - 1][1], s[1]);
      }
    }

    // Complement inside [xL, xR] are the lake spans on this scanline
    let start = RIFT_X_LEFT;
    for (const [u0, u1] of union) {
      if (start < u0) {
        lakes.push({ x: Math.round(start), y, width: Math.round(u0 - start), height: step });
      }
      start = Math.max(start, u1);
    }
    if (start < RIFT_X_RIGHT) {
      lakes.push({ x: Math.round(start), y, width: Math.round(RIFT_X_RIGHT - start), height: step });
    }
  }

  return lakes;
}

// --- Walls: partial coverage strips on triangle edges (tips left open) -----

// helper: line offset band (returns small stepped squares so walls follow diagonals)
function diagonalWallStrip(
  p1: XY,
  p2: XY,
  side: 1 | -1,
  t0: number,
  t1: number,
  offsetFromCenter: number,
  tile = 32,
  thick = 32,
): Rect[] {
  const out: Rect[] = [];
  const vx = p2.x - p1.x;
  const vy = p2.y - p1.y;
  const L = Math.hypot(vx, vy);
  const ux = vx / L;
  const uy = vy / L;
  const nx = -uy * side;
  const ny = ux * side; // normal (choose side toward the lake)

  const start = t0 * L;
  const end = t1 * L;
  const steps = Math.max(1, Math.ceil((end - start) / tile));
  for (let i = 0; i <= steps; i++) {
    const d = start + (i * (end - start)) / steps;
    const cx = p1.x + ux * d + nx * offsetFromCenter;
    const cy = p1.y + uy * d + ny * offsetFromCenter;
    out.push({ x: Math.round(cx - thick / 2), y: Math.round(cy - thick / 2), width: thick, height: thick });
  }
  return out;
}

// convenience for horizontal/vertical short edge walls
function horizWall(x: number, y: number, width: number, height: number): Rect {
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
function vertWall(x: number, y: number, width: number, height: number): Rect {
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

// Corner points of the inner box for corridor centerlines
const RIFT_TL: XY = { x: RIFT_X_LEFT, y: RIFT_Y_TOP };
const RIFT_TR: XY = { x: RIFT_X_RIGHT, y: RIFT_Y_TOP };
const RIFT_BL: XY = { x: RIFT_X_LEFT, y: RIFT_Y_BOTTOM };
const RIFT_BR: XY = { x: RIFT_X_RIGHT, y: RIFT_Y_BOTTOM };

// Where we place wall strips along each corridor edge
const RIFT_WALL_TILE = 32;
const RIFT_WALL_THICK = 34;
const RIFT_EDGE_OFFSET = RIFT_CORRIDOR_WIDTH / 2 + RIFT_WALL_THICK * 0.4; // sit just inside the blue
// Two short strips on each side of each diagonal (8 diagonal wall clusters total)
const RIFT_WALL_RANGES: Array<[number, number]> = [
  [0.18, 0.32],
  [0.68, 0.81],
];

const riftDiagonalWalls: Rect[] = [
  // TL -> BR, both sides
  ...diagonalWallStrip(RIFT_TL, RIFT_BR, +1, RIFT_WALL_RANGES[0][0], RIFT_WALL_RANGES[0][1], RIFT_EDGE_OFFSET, RIFT_WALL_TILE, RIFT_WALL_THICK),
  ...diagonalWallStrip(RIFT_TL, RIFT_BR, -1, RIFT_WALL_RANGES[0][0], RIFT_WALL_RANGES[0][1], RIFT_EDGE_OFFSET, RIFT_WALL_TILE, RIFT_WALL_THICK),
  ...diagonalWallStrip(RIFT_TL, RIFT_BR, +1, RIFT_WALL_RANGES[1][0], RIFT_WALL_RANGES[1][1], RIFT_EDGE_OFFSET, RIFT_WALL_TILE, RIFT_WALL_THICK),
  ...diagonalWallStrip(RIFT_TL, RIFT_BR, -1, RIFT_WALL_RANGES[1][0], RIFT_WALL_RANGES[1][1], RIFT_EDGE_OFFSET, RIFT_WALL_TILE, RIFT_WALL_THICK),

  // TR -> BL, both sides
  ...diagonalWallStrip(RIFT_TR, RIFT_BL, +1, RIFT_WALL_RANGES[0][0], RIFT_WALL_RANGES[0][1], RIFT_EDGE_OFFSET, RIFT_WALL_TILE, RIFT_WALL_THICK),
  ...diagonalWallStrip(RIFT_TR, RIFT_BL, -1, RIFT_WALL_RANGES[0][0], RIFT_WALL_RANGES[0][1], RIFT_EDGE_OFFSET, RIFT_WALL_TILE, RIFT_WALL_THICK),
  ...diagonalWallStrip(RIFT_TR, RIFT_BL, +1, RIFT_WALL_RANGES[1][0], RIFT_WALL_RANGES[1][1], RIFT_EDGE_OFFSET, RIFT_WALL_TILE, RIFT_WALL_THICK),
  ...diagonalWallStrip(RIFT_TR, RIFT_BL, -1, RIFT_WALL_RANGES[1][0], RIFT_WALL_RANGES[1][1], RIFT_EDGE_OFFSET, RIFT_WALL_TILE, RIFT_WALL_THICK),
];

// Short top/bottom and left/right edge walls (not a full border)
const riftEdgeWalls: Rect[] = [
  // top
  horizWall(RIFT_X_LEFT + 140 + 108, RIFT_Y_TOP - 18, (RIFT_X_RIGHT - RIFT_X_LEFT - 280) - 108, 36),
  // bottom
  horizWall(RIFT_X_LEFT + 140 + 108, RIFT_Y_BOTTOM - 18, (RIFT_X_RIGHT - RIFT_X_LEFT - 280) - 108, 36),
  // left
  vertWall(RIFT_X_LEFT - 18, RIFT_Y_TOP + 250, 36, (RIFT_Y_BOTTOM - RIFT_Y_TOP - 320) - 108),
  // right
  vertWall(RIFT_X_RIGHT - 18, RIFT_Y_TOP + 160, 36, (RIFT_Y_BOTTOM - RIFT_Y_TOP - 320) -108),
];

// --- Bases and defenders (6 per team), mirrored & tucked in corners --------
const RIFT_BASE_BL: XY = { x: 112, y: RIFT_HEIGHT - 96 };
const RIFT_BASE_TR: XY = { x: RIFT_WIDTH - 112, y: 96 };

// Defender cluster offset from the base, inspired by the reference layout (bottom-left version)
const RIFT_DEFENDER_OFFSETS: XY[] = [
  { x: 200, y: 32 },
  { x: -25, y: -325 },
  { x: 65, y:  -140 },
  { x: 115, y:  -140 },
  { x: 175, y:  0 },
  { x: -75, y:  -250 },
];

const riftPlayerSpawns = RIFT_DEFENDER_OFFSETS.map((offset) => ({
  x: RIFT_BASE_BL.x + offset.x,
  y: RIFT_BASE_BL.y + offset.y,
}));
const riftBotSpawns = riftPlayerSpawns.map((p) => ({ x: RIFT_WIDTH - p.x, y: RIFT_HEIGHT - p.y })); // perfect rotational symmetry


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
    description: 'A small island where rival forces clash with nowhere to run.',
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
    description: 'Face off across a straight causeway where one clean hit sends foes over the edge.',
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
    id: 'the-rift',
    name: 'The Rift',
    description:
      'Four basins split by an X-shaped pass. Partial cover lines the banks; fortified bases sit in opposite corners guarded by six defenders.',
    width: RIFT_WIDTH,
    height: RIFT_HEIGHT,
    // Lakes = inner rectangle minus the two diagonal corridors (built via scanlines)
    lakes: buildRiftLakes(),
    // Walls = short edge strips + diagonal partial strips; triangle tips remain uncovered
    walls: [...riftEdgeWalls, ...riftDiagonalWalls],
    // Six minions per team, mirrored (clustered to protect the bases)
    playerSpawns: riftPlayerSpawns,
    botSpawns: riftBotSpawns,
    // Bases pinned to corners
    vipUnits: [
      { team: 0, position: RIFT_BASE_BL, unitId: 'base' },
      { team: 1, position: RIFT_BASE_TR, unitId: 'base' },
    ],
  },
  {
    id: 'the-rift-fog',
    name: 'The Rift (Fog)',
    description:
      'The Rift cloaked in dense fog—defend your corner base and hunt the enemy through the misty cross-pass.',
    width: RIFT_WIDTH,
    height: RIFT_HEIGHT,
    lakes: buildRiftLakes(),
    walls: [...riftEdgeWalls, ...riftDiagonalWalls],
    playerSpawns: riftPlayerSpawns,
    botSpawns: riftBotSpawns,
    // Bases pinned to corners
    vipUnits: [
      { team: 0, position: RIFT_BASE_BL, unitId: 'base' },
      { team: 1, position: RIFT_BASE_TR, unitId: 'base' },
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
