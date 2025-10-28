import { createHash, timingSafeEqual } from 'node:crypto';

export function hashAction(payload: unknown, secretSalt: string): string {
  const serialized = JSON.stringify(payload);
  return createHash('sha256')
    .update(serialized + secretSalt)
    .digest('hex');
}

export function compareHashes(a: string, b: string, tolerance = 0): boolean {
  if (tolerance === 0) {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
  return a === b;
}
