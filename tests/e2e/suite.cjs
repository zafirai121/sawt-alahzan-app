// The app in a real browser against a stand-in Supabase and site (mock.cjs):
// signing in and out, switching accounts, the library loading on a bad
// connection, the player. Each test starts with a fresh browser profile.
//   npm run build && npm run test:e2e [T02,T06...]
const { spawn } = require('node:child_process');
const L = require('./lib.cjs');
const results = [];
const only = process.argv[2] ? process.argv[2].split(',') : null;

async function test(id, title, fn) {
  if (only && !only.some((o) => id.startsWith(o))) return;
  const browser = await L.launch();
  const checks = [];
  const expect = (ok, what, detail) => { checks.push({ ok: !!ok, what, detail }); };
  let status = 'passed', error = null;
  try { await fn({ browser, expect }); } catch (e) { status = 'error'; error = e.stack || String(e); }
  if (status !== 'error' && checks.some((c) => !c.ok)) status = 'failed';
  await browser.close();
  results.push({ id, title, status, checks, error });
  console.log(`\n[${status.toUpperCase()}] ${id} ${title}`);
  checks.forEach((c) => console.log(`   ${c.ok ? '✓' : '✗'} ${c.what}${c.detail !== undefined ? `  → ${typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)}` : ''}`));
  if (error) console.log('   ERROR', error.split('\n').slice(0, 4).join('\n   '));
}
const realErrors = (page) => page.errors.filter((e) => !/ERR_FAILED|ERR_ABORTED|ERR_NAME_NOT_RESOLVED/.test(e));
const favGets = (mock, who) => mock.log.filter((e) => e.path === '/rest/v1/favorites' && e.method === 'GET' && e.user === L.USERS[who].email);

async function playFirstLiked(page) {
  await page.evaluate(() => window.openLikesPage());
  await L.until(() => page.locator('#page-view .track-item').count());
  await page.locator('#page-view .track-item .track-info').first().click();
  await L.until(async () => (await L.miniPlayer(page)).shown);
}

// The built app (dist), served as GitHub Pages serves it
async function startServer() {
  if (await fetch(L.APP).then((r) => r.ok, () => false)) return null;
  const root = `${__dirname}/../..`;
  const server = spawn(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'preview', '--port', '4173', '--strictPort'], { cwd: root, stdio: 'ignore' });
  await L.until(() => fetch(L.APP).then((r) => r.ok, () => false), 15000, 200);
  return server;
}

