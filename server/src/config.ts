import 'dotenv/config';

export interface ServerConfig {
  port: number;
  planningMs: number;
  allowOrigins: string[];
  analyticsMode: 'off' | 'minimal';
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function loadConfig(): ServerConfig {
  return {
    port: parseNumber(process.env.PORT, 3001),
    planningMs: parseNumber(process.env.PLANNING_MS, 7000),
    allowOrigins: parseOrigins(process.env.ALLOW_ORIGINS),
    analyticsMode: (process.env.ANALYTICS as 'off' | 'minimal') ?? 'off',
  };
}
