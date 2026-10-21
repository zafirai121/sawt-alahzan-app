// A stand-in for the app's Supabase project and site API, served from inside the
// browser test (page.route): nothing leaves this machine.
const SB = 'https://ckhtndmrcypkqrpjlzli.supabase.co';
const SITE = 'https://web.soutalahzan.com';

const USERS = {
  A: { id: 'aaaaaaaa-0000-4000-8000-00000000000a', email: 'a@test.local', name: 'حساب أ', password: 'pass-a-123' },
  B: { id: 'bbbbbbbb-0000-4000-8000-00000000000b', email: 'b@test.local', name: 'حساب ب', password: 'pass-b-123' },
};
const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function jwtFor(u, n = 0) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600, session_id: `s-${u.id}-${n}` })}.${b64u('sig')}`;
}
const userObj = (u) => ({
  id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, is_anonymous: false,
  app_metadata: { provider: 'google', providers: ['google'] },
  user_metadata: { full_name: u.name, name: u.name, email: u.email },
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});
let sessionN = 0;
function sessionFor(u) {
  sessionN++;
  const now = Math.floor(Date.now() / 1000);
  return { access_token: jwtFor(u, sessionN), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: `rt-${u.id}-${sessionN}`, user: userObj(u) };
}
const userByJwt = (auth) => {
  try { const sub = JSON.parse(Buffer.from(auth.replace(/^Bearer /, '').split('.')[1], 'base64url')).sub; return Object.values(USERS).find((u) => u.id === sub) || null; } catch { return null; }
};
const userByRefresh = (rt) => Object.values(USERS).find((u) => rt && rt.startsWith(`rt-${u.id}`)) || null;

// The library: 2500 tracks, three pages of 1000 (newest id first)
function makeDb() {
  const tracks = [];
  for (let id = 1; id <= 2500; id++) {
    let title = `مقطع تجريبي ${id}`;
    if (id === 7) title = 'قصيدة الصفحة الأخيرة';
    if (id === 1000) title = 'قصيدة الصفحة الثانية';
    tracks.push({
      id, title, file_name: `${id}.mp3`, reciter_name: `رادود ${(id % 10) + 1}`, reciter_id: (id % 10) + 1,
      image_url: `https://img.test.local/${id}.png`, file_url: `https://media.test.local/${id}.wav`,
      category: ['latmiya', 'dua', 'muwalid', 'naei'][id % 4], duration: 60 + (id % 300), listen_count: id % 97, user_id: null, album: '',
      created_at: '2026-01-01T00:00:00Z',
    });
  }
  const reciters = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `رادود ${i + 1}`, image_url: `https://img.test.local/r${i + 1}.png` }));
  const A = USERS.A.id, B = USERS.B.id;
  return {
    audio_library: tracks,
    reciters,
    favorites: [{ user_id: A, poem_id: 'cloud_2500' }, { user_id: A, poem_id: 'cloud_2499' }, { user_id: B, poem_id: 'cloud_2497' }],
    user_playlists: [
      { user_id: A, id: 'pl_a', title: 'قائمة أ الخاصة', tracks: ['cloud_2498'], created_at: '2026-01-01' },
      { user_id: B, id: 'pl_b', title: 'قائمة ب الخاصة', tracks: ['cloud_2496'], created_at: '2026-01-01' },
    ],
    follows: [{ follower_id: A, followed_reciter_id: 3 }, { follower_id: B, followed_reciter_id: 8 }],
    profiles: [{ id: A, display_name: 'اسم أ', avatar_url: null }, { id: B, display_name: 'اسم ب', avatar_url: null }],
  };
}

// 1 s of silence, 8 kHz mono 16-bit
function silentWav(seconds = 1) {
  const n = 8000 * seconds * 2, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function applyFilters(rows, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const m = /^(eq|neq|in|gt|lt|is)\.(.*)$/.exec(v);
    if (!m) continue;
    const [, op, val] = m;
    if (op === 'eq') rows = rows.filter((r) => String(r[k]) === val);
    else if (op === 'neq') rows = rows.filter((r) => String(r[k]) !== val);
    else if (op === 'in') { const set = new Set(val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''))); rows = rows.filter((r) => set.has(String(r[k]))); }
    else if (op === 'is') rows = rows.filter((r) => (val === 'null' ? r[k] == null : true));
  }
  return rows;
}