(async () => {
  const server = await startServer();
  await test('T01', 'Guest: the app loads and the whole library (3 pages) is searchable', async ({ browser, expect }) => {
    const { page, mock } = await L.newPage(browser);
    await L.boot(page, mock);
    await L.until(() => L.pageReqs(mock).length >= 3);
    await L.sleep(500);
    expect(L.pageReqs(mock).length === 3, 'three track pages requested', L.pageReqs(mock).length);
    const r = await L.search(page, 'قصيدة الصفحة الأخيرة');
    expect(r.includes('رادود 8'), 'a track from the last page is found');
    const st = await L.profileStats(page);
    expect(st.name === 'ضيف' && !st.logoutShown, 'guest profile shown', st);
    expect(realErrors(page).length === 0, 'no page errors', realErrors(page));
  });

  await test('T02', 'Google sign-in A → sign out → Google sign-in B: nothing of A shows for B', async ({ browser, expect }) => {
    const { page, mock } = await L.newPage(browser);
    await L.boot(page, mock);
    // Back from Google as A (the implicit-flow redirect)
    await L.googleReturn(page, mock, 'A');
    await L.until(() => favGets(mock, 'A').length);
    await L.sleep(600);
    let st = await L.profileStats(page);
    expect(st.name === 'اسم أ' && st.email === 'a@test.local', 'A signed in, A\'s name', st);
    expect(st.likes === '2' && st.playlists === '1', 'A\'s cloud likes and playlist loaded', st);
    let lib = await L.libraryText(page);
    expect(lib.includes('قائمة أ الخاصة'), 'A\'s playlist in the library');
    // A listens to a track and likes another from the mini player
    await playFirstLiked(page);
    const mpA = await L.miniPlayer(page);
    await L.sleep(500);
    await page.click('#mp-like-btn');
    await L.sleep(500);
    const likePost = mock.log.find((e) => e.path === '/rest/v1/favorites' && (e.method === 'POST' || e.method === 'DELETE'));
    expect(likePost && likePost.user === 'a@test.local', 'like change sent under A\'s token', likePost && { method: likePost.method, user: likePost.user, body: likePost.body });
    const keysA = (await L.lsKeys(page)).filter((k) => k.endsWith(`@${L.USERS.A.id}`));
    expect(keysA.some((k) => k.startsWith('sawt_history@')) && keysA.some((k) => k.startsWith('sawt_last@')), 'A\'s listening kept under A\'s keys', keysA);

    const homeA = await page.evaluate(() => { window.goHome(); return document.getElementById('home-view').innerText; });
    expect(homeA.includes('تم الاستماع إليه مؤخراً'), 'A\'s home has its recently played section');
    // Sign out from the account screen
    await L.logout(page);
    await L.until(() => mock.log.some((e) => e.path === '/auth/v1/logout'));
    await L.sleep(600);
    const lo = mock.log.find((e) => e.path === '/auth/v1/logout');
    expect(lo && /scope=local/.test(lo.query), 'sign-out ends only this browser\'s session (scope=local)', lo && lo.query);
    const keysAfter = await L.lsKeys(page);
    expect(!keysAfter.some((k) => /^sb-.*-auth-token$/.test(k)), 'session token removed from storage');
    expect(keysAfter.filter((k) => k.endsWith(`@${L.USERS.A.id}`)).length === keysA.length, 'A\'s own data kept on the device (not deleted)', keysAfter.filter((k) => k.endsWith(`@${L.USERS.A.id}`)));
    const mpOut = await L.miniPlayer(page);
    expect(!mpOut.shown, 'A\'s track gone from the player', mpOut);
    // (close the sign-in sheet doLogout opened)
    await page.evaluate(() => window.skipAuth && window.skipAuth());
    st = await L.profileStats(page);
    expect(st.name === 'ضيف' && st.likes === '0' && st.playlists === '0' && st.listened === '0', 'guest state after sign-out', st);
    lib = await L.libraryText(page);
    expect(!lib.includes('قائمة أ الخاصة'), 'A\'s playlist gone from the library');

    // Back from Google as B
    await L.googleReturn(page, mock, 'B');
    await L.until(() => favGets(mock, 'B').length);
    await L.sleep(800);
    st = await L.profileStats(page);
    expect(st.name === 'اسم ب' && st.email === 'b@test.local', 'B signed in, B\'s name', st);
    expect(st.likes === '1' && st.playlists === '1' && st.listened === '0', 'only B\'s likes/playlists/history', st);
    lib = await L.libraryText(page);
    expect(lib.includes('قائمة ب الخاصة') && !lib.includes('قائمة أ الخاصة'), 'B\'s playlist only');
    const mpB = await L.miniPlayer(page);
    expect(!mpB.shown || mpB.title !== mpA.title, 'A\'s last track not in B\'s player', { mpA, mpB });
    const home = await page.evaluate(() => { window.goHome(); return document.getElementById('home-view').innerText; });
    expect(!home.includes('تم الاستماع إليه مؤخراً'), 'no recently played (A\'s) on B\'s home screen');
    const bWrites = mock.log.filter((e) => ['POST', 'DELETE', 'PATCH'].includes(e.method) && e.path.startsWith('/rest/v1/') && !e.path.includes('/rpc/') && e.user === 'b@test.local');
    expect(bWrites.length === 0, 'nothing of A written into B\'s account', bWrites.map((e) => ({ path: e.path, body: e.body })));
    expect(realErrors(page).length === 0, 'no page errors', realErrors(page));
  });

  await test('T03', 'Switching accounts without signing out (A open, B comes back from Google)', async ({ browser, expect }) => {
    const { page, mock } = await L.newPage(browser);
    await L.googleReturn(page, mock, 'A');
    await L.until(() => favGets(mock, 'A').length);
    await L.sleep(500);
    await playFirstLiked(page);
    const mpA = await L.miniPlayer(page);
    await L.googleReturn(page, mock, 'B');
    await L.until(() => favGets(mock, 'B').length);
    await L.sleep(800);
    const st = await L.profileStats(page);
    expect(st.name === 'اسم ب' && st.likes === '1' && st.playlists === '1' && st.listened === '0', 'B\'s own data only', st);
    const mpB = await L.miniPlayer(page);
    expect(!mpB.shown, 'A\'s track not in B\'s player', { mpA, mpB });
    const lib = await L.libraryText(page);
    expect(!lib.includes('قائمة أ الخاصة'), 'A\'s playlist not shown');
  });

  await test('T04', 'Guest likes move into the account that signs in, once, and not into the next one', async ({ browser, expect }) => {
    const { page, mock } = await L.newPage(browser);
    await L.boot(page, mock);
    await L.until(() => L.pageReqs(mock).length >= 3);
    // A guest likes a track from its page (a shared link to it)
    await page.goto(L.APP + '?track=1000');
    await L.until(() => page.locator('#td-like-btn').isVisible());
    await page.click('#td-like-btn');
    await L.sleep(300);
    const guestLikes = await L.ls(page, 'sawt_likes');
    expect(Array.isArray(guestLikes) && guestLikes.includes('1000'), 'guest like stored on the device', guestLikes);
    await L.googleReturn(page, mock, 'A');
    await L.until(() => favGets(mock, 'A').length);
    await L.sleep(600);
    const up = mock.log.find((e) => e.path === '/rest/v1/favorites' && e.method === 'POST');
    expect(up && up.user === 'a@test.local' && JSON.stringify(up.body).includes('cloud_1000'), 'guest like uploaded to A', up && up.body);
    expect(JSON.stringify(await L.ls(page, 'sawt_likes')) === '[]', 'guest copy cleared once uploaded');
    const st = await L.profileStats(page);
    expect(st.likes === '3', 'A now has 3 likes', st);
    await L.logout(page);
    await L.sleep(500);
    await L.googleReturn(page, mock, 'B');
    await L.until(() => favGets(mock, 'B').length);
    await L.sleep(600);
    const stB = await L.profileStats(page);
    expect(stB.likes === '1', 'B gets none of the guest\'s or A\'s likes', stB);
  });

  await test('T05', 'Fast switch: A\'s slow profile answer arrives after B signed in', async ({ browser, expect }) => {
    const { page, mock } = await L.newPage(browser);
    mock.hooks.any = async (e) => { if (e.path === '/rest/v1/profiles' && e.user === 'a@test.local') await L.sleep(2500); };
    await L.boot(page, mock);
    await L.loginPassword(page, 'A');
    await L.sleep(300);
    // A's profile still loading: sign out, sign in as B
    await page.evaluate(() => { window.doLogout(); });
    await L.sleep(300);
    await L.loginPassword(page, 'B');
    await L.sleep(4000);
    const st = await L.profileStats(page);
    expect(st.email === 'b@test.local', 'B is the account signed in', st);
    expect(st.name === 'اسم ب', 'B\'s name shown (not A\'s late profile)', st);
  });

  await test('T06', 'A change fails on the server after the account changed: B\'s likes untouched', async ({ browser, expect }) => {
    const { page, mock } = await L.newPage(browser);
    await L.googleReturn(page, mock, 'A');
    await L.until(() => favGets(mock, 'A').length);
    await L.sleep(500);
    await playFirstLiked(page); // one of A's likes
    const mpA = await L.miniPlayer(page);
    mock.hooks.any = async (e) => { if (e.path === '/rest/v1/favorites' && e.method !== 'GET' && e.user === 'a@test.local') { await L.sleep(2500); return { status: 500, body: { message: 'boom' } }; } };
    await page.click('#mp-like-btn'); // A un-likes it; the server will refuse, late
    await L.sleep(200);
    await page.evaluate(() => { window.doLogout(); });
    await L.sleep(300);
    await L.loginPassword(page, 'B');
    await L.sleep(4000);
    const st = await L.profileStats(page);
    expect(st.email === 'b@test.local', 'B signed in', st);
    expect(st.likes === '1', 'B shows only its own one like', st);
    await page.evaluate(() => window.openLikesPage());
    await L.sleep(400);
    const likes = await page.evaluate(() => document.getElementById('page-view').innerText);
    expect(!likes.includes(mpA.title), `A's liked track (${mpA.title}) not in B's likes`, likes.split('\n').filter((l) => l.includes('مقطع')).slice(0, 5));
  });

  await test('T07a', 'A library page answers 503 once (retried by supabase-js)', async ({ browser, expect }) => {
    const { page, mock } = await L.newPage(browser);
    let failed = 0;
    mock.hooks.any = async (e) => { if (e.path === '/rest/v1/audio_library' && /offset=1000/.test(e.query) && failed < 1) { failed++; return { status: 503, body: { message: 'unavailable' } }; } };
    await L.boot(page, mock);
    await L.sleep(3500);
    const r = await L.search(page, 'قصيدة الصفحة الثانية');
    expect(r.includes('رادود 1'), 'the failed page arrives (retried)', r.slice(0, 120));
  });

  await test('T07b', 'A library page answers 502 once (a gateway error, not retried by the library)', async ({ browser, expect }) => {
    const { page, mock } = await L.newPage(browser);
    let failed = 0;
    mock.hooks.any = async (e) => { if (e.path === '/rest/v1/audio_library' && /offset=1000/.test(e.query) && failed < 1) { failed++; return { status: 502, body: { message: 'bad gateway' } }; } };
    await L.boot(page, mock);
    await L.sleep(6000);
    const r2 = await L.search(page, 'قصيدة الصفحة الأخيرة');
    expect(r2.includes('رادود 8'), 'tracks of the page that did load are searchable', r2.slice(0, 120));
    const r = await L.search(page, 'قصيدة الصفحة الثانية');
    expect(r.includes('رادود 1'), 'the failed page is asked again and arrives', r.slice(0, 120));
  });

  await test('T07c', 'The connection drops for 12 s while the library loads, then returns', async ({ browser, expect }) => {
    const { page, mock } = await L.newPage(browser);
    let downUntil = 0;
    mock.hooks.any = async (e) => {
      if (e.path === '/rest/v1/audio_library' && /offset=0&/.test(e.query) && !downUntil) downUntil = Date.now() + 12000;
      if (e.path === '/rest/v1/audio_library' && /offset=(1|2)000/.test(e.query) && Date.now() < downUntil) return { status: 520, body: {} };
    };
    await L.boot(page, mock);
    await L.sleep(13000);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await L.sleep(5000);
    const r = await L.search(page, 'قصيدة الصفحة الأخيرة');
    expect(r.includes('رادود 8'), 'the whole library is there once the connection is back', r.slice(0, 120));
  });

  await test('T08', 'Player: next / previous, a broken file is skipped, the end moves on', async ({ browser, expect }) => {
    const { page, mock } = await L.newPage(browser, { wavSeconds: 2 });
    mock.hooks.media = async (url) => (url.pathname === '/2499.wav' ? { status: 404, body: '' } : undefined);
    await L.googleReturn(page, mock, 'A');
    await L.until(() => favGets(mock, 'A').length);
    await L.sleep(500);
    // play the likes list: 2500, 2499 (broken)
    await playFirstLiked(page);
    const first = (await L.miniPlayer(page)).title;
    await page.evaluate(() => window.playNext());
    await L.sleep(1500);
    const afterNext = (await L.miniPlayer(page)).title;
    expect(afterNext !== first, 'next track (or skipped past the broken one)', { first, afterNext });
    await page.evaluate(() => window.playPrev());
    await L.sleep(800);
    const afterPrev = (await L.miniPlayer(page)).title;
    expect(!!afterPrev, 'previous keeps a track in the player', afterPrev);
    expect(realErrors(page).filter((e) => !/404/.test(e)).length === 0, 'no page errors', realErrors(page));
  });

  await test('T09', 'Two tabs: signing out in one turns the other into a guest too', async ({ browser, expect }) => {
    const { ctx, page, mock } = await L.newPage(browser);
    await L.googleReturn(page, mock, 'A');
    await L.until(() => favGets(mock, 'A').length);
    const page2 = await ctx.newPage();
    await L.boot(page2, mock);
    await L.sleep(1200);
    let st2 = await L.profileStats(page2);
    expect(st2.email === 'a@test.local' && st2.likes === '2', 'second tab opens signed in as A', st2);
    await L.logout(page);
    await L.sleep(1500);
    st2 = await L.profileStats(page2);
    expect(st2.name === 'ضيف' && st2.likes === '0' && st2.playlists === '0', 'second tab is a guest after sign-out in the first', st2);
    const lib2 = await L.libraryText(page2);
    expect(!lib2.includes('قائمة أ الخاصة'), 'A\'s playlist gone from the second tab');
  });

  await test('T10', 'Deleting the account (asked to confirm) forgets A\'s data on this device; B\'s stays', async ({ browser, expect }) => {
    const { page, mock } = await L.newPage(browser);
    await L.googleReturn(page, mock, 'B');
    await L.until(() => favGets(mock, 'B').length);
    await playFirstLiked(page);
    await L.sleep(400);
    await L.logout(page);
    await L.sleep(500);
    await L.googleReturn(page, mock, 'A');
    await L.until(() => favGets(mock, 'A').length);
    await playFirstLiked(page);
    await L.sleep(400);
    await page.evaluate(() => window.goProfile());
    await page.click('#profile-delete-account');
    await L.until(() => page.locator('#delete-account-ok').isVisible());
    const before = mock.log.filter((e) => e.path === '/api/delete-account').length;
    expect(before === 0, 'nothing deleted before confirming');
    await page.click('#delete-account-ok');
    await L.until(() => mock.log.some((e) => e.path === '/api/delete-account'));
    await L.sleep(1200);
    const lo = mock.log.find((e) => e.path === '/auth/v1/logout');
    const keys = await L.lsKeys(page);
    expect(!keys.some((k) => k.endsWith(`@${L.USERS.A.id}`)), 'A\'s device data forgotten', keys.filter((k) => k.includes(L.USERS.A.id)));
    expect(keys.some((k) => k.endsWith(`@${L.USERS.B.id}`)), 'B\'s device data untouched', keys.filter((k) => k.includes(L.USERS.B.id)).length);
    const st = await L.profileStats(page);
    expect(st.name === 'ضيف', 'guest after deletion', st);
  });

  await test('T11', 'A kept session that can no longer be refreshed: the app opens as a guest', async ({ browser, expect }) => {
    const { ctx, page, mock } = await L.newPage(browser);
    await L.googleReturn(page, mock, 'A');
    await L.until(() => favGets(mock, 'A').length);
    await playFirstLiked(page);
    // The session expired meanwhile and its refresh token was revoked
    await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
      const s = JSON.parse(localStorage.getItem(k));
      s.expires_at = Math.floor(Date.now() / 1000) - 60;
      s.refresh_token = 'revoked';
      localStorage.setItem(k, JSON.stringify(s));
    });
    await page.goto('about:blank');
    await L.boot(page, mock);
    await L.sleep(1500);
    const st = await L.profileStats(page);
    expect(st.name === 'ضيف' && st.likes === '0' && st.playlists === '0', 'guest, nothing of A on screen', st);
    const mp = await L.miniPlayer(page);
    expect(!mp.shown, 'A\'s last track not in the player', mp);
    const keys = await L.lsKeys(page);
    expect(keys.some((k) => k.startsWith('sawt_history@')), 'A\'s data still kept on the device for next sign-in');
  });

  await test('T12', 'Reopening the app brings back the whole queue, not the last track alone', async ({ browser, expect }) => {
    const { page, mock } = await L.newPage(browser);
    await L.boot(page, mock);
    // A home section's list, from its third track
    await page.evaluate(() => [...document.querySelectorAll('#home-view .link-btn')].find((b) => b.textContent.includes('عرض الكل')).click());
    await L.until(() => page.locator('#page-view .track-item').count());
    await page.locator('#page-view .track-item .track-info').nth(2).click();
    await L.until(async () => (await L.miniPlayer(page)).shown);
    const title = (await L.miniPlayer(page)).title;
    await page.evaluate(() => window.togglePlay());
    await L.sleep(500);
    await page.goto('about:blank');
    await L.boot(page, mock);
    await L.until(async () => (await L.miniPlayer(page)).shown);
    const mp = await L.miniPlayer(page);
    expect(mp.title === title, 'the same track back in the player', { title, mp });
    const next = await page.evaluate(() => document.querySelectorAll('#fp-queue-list .track-item').length);
    expect(next > 0, 'the tracks after it are still queued', next);
    await page.evaluate(() => window.playNext());
    await L.sleep(800);
    expect((await L.miniPlayer(page)).title !== title, 'next plays the list\'s next track');
    expect(realErrors(page).length === 0, 'no page errors', realErrors(page));
  });

  await test('T13', 'The home screen\'s "قوائمك": each account sees its own playlists, a guest without any sees none', async ({ browser, expect }) => {
    const mine = (page) => page.evaluate(() => {
      window.goHome();
      const s = document.querySelector('#sections-container [data-home="mine"]');
      return s ? [...s.querySelectorAll('.square-title')].map((x) => x.textContent) : null;
    });
    const { page, mock } = await L.newPage(browser);
    await L.boot(page, mock);
    expect((await mine(page)) === null, 'a guest without playlists: no section');
    await L.googleReturn(page, mock, 'A');
    await L.until(async () => (await mine(page))?.length);
    const a = await mine(page);
    expect(JSON.stringify(a) === JSON.stringify(['قائمة أ الخاصة']), 'A: A\'s playlist only', a);
    await L.logout(page);
    await L.sleep(800);
    await L.googleReturn(page, mock, 'B');
    await L.until(async () => (await mine(page))?.length);
    const b = await mine(page);
    expect(JSON.stringify(b) === JSON.stringify(['قائمة ب الخاصة']), 'B: B\'s playlist only, nothing of A', b);
    expect(realErrors(page).length === 0, 'no page errors', realErrors(page));
  });

  await test('T16', 'The "اقرأ" part: in from the home screen, a du\'a, a group and a sura read, its place kept, back steps out page by page, "استمع" back to listening', async ({ browser, expect }) => {
    const { page, mock } = await L.newPage(browser);
    await L.boot(page, mock);
    const state = () => page.evaluate(() => ({
      reading: document.body.classList.contains('reading'),
      homeShown: getComputedStyle(document.getElementById('home-view')).display === 'block',
      appNav: getComputedStyle(document.querySelector('.bottom-nav:not(.read-nav)')).display,
      readNav: getComputedStyle(document.getElementById('read-nav')).display,
      lines: document.querySelectorAll('#read-app .rq-line').length,
      ayas: document.querySelectorAll('#read-app .rq-ayas').length,
      title: document.querySelector('#read-app .rq-bar-title, #read-app .rq-titles h1')?.textContent || '',
    }));
    expect(await page.locator('#home-greeting').count() === 0, 'no greeting at the top of the home screen');
    await page.click('.read-btn');
    await L.until(() => page.locator('#read-app .rq-tile').count(), 10000);
    let s = await state();
    expect(s.reading && s.appNav === 'none' && s.readNav === 'flex', 'the part opens with its own bottom bar', s);
    await page.click('#read-nav [data-tab="duas"]');
    await page.click('[data-read="open:t:kumayl"]');
    await L.until(async () => (await state()).lines > 10, 10000);
    s = await state();
    expect(s.title === 'دعاء كميل' && s.lines > 10, 'a du\'a opens with its words', { title: s.title, lines: s.lines });
    await page.evaluate(() => { document.getElementById('read-app').scrollTop = 2500; });
    await L.sleep(400);
    await page.goBack();
    await L.sleep(400);
    s = await state();
    expect(s.reading && s.title === 'الأدعية', 'back: the du\'as list, still in the part', s.title);
    const cards = await page.evaluate(() => [...document.querySelectorAll('#read-app [data-read^="group:"]')].map((b) => b.dataset.read));
    expect(['sahifa', 'munajat', 'week', 'needs', 'occasions', 'taqibat'].every((g) => cards.includes(`group:${g}`)), 'the du\'as tab: a card for each group on it', cards);
    await page.click('[data-read="group:munajat"]');
    await L.sleep(300);
    const munajat = await page.evaluate(() => ({ title: document.querySelector('#read-app .rq-titles h1')?.textContent, rows: document.querySelectorAll('#read-app .rq-row').length }));
    expect(munajat.title === 'المناجاة الخمس عشرة' && munajat.rows === 15, 'a group\'s card opens its list', munajat);
    await page.goBack();
    await L.sleep(300);
    await page.click('[data-read="open:t:ashara"]');
    await L.until(async () => (await state()).lines > 10, 10000);
    const heads = await page.evaluate(() => [...document.querySelectorAll('#read-app .rq-part')].map((h) => h.textContent));
    expect(heads.filter((h) => h === 'عشر مرات').length >= 10, 'how many times a saying is said, over it', heads);
    await page.goBack();
    await L.sleep(300);
    await page.click('#read-nav [data-tab="quran"]');
    await page.click('[data-read="open:q:112"]');
    await L.until(async () => (await state()).ayas > 0, 10000);
    const basmalas = await page.evaluate(() => (document.querySelector('#read-app .rq-quran').textContent.match(/بِسْمِ/g) || []).length);
    expect(basmalas === 1, 'a sura\'s basmala shown once, above it', basmalas);
    await page.goBack();
    await L.sleep(300);
    await page.click('#read-nav [data-tab="home"]');
    await L.sleep(300);
    const last = await page.evaluate(() => document.querySelector('[data-read^="open:"] .rq-label')?.textContent);
    expect(last === 'تابع القراءة', 'the part\'s home offers to go on reading', last);
    await page.click('[data-read="listen"]');
    await L.sleep(600);
    s = await state();
    expect(!s.reading && s.homeShown && s.appNav === 'flex', '"استمع": back to the home screen and its bar', s);
    await page.click('.read-btn');
    await L.sleep(300);
    await page.goBack();
    await L.sleep(500);
    s = await state();
    expect(!s.reading && s.homeShown, 'the phone\'s back from the part\'s home: back to listening', s);
    expect(realErrors(page).length === 0, 'no page errors', realErrors(page));
  });

  if (server) server.kill();
  const failed = results.filter((r) => r.status !== 'passed');
  console.log(`
${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
