// A track whose connection drops before its end is asked for again (src/audio_recovery.js). npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ATTEMPTS, reconnectDelay, shouldRetry, STALL_MS } from '../src/audio_recovery.js';

test('tried again after a growing wait, a few times at most', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(reconnectDelay), [1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  assert.equal(reconnectDelay(-1), 1000);
  assert.ok(MAX_ATTEMPTS >= 3 && MAX_ATTEMPTS <= 8);
  const total = Array.from({ length: MAX_ATTEMPTS }, (_, i) => reconnectDelay(i)).reduce((a, b) => a + b, 0);
  assert.ok(total <= 60_000, String(total));
  assert.ok(STALL_MS >= 10_000 && STALL_MS <= 30_000);
});

test('which errors are worth asking for the same file again', () => {
  // The network failed: always
  assert.equal(shouldRetry(2, true), true);
  assert.equal(shouldRetry(2, false), true);
  // Data cut short while playing: tried again
  assert.equal(shouldRetry(3, true), true);
  assert.equal(shouldRetry(4, true), true);
  assert.equal(shouldRetry(undefined, true), true);
  // A file that never played (missing, not audio): skipped as before
  assert.equal(shouldRetry(3, false), false);
  assert.equal(shouldRetry(4, false), false);
  // Aborted by the app itself (another track chosen): never
  assert.equal(shouldRetry(1, true), false);
});
