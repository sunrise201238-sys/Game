import { ANALYTICS_KEYS, type AnalyticsKey } from '@slingshot/shared';

type AnalyticsCounters = Record<AnalyticsKey, number>;

export class AnalyticsStore {
  private readonly enabled: boolean;
  private readonly counters: AnalyticsCounters;

  constructor(enabled: boolean) {
    this.enabled = enabled;
    this.counters = ANALYTICS_KEYS.reduce<AnalyticsCounters>((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {} as AnalyticsCounters);
  }

  increment(key: AnalyticsKey, delta = 1): void {
    if (!this.enabled) return;
    this.counters[key] += delta;
  }

  get snapshot(): AnalyticsCounters {
    return { ...this.counters };
  }
}

export const createAnalyticsStore = (mode: 'off' | 'minimal'): AnalyticsStore => {
  return new AnalyticsStore(mode === 'minimal');
};
