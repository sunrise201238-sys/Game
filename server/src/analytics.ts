import type { PlayerRole, UnitState } from 'aslingshot/shared';
import type { MatchSummary } from 'aslingshot/shared';

interface MapCounters {
  [key: string]: number;
}

interface UnitCounters {
  [unitType: string]: number;
}

export interface AnalyticsSnapshot {
  matchesStarted: number;
  matchesCompleted: number;
  totalRounds: number;
  firstMoverWins: number;
  mapSelections: MapCounters;
  unitSelections: UnitCounters;
  unitWins: UnitCounters;
  outOfBoundsDeaths: number;
}

export class AnalyticsStore {
  private readonly enabled: boolean;
  private readonly state: AnalyticsSnapshot;

  constructor(enabled: boolean) {
    this.enabled = enabled;
    this.state = {
      matchesStarted: 0,
      matchesCompleted: 0,
      totalRounds: 0,
      firstMoverWins: 0,
      mapSelections: {},
      unitSelections: {},
      unitWins: {},
      outOfBoundsDeaths: 0,
    };
  }

  recordMatchStart(mapId: string, teams: Record<PlayerRole, UnitState[]>): void {
    if (!this.enabled) return;
    this.state.matchesStarted += 1;
    this.bumpMapCounter(this.state.mapSelections, mapId);
    for (const role of Object.keys(teams) as PlayerRole[]) {
      for (const unit of teams[role]) {
        this.bumpMapCounter(this.state.unitSelections, unit.type);
      }
    }
  }

  recordRound(): void {
    if (!this.enabled) return;
    this.state.totalRounds += 1;
  }

  recordMatchEnd(summary: MatchSummary | undefined, firstMover: PlayerRole, teams: Record<PlayerRole, UnitState[]>): void {
    if (!this.enabled || !summary) return;
    this.state.matchesCompleted += 1;
    if (summary.winner === firstMover) {
      this.state.firstMoverWins += 1;
    }
    if (summary.winner === 'draw') {
      return;
    }
    const winningTeam = teams[summary.winner];
    for (const unit of winningTeam) {
      this.bumpMapCounter(this.state.unitWins, unit.type);
    }
  }

  recordOutOfBounds(count: number): void {
    if (!this.enabled || count <= 0) return;
    this.state.outOfBoundsDeaths += count;
  }

  get snapshot(): AnalyticsSnapshot {
    return {
      matchesStarted: this.state.matchesStarted,
      matchesCompleted: this.state.matchesCompleted,
      totalRounds: this.state.totalRounds,
      firstMoverWins: this.state.firstMoverWins,
      mapSelections: { ...this.state.mapSelections },
      unitSelections: { ...this.state.unitSelections },
      unitWins: { ...this.state.unitWins },
      outOfBoundsDeaths: this.state.outOfBoundsDeaths,
    };
  }

  private bumpMapCounter(target: MapCounters | UnitCounters, key: string) {
    target[key] = (target[key] ?? 0) + 1;
  }
}

export const createAnalyticsStore = (mode: 'off' | 'minimal'): AnalyticsStore => {
  return new AnalyticsStore(mode === 'minimal');
};
