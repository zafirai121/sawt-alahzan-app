// The web app is never shown inside another site's frame (a page dressed over
// it to trick a click): GitHub Pages can't send X-Frame-Options, so the page
// itself stays hidden unless it is the whole window. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const head = page.slice(0, page.indexOf('</head>'));

test('hiddenUntilItIsTheWholeWindow', () => {
  assert.match(head, /<style id="frame-guard">html\{display:none !important\}<\/style>/);
  assert.match(head, /if \(self === top\) document\.getElementById\('frame-guard'\)\.remove\(\);/);
});

test('theGuardComesBeforeAnythingIsDrawn', () => {
  const guard = page.indexOf('id="frame-guard"');
  assert.ok(guard > 0 && guard < page.indexOf('<link rel="manifest"'));
  assert.ok(guard < page.indexOf('<body'));
});
