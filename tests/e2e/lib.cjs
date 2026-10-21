// The browser tests' helpers. Playwright is not one of the app's dependencies:
// it is used from the machine (npm i -g playwright, or NODE_PATH to it)
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.error('Playwright is needed for these tests: npm i -g playwright (and npx playwright install chromium), or NODE_PATH pointing to it');
  process.exit(2);
}
const { createMock, USERS } = require('./mock.cjs');
const APP = 'http://localhost:4173/sawt-alahzan-app/';

async function launch() {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
}

// A fresh browser profile with the mock in front of every outside host
async function newPage(browser, opts = {}) {
  const mock = createMock(opts);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block', locale: 'ar' });
  await ctx.route((url) => !url.href.startsWith('http://localhost:4173/'), mock.handle);
  if (opts.skipAuthPrompt !== false) await ctx.addInitScript(() => { try { if (!localStorage.getItem('sawt_auth_skipped')) localStorage.setItem('sawt_auth_skipped', 'true'); } catch { /* about:blank */ } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(`console: ${m.text()}`); });
  return { ctx, page, mock };
}

const until = async (fn, ms = 8000, step = 50) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, step)); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pageReqs = (mock) => mock.log.filter((e) => e.path === '/rest/v1/audio_library' && /order=id/.test(e.query || ''));

async function boot(page, mock, hash = '') {
  await page.goto(APP + hash);
  await until(() => page.evaluate(() => document.querySelectorAll('#sections-container > *').length > 1));
}

// Coming back from Google: a full page load of the app with the session in the hash
async function googleReturn(page, mock, who) {
  await page.goto('about:blank');
  await boot(page, mock, googleHash(who, mock));
}
function googleHash(who, mock) {
  const s = mock.sessionFor(USERS[who]);
  return `#access_token=${s.access_token}&expires_at=${s.expires_at}&expires_in=3600&provider_token=g-token&refresh_token=${s.refresh_token}&token_type=bearer`;
}

// What the account screen shows (drawn again first)
async function profileStats(page) {
  return page.evaluate(() => {
    window.goProfile();
    const t = (id) => document.getElementById(id)?.textContent.trim();
    return { name: t('profile-display-name'), email: t('profile-email'), likes: t('stat-likes'), playlists: t('stat-playlists'), listened: t('stat-listened'), logoutShown: getComputedStyle(document.getElementById('profile-logout')).display !== 'none' };
  });
}
async function libraryText(page) {
  return page.evaluate(async () => { window.goLibrary(); await new Promise((r) => setTimeout(r, 150)); return document.getElementById('library-view').innerText; });
}
async function miniPlayer(page) {
  return page.evaluate(() => {
    const mp = document.getElementById('mini-player');
    return { shown: getComputedStyle(mp).display !== 'none', title: document.getElementById('mp-title').textContent.trim() };
  });
}
const lsKeys = (page) => page.evaluate(() => Object.keys(localStorage).sort());
const ls = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), k);

async function loginPassword(page, who) {
  await page.evaluate(() => window.openAuthModal());
  await page.fill('#auth-email', USERS[who].email);
  await page.fill('#auth-password', USERS[who].password);
  await page.click('#auth-submit-btn');
}
async function logout(page) {
  await page.evaluate(() => window.goProfile());
  await page.click('#profile-logout');
}
async function search(page, q) {
  await page.evaluate(() => window.goSearch());
  const input = page.locator('.sp-input').first();
  if (!(await input.isVisible().catch(() => false))) await page.evaluate(() => window.openSearchPage(''));
  await page.locator('.sp-input').first().fill(q);
  await sleep(400);
  return page.evaluate(() => [...document.querySelectorAll('.sp-input')].map((i) => i.closest('.view, .page, section, div[id]')?.innerText || '').join('\n'));
}

module.exports = { googleReturn, launch, newPage, until, sleep, boot, googleHash, profileStats, libraryText, miniPlayer, lsKeys, ls, loginPassword, logout, search, pageReqs, APP, USERS };
