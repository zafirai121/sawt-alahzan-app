// Counts as both platforms write them (src/counts.js; the website's src/utils/plural.ts). npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countOf, formatNumber, listensCount, RECITERS, tracksCount } from '../src/counts.js';
import { countWord } from '../src/uploads.js';

test('thousands apart, in Western digits', () => {
  assert.equal(formatNumber(13550), '13,550');
  assert.equal(formatNumber(498), '498');
  assert.equal(formatNumber(1000000), '1,000,000');
  assert.equal(formatNumber(undefined), '0');
});

test('the noun follows the number as Arabic counts it', () => {
  assert.equal(tracksCount(0), '0 مقطع');
  assert.equal(tracksCount(1), 'مقطع واحد');
  assert.equal(tracksCount(2), 'مقطعان');
  assert.equal(tracksCount(3), '3 مقاطع');
  assert.equal(tracksCount(10), '10 مقاطع');
  assert.equal(tracksCount(11), '11 مقطعاً');
  assert.equal(tracksCount(99), '99 مقطعاً');
  assert.equal(tracksCount(100), '100 مقطع');
  assert.equal(tracksCount(103), '103 مقاطع');
  assert.equal(tracksCount(2707), '2,707 مقاطع');
  assert.equal(tracksCount(13500), '13,500 مقطع');
  assert.equal(tracksCount(13550), '13,550 مقطعاً');
  assert.equal(countOf(7, RECITERS), '7 رواديد');
});

test('after a verbal noun the dual is the object form', () => {
  assert.equal(countWord(2), 'مقطعين');
  assert.equal(countWord(1), 'مقطع واحد');
  assert.equal(countWord(1500), '1,500 مقطع');
});

test('listens: shortened above a thousand, as on the website', () => {
  assert.equal(listensCount(377), '377 استماعاً');
  assert.equal(listensCount(0), '0 استماع');
  // The number and «ألف» are kept together (a no-break space), as on the website
  assert.equal(listensCount(12000), '12 ألف استماع');
});
