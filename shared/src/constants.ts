export const PHYSICS_CONSTANTS = {
  timestepMs: 1000 / 120,
  dragImpulseCap: 15,
  baseFriction: 0.98,
  gravity: 0,
  bounceDamping: 0.6,
  friendlyPushScale: 0.4,
  enemyKnockbackScale: 1.8,
  impulseVelocityScale: 1.8,
  outOfBoundsZ: -10,
  hazardGraceFrames: 3
} as const;

export const ROUND_CONFIG = {
  maxRoundsDefault: 30
} as const;

export const ANALYTICS_KEYS = [
  "matchesStarted",
  "matchesCompleted",
  "totalRounds",
  "firstMoverWins",
  "unitSelections",
  "unitWins",
  "outOfBoundsDeaths",
  "mapSelections"
] as const;

export const GAME_MODES = {
  deterministic: "modeB" as const
};

export type AnalyticsKey = (typeof ANALYTICS_KEYS)[number];
