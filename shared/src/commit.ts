import type { UnitAction } from './messages.js';

export function serializeCommitPayload(action: UnitAction, nonce: string, salt: string): string {
  return JSON.stringify({ action, nonce, salt });
}
