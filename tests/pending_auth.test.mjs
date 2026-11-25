// The attempt a guest made before signing in, carried on afterwards (src/pending_auth.js). npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanAction, clearAction, PENDING_KEY, PENDING_TTL, rememberAction, takeAction } from '../src/pending_auth.js';

const memory = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};

test('only the kinds the app resumes are kept', () => {
  assert.deepEqual(cleanAction({ kind: 'upload' }), { kind: 'upload' });
  assert.deepEqual(cleanAction({ kind: 'myUploads', extra: 1 }), { kind: 'myUploads' });
  assert.deepEqual(cleanAction({ kind: 'edit', id: 27523 }), { kind: 'edit', id: '27523' });
  for (const bad of [null, 'upload', {}, { kind: 'delete' }, { kind: 'edit' }, { kind: 'edit', id: '1;drop' }, { kind: 'edit', id: '../x' }]) {
    assert.equal(cleanAction(bad), null, JSON.stringify(bad));
  }
});

test('kept, then taken once after signing in', () => {
  const s = memory();
  assert.equal(rememberAction(s, { kind: 'edit', id: '12' }, 1000), true);
  assert.deepEqual(takeAction(s, 2000), { kind: 'edit', id: '12' });
  assert.equal(takeAction(s, 2000), null);
  assert.equal(s.map.has(PENDING_KEY), false);
});

test('a later attempt replaces the earlier one', () => {
  const s = memory();
  rememberAction(s, { kind: 'upload' }, 1000);
  rememberAction(s, { kind: 'myUploads' }, 1500);
  assert.deepEqual(takeAction(s, 2000), { kind: 'myUploads' });
});

test('given up (the window closed): nothing is resumed', () => {
  const s = memory();
  rememberAction(s, { kind: 'upload' }, 1000);
  clearAction(s);
  assert.equal(takeAction(s, 2000), null);
});

test('an old, a future or a broken record is dropped, not resumed', () => {
  const s = memory();
  rememberAction(s, { kind: 'upload' }, 0);
  assert.equal(takeAction(s, PENDING_TTL + 1), null);
  assert.equal(s.map.has(PENDING_KEY), false);
  s.setItem(PENDING_KEY, JSON.stringify({ kind: 'upload', at: 10 * 60_000 }));
  assert.equal(takeAction(s, 0), null);
  s.setItem(PENDING_KEY, '{not json');
  assert.equal(takeAction(s, 0), null);
  s.setItem(PENDING_KEY, JSON.stringify({ kind: 'admin', at: 0 }));
  assert.equal(takeAction(s, 0), null);
});

test('a storage that throws (private mode) never breaks signing in', () => {
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.equal(rememberAction(broken, { kind: 'upload' }), false);
  assert.equal(takeAction(broken), null);
  assert.doesNotThrow(() => clearAction(broken));
});
