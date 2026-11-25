// The technical numbering left out where titles are shown (decision D3/W11;
// src/uploads.js cleanTitle and shownTitle, the website's src/utils/titles.ts). npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, shownTitle } from '../src/uploads.js';

test('the numbering a title carries from a list or a file goes', () => {
  assert.equal(shownTitle('1243. 1243. كلهم الراحو حسين'), 'كلهم الراحو حسين');
  assert.equal(shownTitle('784. ناديتك يا حسين'), 'ناديتك يا حسين');
  assert.equal(shownTitle('008 - نار الهجر'), 'نار الهجر');
  assert.equal(shownTitle('03 - يا حسين'), 'يا حسين');
});

test('a number that is part of the name stays', () => {
  assert.equal(shownTitle('313 يا مهدي'), '313 يا مهدي');
  assert.equal(shownTitle('313 - يا مهدي'), '313 - يا مهدي');
  assert.equal(shownTitle('عاشوراء 1446'), 'عاشوراء 1446');
});

test('nothing but a number: the title stays as it was', () => {
  assert.equal(shownTitle('1243. 1243.'), '1243. 1243.');
  assert.equal(cleanTitle('يا حسين'), 'يا حسين');
});
