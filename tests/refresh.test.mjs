// The library read again while the app stays open (as in the Android app's
// LibraryRefreshTest): when it is read again, and what is shown after. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStale, merged, retryDelay } from '../src/refresh.js';

const MINUTE = 60_000;
const t = (id, title = `مقطع ${id}`) => ({ id: String(id), title });

test('readAgainAfterHalfAnHour', () => {
  const loaded = 1_000_000;
  assert.equal(isStale(loaded, loaded + 29 * MINUTE), false);
  assert.equal(isStale(loaded, loaded + 30 * MINUTE), true);
  // Never read whole yet: the next return reads it
  assert.equal(isStale(0, loaded), true);
});

test('aWholeReadingReplacesTheOldOne', () => {
  const old = [t(3), t(2, 'قديم'), t(1)];
  const shown = merged(old, [t(4), t(2, 'جديد'), t(3)], true);
  assert.deepEqual(shown.map((x) => x.id), ['4', '3', '2']);
  assert.equal(shown.find((x) => x.id === '2').title, 'جديد');
});

test('aPartReadingKeepsWhatDidNotCome', () => {
  const old = [t(3), t(2, 'قديم'), t(1)];
  const shown = merged(old, [t(4), t(2, 'جديد')], false);
  assert.deepEqual(shown.map((x) => x.id), ['4', '3', '2', '1']);
  assert.equal(shown.find((x) => x.id === '2').title, 'جديد');
});

test('pagesThatFailAreAskedAgainSoon', () => {
  assert.deepEqual([1, 2, 3, 4].map(retryDelay), [10_000, 30_000, 60_000, null]);
});