function createMock(opts = {}) {
  const db = makeDb();
  const log = [];          // every request: { method, path, query, body, user }
  const hooks = opts.hooks || {}; // per-test changes: (req) => response | undefined
  const wav = silentWav(opts.wavSeconds || 1);

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const origin = req.headers().origin || '*';
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': req.headers()['access-control-request-headers'] || '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS,HEAD,PUT',
      'access-control-expose-headers': 'content-range, x-total-count',
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (status, body, extra = {}) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: body === undefined ? '' : JSON.stringify(body) });

    if (url.origin === 'https://img.test.local') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/png' }, body: PNG });
    if (url.origin === 'https://media.test.local') {
      const entry = { method, path: url.pathname, kind: 'media' };
      log.push(entry);
      if (hooks.media) { const r = await hooks.media(url, req); if (r) return route.fulfill({ headers: cors, ...r }); }
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'audio/wav', 'accept-ranges': 'none' }, body: wav });
    }
    if (url.origin === SITE) {
      log.push({ method, path: url.pathname, kind: 'site' });
      return json(200, {});
    }
    if (url.origin !== SB) return route.abort(); // fonts and anything else: offline

    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = req.postData(); }
    const user = userByJwt(req.headers().authorization || '');
    const entry = { method, path: url.pathname, query: url.search, body, user: user?.email || null, t: Date.now(), retry: req.headers()['x-retry-count'] || '0' };
    log.push(entry);
    if (hooks.any) { const r = await hooks.any(entry, url, req); if (r) return json(r.status, r.body, r.headers); }

    // ── Auth ──
    if (url.pathname === '/auth/v1/user' && method === 'GET') return user ? json(200, userObj(user)) : json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
    if (url.pathname === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = Object.values(USERS).find((x) => x.email === body?.email && x.password === body?.password);
        return u ? json(200, sessionFor(u)) : json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      if (grant === 'refresh_token') { const u = userByRefresh(body?.refresh_token); return u ? json(200, sessionFor(u)) : json(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }); }
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });

    // ── REST ──
    const m = /^\/rest\/v1\/(rpc\/)?([a-z_]+)$/.exec(url.pathname);
    if (!m) return json(404, { message: 'not found' });
    if (m[1]) return json(200, null);
    const table = m[2];
    if (!db[table]) return json(404, { code: '42P01', message: `relation ${table} does not exist` });
    const prefer = req.headers().prefer || '';
    if (method === 'GET' || method === 'HEAD') {
      let rows = applyFilters(db[table], url.searchParams);
      const order = url.searchParams.get('order');
      if (order) {
        const [col, dir] = order.split(',')[0].split('.');
        rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      const total = rows.length;
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : rows.length;
      rows = rows.slice(offset, offset + limit);
      const headers = { 'content-range': `${offset}-${offset + rows.length - 1}/${/count=exact/.test(prefer) ? total : '*'}` };
      if ((req.headers().accept || '').includes('vnd.pgrst.object')) {
        if (rows.length !== 1) return json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
        return json(200, rows[0], headers);
      }
      return json(200, rows, headers);
    }
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const keys = (url.searchParams.get('on_conflict') || '').split(',').filter(Boolean);
      for (const row of list) {
        const i = keys.length ? db[table].findIndex((r) => keys.every((k) => String(r[k]) === String(row[k]))) : -1;
        if (i >= 0) { if (!/ignore-duplicates/.test(prefer)) db[table][i] = { ...db[table][i], ...row }; } else db[table].push({ ...row });
      }
      return json(201, /return=representation/.test(prefer) ? list : undefined);
    }
    if (method === 'DELETE') {
      const gone = new Set(applyFilters(db[table], url.searchParams));
      db[table] = db[table].filter((r) => !gone.has(r));
      return route.fulfill({ status: 204, headers: cors });
    }
    if (method === 'PATCH') {
      applyFilters(db[table], url.searchParams).forEach((r) => Object.assign(r, body));
      return route.fulfill({ status: 204, headers: cors });
    }
    return json(405, {});
  }
  return { db, log, hooks, handle, USERS, sessionFor };
}

module.exports = { createMock, USERS, sessionFor, SB };
