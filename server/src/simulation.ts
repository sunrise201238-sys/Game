import { randomUUID } from 'node:crypto';

import { PHYSICS_CONSTANTS } from '@slingshot/shared';
import type { PlayerRole, RoundDiff, UnitAction, UnitState } from '@slingshot/shared';

import type { MatchContext, SimulationEngine, SimulationResult } from './types.js';

const ZERO_DIFF: RoundDiff = {
  hpChanges: [],
  deaths: [],
  graves: [],
  positions: [],
  projectiles: [],
  aoeUpserts: [],
  aoeExpires: [],
};

const PLAYER_ORDER: PlayerRole[] = ['you', 'opponent'];

export class DeterministicSimulation implements SimulationEngine {
  simulate(match: MatchContext, actions: Record<PlayerRole, UnitAction | null>): SimulationResult {
    const diff: RoundDiff = JSON.parse(JSON.stringify(ZERO_DIFF));
    const nextCursors = { ...match.cursors };

    PLAYER_ORDER.forEach((role) => {
      const action = actions[role];
      if (!action) return;
      const player = match.players[role];
      const unit = player.units.find((u) => u.id === action.unitId && u.alive);
      if (!unit) return;

      const clamped = clampVector(action.dragVec);
      applyMovement(unit, clamped);
      diff.positions.push({ unitId: unit.id, position: { ...unit.position } });
    });

    const randomSeed = randomUUID();

    return {
      diff,
      nextCursors,
      randomSeed,
    };
  }
}

function clampVector(vec: { x: number; y: number }) {
  const magnitude = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
  if (magnitude <= PHYSICS_CONSTANTS.dragImpulseCap) {
    return vec;
  }
  const scale = PHYSICS_CONSTANTS.dragImpulseCap / magnitude;
  return { x: vec.x * scale, y: vec.y * scale };
}

function applyMovement(unit: UnitState, impulse: { x: number; y: number }) {
  unit.position.x += impulse.x;
  unit.position.y += impulse.y;
}

export const createSimulationEngine = (): SimulationEngine => new DeterministicSimulation();
