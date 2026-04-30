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
      teamColors: {
        0: '#7ec8e3',
        1: '#fb923c',
      },
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
    maxHp: 150,
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
  [0.68, 0.78],
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
  horizWall(RIFT_X_LEFT + 144, RIFT_Y_BOTTOM - 18, RIFT_X_RIGHT - RIFT_X_LEFT - 364, 36),
  // left
  vertWall(RIFT_X_LEFT - 18, RIFT_Y_TOP + 160 + 108, 36, (RIFT_Y_BOTTOM - RIFT_Y_TOP - 320) - 108),
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


const MAPS_UNSORTED: MapDefinition[] = [
  {
    id: 'mobile-lift',
    name: 'Mobile Lift',
    description: 'Portrait-friendly lanes with a soft central lift and wide flanks for clean shots.',
    width: 540,
    height: 900,
    lakes: [
      { x: 190, y: 328, width: 160, height: 244 },
    ],
    walls: [
      { x: 118, y: 408, width: 48, height: 84 },
      { x: 374, y: 408, width: 48, height: 84 },
    ],
    playerSpawns: [
      { x: 164, y: 702 },
      { x: 270, y: 748 },
      { x: 376, y: 702 },
      { x: 164, y: 806 },
      { x: 270, y: 846 },
      { x: 376, y: 806 },
    ],
    botSpawns: [
      { x: 164, y: 198 },
      { x: 270, y: 152 },
      { x: 376, y: 198 },
      { x: 164, y: 94 },
      { x: 270, y: 54 },
      { x: 376, y: 94 },
    ],
  },
  {
    id: 'mobile-garden',
    name: 'Mobile Garden',
    description: 'Tall battlefield with rounded hazard pockets and gentle side cover tuned for phone screens.',
    width: 560,
    height: 920,
    lakes: [
      { x: 90, y: 328, width: 132, height: 132 },
      { x: 338, y: 460, width: 132, height: 132 },
    ],
    walls: [
      { x: 252, y: 232, width: 56, height: 94 },
      { x: 252, y: 594, width: 56, height: 94 },
    ],
    playerSpawns: [
      { x: 168, y: 714 },
      { x: 280, y: 758 },
      { x: 392, y: 714 },
      { x: 168, y: 828 },
      { x: 280, y: 866 },
      { x: 392, y: 828 },
    ],
    botSpawns: [
      { x: 168, y: 206 },
      { x: 280, y: 162 },
      { x: 392, y: 206 },
      { x: 168, y: 92 },
      { x: 280, y: 54 },
      { x: 392, y: 92 },
    ],
  },
  {
    id: 'mobile-switchback',
    name: 'Mobile Switchback',
    description: 'Vertical zig-zag lanes create readable movement paths without visual clutter.',
    width: 560,
    height: 960,
    lakes: [
      { x: 132, y: 248, width: 296, height: 116 },
      { x: 132, y: 596, width: 296, height: 116 },
    ],
    walls: [
      { x: 84, y: 430, width: 120, height: 34 },
      { x: 356, y: 496, width: 120, height: 34 },
    ],
    playerSpawns: [
      { x: 160, y: 748 },
      { x: 280, y: 790 },
      { x: 400, y: 748 },
      { x: 160, y: 868 },
      { x: 280, y: 906 },
      { x: 400, y: 868 },
    ],
    botSpawns: [
      { x: 160, y: 212 },
      { x: 280, y: 170 },
      { x: 400, y: 212 },
      { x: 160, y: 92 },
      { x: 280, y: 54 },
      { x: 400, y: 92 },
    ],
  },
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
    name: 'Micro Basin',
    description: 'Symmetrical micro arena with a central basin and mirrored cover lanes.',
    width: 800,
    height: 450,
    lakes: [
      { x: 354, y: 164, width: 92, height: 122 },
    ],
    walls: [
      { x: 236, y: 96, width: 32, height: 96 },
      { x: 532, y: 258, width: 32, height: 96 },
    ],
    playerSpawns: [
      { x: 186, y: 186 },
      { x: 186, y: 264 },
      { x: 126, y: 225 },
    ],
    botSpawns: [
      { x: 614, y: 186 },
      { x: 614, y: 264 },
      { x: 674, y: 225 },
    ],
    teamLoadouts: {
      0: ['soldier', 'soldier', 'archer'],
      1: ['soldier', 'soldier', 'archer'],
    },
  },
  {
    id: 'river-pass',
    name: 'Micro Pass',
    description: 'A narrow river splits this micro map with short staggered cover on each side.',
    width: 800,
    height: 450,
    lakes: [
      { x: 376, y: 0, width: 48, height: 422 },
    ],
    walls: [
      { x: 220, y: 66, width: 32, height: 92 },
      { x: 548, y: 292, width: 32, height: 92 },
      { x: 286, y: 262, width: 38, height: 62 },
      { x: 476, y: 128, width: 38, height: 62 },
    ],
    playerSpawns: [
      { x: 184, y: 186 },
      { x: 184, y: 264 },
      { x: 122, y: 225 },
    ],
    botSpawns: [
      { x: 616, y: 186 },
      { x: 616, y: 264 },
      { x: 678, y: 225 },
    ],
    teamLoadouts: {
      0: ['soldier', 'soldier', 'archer'],
      1: ['soldier', 'soldier', 'archer'],
    },
  },
  {
    id: 'cinder-ledge',
    name: 'Micro Cinder',
    description: 'Twin cinder pools pressure the center while side walls form tight micro duels.',
    width: 800,
    height: 450,
    lakes: [
      { x: 280, y: 126, width: 66, height: 72 },
      { x: 454, y: 252, width: 66, height: 72 },
    ],
    walls: [
      { x: 220, y: 204, width: 24, height: 108 },
      { x: 556, y: 94, width: 24, height: 108 },
      { x: 360, y: 174, width: 30, height: 76 },
    ],
    playerSpawns: [
      { x: 182, y: 186 },
      { x: 182, y: 264 },
      { x: 120, y: 225 },
    ],
    botSpawns: [
      { x: 618, y: 186 },
      { x: 618, y: 264 },
      { x: 680, y: 225 },
    ],
    teamLoadouts: {
      0: ['soldier', 'soldier', 'archer'],
      1: ['soldier', 'soldier', 'archer'],
    },
  },
  {
    id: 'lone-bridge',
    name: 'Micro Island',
    description: 'A lone center island forces close fights with little room to retreat.',
    width: 800,
    height: 450,
    lakes: [
      { x: 0, y: 0, width: 800, height: 132 },
      { x: 0, y: 318, width: 800, height: 132 },
      { x: 0, y: 132, width: 188, height: 186 },
      { x: 612, y: 132, width: 188, height: 186 },
    ],
    walls: [],
    playerSpawns: [
      { x: 292, y: 225 },
      { x: 248, y: 186 },
      { x: 248, y: 264 },
    ],
    botSpawns: [
      { x: 508, y: 225 },
      { x: 552, y: 186 },
      { x: 552, y: 264 },
    ],
    teamLoadouts: {
      0: ['soldier', 'soldier', 'archer'],
      1: ['soldier', 'soldier', 'archer'],
    },
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
    id: 'pocket-duel',
    name: 'Compact Duel',
    description: 'Compact open arena sized for phones—units stay readable on small screens.',
    width: 960,
    height: 540,
    lakes: [],
    walls: [],
    playerSpawns: [
      { x: 212, y: 206 },
      { x: 212, y: 270 },
      { x: 212, y: 334 },
      { x: 136, y: 222 },
      { x: 136, y: 270 },
      { x: 136, y: 318 },
    ],
    botSpawns: [
      { x: 748, y: 206 },
      { x: 748, y: 270 },
      { x: 748, y: 334 },
      { x: 824, y: 222 },
      { x: 824, y: 270 },
      { x: 824, y: 318 },
    ],
  },
  {
    id: 'mini-corridors',
    name: 'Compact Corridors',
    description: 'A small map with two short lane walls to break direct line shots.',
    width: 960,
    height: 540,
    lakes: [],
    walls: [
      { x: 394, y: 98, width: 44, height: 146 },
      { x: 522, y: 296, width: 44, height: 146 },
    ],
    playerSpawns: [
      { x: 204, y: 206 },
      { x: 204, y: 270 },
      { x: 204, y: 334 },
      { x: 126, y: 222 },
      { x: 126, y: 270 },
      { x: 126, y: 318 },
    ],
    botSpawns: [
      { x: 756, y: 206 },
      { x: 756, y: 270 },
      { x: 756, y: 334 },
      { x: 834, y: 222 },
      { x: 834, y: 270 },
      { x: 834, y: 318 },
    ],
  },
  {
    id: 'tiny-crossing',
    name: 'Compact Crossing',
    description: 'Small-screen skirmish with a narrow central lake and flanking routes.',
    width: 960,
    height: 540,
    lakes: [
      { x: 450, y: 166, width: 60, height: 208 },
    ],
    walls: [
      { x: 332, y: 254, width: 56, height: 40 },
      { x: 572, y: 254, width: 56, height: 40 },
    ],
    playerSpawns: [
      { x: 212, y: 214 },
      { x: 212, y: 270 },
      { x: 212, y: 326 },
      { x: 140, y: 230 },
      { x: 140, y: 270 },
      { x: 140, y: 310 },
    ],
    botSpawns: [
      { x: 748, y: 214 },
      { x: 748, y: 270 },
      { x: 748, y: 326 },
      { x: 820, y: 230 },
      { x: 820, y: 270 },
      { x: 820, y: 310 },
    ],
  },
  {
    id: 'micro-duel',
    name: 'Micro Duel',
    description: 'Ultra-compact open map for very small screens and quick 3v3 rounds.',
    width: 800,
    height: 450,
    lakes: [],
    walls: [],
    playerSpawns: [
      { x: 176, y: 192 },
      { x: 176, y: 258 },
      { x: 116, y: 225 },
    ],
    botSpawns: [
      { x: 624, y: 192 },
      { x: 624, y: 258 },
      { x: 684, y: 225 },
    ],
    teamLoadouts: {
      0: ['soldier', 'soldier', 'archer'],
      1: ['soldier', 'soldier', 'archer'],
    },
  },
  {
    id: 'micro-pillars',
    name: 'Micro Pillars',
    description: 'Small arena with two center pillars creating short peek angles for 3v3 teams.',
    width: 800,
    height: 450,
    lakes: [],
    walls: [
      { x: 360, y: 116, width: 28, height: 92 },
      { x: 412, y: 242, width: 28, height: 92 },
    ],
    playerSpawns: [
      { x: 172, y: 188 },
      { x: 172, y: 262 },
      { x: 112, y: 225 },
    ],
    botSpawns: [
      { x: 628, y: 188 },
      { x: 628, y: 262 },
      { x: 688, y: 225 },
    ],
    teamLoadouts: {
      0: ['soldier', 'soldier', 'archer'],
      1: ['soldier', 'soldier', 'archer'],
    },
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
    name: 'Micro Stronghold',
    description: 'Protect each anchored VIP in a compact fortress where every lane matters.',
    width: 800,
    height: 450,
    lakes: [
      { x: 350, y: 100, width: 100, height: 62 },
      { x: 350, y: 288, width: 100, height: 62 },
    ],
    walls: [
      { x: 250, y: 126, width: 24, height: 200 },
      { x: 526, y: 126, width: 24, height: 200 },
      { x: 364, y: 176, width: 72, height: 28 },
      { x: 364, y: 246, width: 72, height: 28 },
    ],
    playerSpawns: [
      { x: 202, y: 225 },
      { x: 162, y: 184 },
      { x: 162, y: 266 },
    ],
    botSpawns: [
      { x: 598, y: 225 },
      { x: 638, y: 184 },
      { x: 638, y: 266 },
    ],
    vipUnits: [
      { team: 0, position: { x: 126, y: 225 } },
      { team: 1, position: { x: 674, y: 225 } },
    ],
    teamLoadouts: {
      0: ['soldier', 'soldier', 'archer'],
      1: ['soldier', 'soldier', 'archer'],
    },
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

const MAP_ORDER_PRIORITY: Record<string, number> = {
  'mobile-lift': -140,
  'mobile-garden': -130,
  'mobile-switchback': -120,
  'micro-duel': -100,
  'perfect-soldier': 100,
};

export const MAPS: MapDefinition[] = [...MAPS_UNSORTED].sort((a, b) => {
  const areaDelta = a.width * a.height - b.width * b.height;
  if (areaDelta !== 0) {
    return areaDelta;
  }
  const priorityDelta = (MAP_ORDER_PRIORITY[a.id] ?? 0) - (MAP_ORDER_PRIORITY[b.id] ?? 0);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return a.name.localeCompare(b.name);
});

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
