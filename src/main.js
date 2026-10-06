import { supabase, isPasswordRecovery } from './supabaseClient.js';
import { icon, setIcon, startIcons } from './icons.js';
import { dominantHsl, playerShades, mixHex } from './color.js';

// ═══ Constants ═══════════════════════════════════════════════════════════════
const SITE_URL = 'https://web.soutalahzan.com';
const APP_URL = new URL(import.meta.env.BASE_URL, location.origin).href;
const FALLBACK_COVER = `${import.meta.env.BASE_URL}icon-512.png`;
const AUDIO_CACHE = 'sawt-alahzan-audio-cache-v1';
const PAGE_SIZE = 1000; // Supabase returns at most 1000 rows per request
// Lyrics are left out of the library download (they can be long, and are only
// needed for the track being viewed or played), see loadDetails()
const TRACK_COLUMNS = 'id,title,file_name,reciter_name,reciter_id,image_url,file_url,category,duration,listen_count';
const NO_LYRICS = 'الكلمات غير متوفرة لهذا المقطع';

// Same groups as the website's category pages (the database mixes Arabic and
// English values for the same category)
const CATEGORIES = [
  { id: 'hussainiya', title: 'قصائد حسينية', color: '#8400E7', values: ['hussainiya_poems', 'قصائد حسينية', 'لطميات وقصائد', 'لطمية', 'latmiya', 'nazla', 'shoor', 'شور'] },
  { id: 'dua', title: 'أدعية ومناجاة', color: '#1E8C45', values: ['dua', 'أدعية ومناجاة', 'adhkar'] },
  { id: 'muwalid', title: 'مواليد', color: '#1E3264', values: ['muwalid', 'مواليد'] },
  { id: 'naei', title: 'نعي', color: '#AF2896', values: ['naei', 'نعي'] },
  { id: 'quran', title: 'قرآن كريم', color: '#006450', values: ['quran', 'قرآن'] },
  { id: 'ziyarat', title: 'زيارات', color: '#8C1932', values: ['ziyarat', 'زيارات'] },
  { id: 'nasheed', title: 'أناشيد', color: '#E13300', values: ['أناشيد', 'nasheed', 'anasheed'] },
  { id: 'variety', title: 'منوعات', color: '#E8115B', values: ['منوعات', 'variety', 'lectures', 'محاضرات'] },
];

// English reciter names found in older uploads
const RECITER_TRANSLATIONS = {
  'basim karbalaei': 'باسم الكربلائي', basim_karbalaei: 'باسم الكربلائي', 'mulla basim': 'باسم الكربلائي',
  'ammar al kinani': 'عمار الكناني', ammar_alkinani: 'عمار الكناني',
  'qahtan al bdeiri': 'قحطان البديري', qahtan_al_bdeiri: 'قحطان البديري',
  'muslim al waeli': 'مسلم الوائلي', muslim_al_waeli: 'مسلم الوائلي',
  'ali al delfi': 'علي الدلفي', ali_delphi: 'علي الدلفي', ali_aldelfi: 'علي الدلفي',
  'hussain faisal': 'حسين فيصل', hussein_faisal: 'حسين فيصل',
  'mohammed al halfi': 'محمد الحلفي', mohamed_alhalfi: 'محمد الحلفي',
  'hussain al akraf': 'حسين الأكرف', hussain_alakraf: 'حسين الأكرف',
  murtadha_harb: 'مرتضى حرب', 'murtadha harb': 'مرتضى حرب',
  sayed_faqid: 'سيد فاقد الموسوي', sayed_faqid_almousawi: 'سيد فاقد الموسوي',
  mustafa_alsudani: 'مصطفى السوداني', ali_bouhamad: 'علي بوحمد', mohammed_bujbara: 'محمد بوجبارة',
  ahmed_alsaeedi: 'أحمد الساعدي', mohammed_al_jnaid: 'محمد الجنامي', mohamed_aljanami: 'محمد الجنامي',
};

// ═══ Small helpers ═══════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);

// Everything shown from the database goes through esc(): titles and names are
// written by uploaders and must never be interpreted as HTML.
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const store = {
  get(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  },
};

// Arabic spelling variants people mix when searching (أحمد / احمد, فاطمة / فاطمه)
const normalize = (s) => String(s || '').toLowerCase()
  .replace(/[ً-ْـ]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');

// Covers are stored full size; Cloudflare resizes them on the fly (as on the website)
const IMAGE_HOSTS = new Set(['soutalahzan.com', 'ckhtndmrcypkqrpjlzli.supabase.co', 'images.unsplash.com', 'pub-8168942d67ae4c1fb48c404f11458b4a.r2.dev']);
const SIZE_STEPS = [96, 160, 320, 480, 640, 800, 1080, 1280, 1600];
// Phones draw 2 to 3 real pixels per CSS pixel: covers are asked for at the
// screen's own density, so none is enlarged into a blur
const PIXEL_RATIO = Math.min(Math.max(window.devicePixelRatio || 2, 2), 3);
function thumb(url, cssWidth) {
  if (!url) return FALLBACK_COVER;
  try {
    if (!IMAGE_HOSTS.has(new URL(url).hostname)) return url;
  } catch { return url; }
  const px = SIZE_STEPS.find((s) => s >= cssWidth * PIXEL_RATIO) ?? SIZE_STEPS.at(-1);
  return `https://soutalahzan.com/cdn-cgi/image/width=${px},quality=85,format=auto,fit=scale-down/${url}`;
}

// "0:00" means the duration was never measured
const formatDuration = (d) => (typeof d === 'string' && /^\d+(:\d{2}){1,2}$/.test(d) && !/^0+(:00)+$/.test(d) ? d : '');
const formatTime = (s) => {
  if (!s || !isFinite(s)) return '0:00';
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const formatCount = (n) => (n || 0).toLocaleString('ar');

// Same order every time for a given seed (a "daily" mix that doesn't reshuffle on every tap)
function seededShuffle(list, seed) {
  const a = [...list];
  let x = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x = (x * 9301 + 49297) % 233280;
    const j = Math.floor((x / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// The listener's own date, so "today" changes at their midnight
const todaySeed = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
const shuffled = (list) => seededShuffle(list, Math.floor(Math.random() * 233280));

// Cards and rows are divs: give them a button role and a tab stop so they work
// from the keyboard and screen readers too (Enter/Space handled in one place below)
function clickable(el, onClick) {
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.onclick = onClick;
  return el;
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function initialAvatar(name) {
  const letter = esc((name || '?').trim().charAt(0) || '?');
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#d97736"/>` +
    `<text x="50" y="66" font-size="48" font-family="Tajawal, Arial" font-weight="700" fill="#121212" text-anchor="middle">${letter}</text></svg>`);
}

// ═══ Data ════════════════════════════════════════════════════════════════════
const trackById = new Map();
let allTracks = [];        // newest first
let popularTracks = [];    // most listened
let reciters = [];         // { id, dbId, name, image, count }
let reciterByName = new Map();
let fullyLoaded = false;
let resolveDataReady;
const dataReady = new Promise((resolve) => { resolveDataReady = resolve; });

function translateReciterName(name) {
  if (!name) return 'مجهول';
  const clean = name.toLowerCase().trim();
  if (RECITER_TRANSLATIONS[clean]) return RECITER_TRANSLATIONS[clean];
  if (/^[a-z_ \-0-9]+$/i.test(name)) return name.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  return name.trim();
}

function mapTrack(row) {
  const existing = trackById.get(String(row.id));
  const track = {
    id: String(row.id),
    title: row.title || row.file_name || 'قصيدة بدون عنوان',
    reciterName: translateReciterName(row.reciter_name),
    reciterDbId: row.reciter_id ? String(row.reciter_id) : null,
    coverImage: row.image_url || '',
    audioUrl: row.file_url || '',
    category: row.category || '',
    duration: formatDuration(row.duration),
    listens: row.listen_count || 0,
    searchKey: undefined, // see searchKey()
  };
  // undefined = not fetched yet; '' = the track has none
  if ('lyrics' in row) track.lyrics = typeof row.lyrics === 'string' ? row.lyrics.trim() : '';
  if (existing) { Object.assign(existing, track); return existing; }
  trackById.set(track.id, track);
  return track;
}

// A track's full row (lyrics, date added, and who wrote / composed it when the
// row says so), fetched when the track is opened or played
const CREDIT_FIELDS = [
  ['الكلمات', ['poet', 'poet_name', 'lyricist', 'writer']],
  ['الألحان', ['composer', 'composer_name', 'melody']],
  ['الإنتاج', ['producer', 'production', 'studio']],
];
const textOf = (row, keys) => keys.map((k) => row?.[k]).find((v) => typeof v === 'string' && v.trim())?.trim();
const detailRequests = new Map();
function loadDetails(track) {
  if (track.detailed) return Promise.resolve(track);
  if (!detailRequests.has(track.id)) {
    detailRequests.set(track.id, supabase.from('audio_library').select('*').eq('id', track.id).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw error;
        track.lyrics = typeof data?.lyrics === 'string' ? data.lyrics.trim() : '';
        track.addedAt = data?.created_at || '';
        track.credits = CREDIT_FIELDS.map(([role, keys]) => ({ role, name: textOf(data, keys) })).filter((c) => c.name);
        track.detailed = true;
        return track;
      })
      .catch(() => track) // offline or failed: tried again next time
      .finally(() => detailRequests.delete(track.id)));
  }
  return detailRequests.get(track.id);
}

// A reciter's bio, when the reciters table carries one
const reciterBios = new Map(); // db id → text ('' = none)
function loadReciterBio(r) {
  if (!r?.dbId) return Promise.resolve('');
  if (reciterBios.has(r.dbId)) return Promise.resolve(reciterBios.get(r.dbId));
  return supabase.from('reciters').select('*').eq('id', Number(r.dbId)).maybeSingle()
    .then(({ data, error }) => {
      if (error) throw error;
      const bio = textOf(data, ['bio', 'about', 'description']) || '';
      reciterBios.set(r.dbId, bio);
      return bio;
    })
    .catch(() => '');
}

async function fetchTrackPage(from) {
  const { data, error, count } = await supabase
    .from('audio_library')
    .select(TRACK_COLUMNS, from === 0 ? { count: 'exact' } : undefined)
    .order('id', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: data || [], count };
}

let loadState = 'idle'; // loading → ready, or failed (retried when the connection returns)

async function loadData() {
  if (loadState === 'loading' || loadState === 'ready') return;
  loadState = 'loading';
  showLoading();
  let first, popular, recRes;
  try {
    [first, popular, recRes] = await Promise.all([
      fetchTrackPage(0),
      supabase.from('audio_library').select(TRACK_COLUMNS).order('listen_count', { ascending: false }).limit(40),
      supabase.from('reciters').select('id,name,image_url').limit(1000),
    ]);
  } catch (err) {
    console.error('Error fetching data:', err);
    loadState = 'failed';
    showOfflineHome();
    return;
  }
  loadState = 'ready';
  dataVersion++;
  allTracks = first.rows.map(mapTrack);
  popularTracks = (popular.data || []).map(mapTrack);
  buildReciters(recRes.data || []);
  renderHome();
  resolveDataReady();
  restoreLastTrack();
  // Back online after the offline screen: redraw whatever page is open
  if (currentTab !== 'home' || navStack.some((e) => e.type === 'page')) refreshOpenViews();
  handleDeepLink();

  // The rest of the library, in parallel, without holding up the first screen
  try {
    const pages = [];
    for (let from = PAGE_SIZE; from < (first.count || 0); from += PAGE_SIZE) pages.push(fetchTrackPage(from));
    const rest = await Promise.all(pages);
    rest.forEach((p) => allTracks.push(...p.rows.map(mapTrack)));
    // A track uploaded while the pages load shifts them by one: the same track
    // can then arrive twice (mapTrack hands back the same object)
    allTracks = [...new Set(allTracks)];
    fullyLoaded = true;
  } catch (err) {
    console.warn('Could not load the whole library:', err);
  }
  buildReciters(recRes.data || []);
  backfillDownloadMeta();
  dataVersion++;
  const atTop = document.querySelector('.main-container').scrollTop < 40;
  if (navStack.some((e) => e.type === 'page') || currentTab !== 'home' || atTop) refreshOpenViews();
}

// No connection (or the server is unreachable): what was downloaded still plays
function showOfflineHome() {
  const saved = downloadedTracks();
  const container = $('sections-container');
  container.innerHTML = `
    <div class="offline-banner animate-in">
      ${icon('wifi-off')}
      <div style="flex: 1;">
        <div class="offline-title">${navigator.onLine ? 'تعذّر الاتصال بالخادم' : 'لا يوجد اتصال بالإنترنت'}</div>
        <div class="muted">${saved.length ? 'يمكنك الاستماع إلى تنزيلاتك الآن' : 'تأكد من اتصالك ثم حاول مجدداً'}</div>
      </div>
      <button class="chip-btn">إعادة المحاولة</button>
    </div>`;
  container.querySelector('button').onclick = () => loadData();
  if (saved.length) {
    const list = document.createElement('div');
    list.className = 'track-list';
    container.appendChild(section('تنزيلاتك', list));
    renderTrackList(list, saved);
    restoreLastTrack();
  }
}

window.addEventListener('offline', () => toast('انقطع الاتصال بالإنترنت، تنزيلاتك متاحة للاستماع'));
window.addEventListener('online', () => {
  if (loadState === 'failed') { toast('عاد الاتصال بالإنترنت'); loadData(); }
});

// Reciters come from the reciters table (real photos); names that only appear
// on tracks are added too, using a cover of theirs as the photo.
function buildReciters(rows) {
  const counts = new Map();
  const firstCover = new Map();
  for (const t of allTracks) {
    counts.set(t.reciterName, (counts.get(t.reciterName) || 0) + 1);
    if (!firstCover.has(t.reciterName) && t.coverImage) firstCover.set(t.reciterName, t.coverImage);
  }
  const map = new Map();
  for (const r of rows) {
    const name = translateReciterName(r.name);
    if (map.has(name)) continue;
    map.set(name, { id: `r${r.id}`, dbId: String(r.id), name, image: r.image_url || firstCover.get(name) || '', hasPhoto: !!r.image_url, count: counts.get(name) || 0 });
  }
  for (const [name, count] of counts) {
    if (name === 'مجهول' || map.has(name)) continue;
    map.set(name, { id: `n${name}`, dbId: null, name, image: firstCover.get(name) || '', hasPhoto: false, count });
  }
  reciters = [...map.values()].sort((a, b) => b.count - a.count);
  reciterByName = map;
}

// Normalised "title reciter", worked out once per track rather than per keystroke
const searchKey = (t) => (t.searchKey ??= normalize(`${t.title} ${t.reciterName}`));

// A reciter's tracks (newest first), from an index built once per library load
let byReciter = null;
let byReciterOf = null;
let byReciterSize = 0;
function tracksOf(name) {
  if (byReciterOf !== allTracks || byReciterSize !== allTracks.length) {
    byReciter = new Map();
    for (const t of allTracks) {
      if (!byReciter.has(t.reciterName)) byReciter.set(t.reciterName, []);
      byReciter.get(t.reciterName).push(t);
    }
    byReciterOf = allTracks;
    byReciterSize = allTracks.length;
  }
  return byReciter.get(name) || [];
}
const reciterOf = (track) => reciterByName.get(track.reciterName);
const categoryOf = (track) => CATEGORIES.find((c) => c.values.includes(track.category));

// ═══ Library state (likes, downloads, playlists, follows, history) ═══════════
let currentUser = null;
let profile = null; // { display_name, avatar_url }

const lib = {
  likes: new Set(store.get('sawt_likes', []).map(String)),
  downloads: new Set(store.get('sawt_downloads', []).map(String)),
  playlists: store.get('sawt_playlists', []).map((p) => ({ id: String(p.id), name: p.name, tracks: (p.tracks || []).map(String) })),
  follows: new Set(store.get('sawt_artists', [])),
  history: store.get('sawt_history', []), // [{ id, t }] newest first
  plays: store.get('sawt_plays', {}),      // id → how many times it was played
  hidden: new Set(store.get('sawt_hidden', [])),     // never suggested, skipped when reached
  excluded: new Set(store.get('sawt_excluded', [])), // left out of their taste
  saveLocal() {
    if (!currentUser) {
      store.set('sawt_likes', [...this.likes]);
      store.set('sawt_playlists', this.playlists);
      store.set('sawt_artists', [...this.follows]);
    } else {
      // Reciters known only by name (no database id) can't be followed in the account
      store.set(localFollowsKey(), [...this.follows].filter((n) => !reciterByName.get(n)?.dbId));
    }
    store.set('sawt_downloads', [...this.downloads]);
    store.set('sawt_history', this.history);
    store.set('sawt_plays', this.plays);
    store.set('sawt_hidden', [...this.hidden]);
    store.set('sawt_excluded', [...this.excluded]);
  },
};

const localFollowsKey = () => `sawt_artists_${currentUser.id}`;

// The phone app stores track ids as "cloud_<id>"; both apps share these tables
const cloudId = (id) => `cloud_${id}`;
const fromCloudId = (pid) => String(pid).replace(/^cloud_/, '');

async function syncFromCloud() {
  await dataReady;
  if (!currentUser) return;
  const uid = currentUser.id;
  // A guest's likes, playlists and follows move into the account on first sign-in
  const guestLikes = store.get('sawt_likes', []).map(String);
  const guestPlaylists = store.get('sawt_playlists', []);
  const guestFollows = store.get('sawt_artists', []);
  // Supabase reports failures in `error` (it doesn't throw): the guest copy is
  // cleared only once the account has it, so a failed upload is retried next time
  try {
    if (guestLikes.length) {
      const { error } = await supabase.from('favorites').upsert(guestLikes.map((id) => ({ user_id: uid, poem_id: cloudId(id) })), { onConflict: 'user_id,poem_id', ignoreDuplicates: true });
      if (error) throw error;
      store.set('sawt_likes', []);
    }
    if (guestPlaylists.length) {
      const { error } = await supabase.from('user_playlists').upsert(guestPlaylists.map((p) => ({
        user_id: uid, id: safePlaylistId(p.id), title: p.name, tracks: (p.tracks || []).map((t) => cloudId(t)),
      })), { onConflict: 'user_id,id' });
      if (error) throw error;
      store.set('sawt_playlists', []);
    }
    if (guestFollows.length) {
      const ids = guestFollows.map((n) => reciterByName.get(n)?.dbId).filter(Boolean);
      if (ids.length) {
        const { error } = await supabase.from('follows').upsert(ids.map((id) => ({ follower_id: uid, followed_reciter_id: Number(id) })), { onConflict: 'follower_id,followed_reciter_id', ignoreDuplicates: true });
        if (error) throw error;
      }
      const nameOnly = guestFollows.filter((n) => !reciterByName.get(n)?.dbId);
      store.set(localFollowsKey(), [...new Set([...store.get(localFollowsKey(), []), ...nameOnly])]);
      store.set('sawt_artists', []);
    }
  } catch (e) { console.warn('Could not move guest data:', e); }

  const [fav, pls, fol] = await Promise.all([
    supabase.from('favorites').select('poem_id').eq('user_id', uid),
    supabase.from('user_playlists').select('id,title,tracks').eq('user_id', uid).order('created_at'),
    supabase.from('follows').select('followed_reciter_id').eq('follower_id', uid),
  ]);
  if (!fav.error) lib.likes = new Set((fav.data || []).map((r) => fromCloudId(r.poem_id)));
  if (!pls.error) lib.playlists = (pls.data || []).map((r) => ({ id: r.id, name: r.title, tracks: (r.tracks || []).map(fromCloudId) }));
  if (!fol.error) {
    const ids = new Set((fol.data || []).map((r) => String(r.followed_reciter_id)));
    lib.follows = new Set([...reciters.filter((r) => r.dbId && ids.has(r.dbId)).map((r) => r.name), ...store.get(localFollowsKey(), [])]);
  }
  libVersion++;
  refreshLikeButtons();
  refreshOpenViews();
}

const safePlaylistId = (id) => (/^[A-Za-z0-9_-]{1,100}$/.test(String(id)) ? String(id) : `pl_${Date.now()}`);

async function toggleLike(track) {
  const liked = !lib.likes.has(track.id);
  if (liked) lib.likes.add(track.id); else lib.likes.delete(track.id);
  lib.saveLocal();
  refreshLikeButtons();
  libraryChanged();
  toast(liked ? 'أُضيف إلى المفضلة' : 'أُزيل من المفضلة');
  if (currentUser) {
    const q = liked
      ? supabase.from('favorites').upsert({ user_id: currentUser.id, poem_id: cloudId(track.id) }, { onConflict: 'user_id,poem_id', ignoreDuplicates: true })
      : supabase.from('favorites').delete().eq('user_id', currentUser.id).eq('poem_id', cloudId(track.id));
    const { error } = await q;
    if (error) {
      console.warn('Could not save like:', error);
      if (liked) lib.likes.delete(track.id); else lib.likes.add(track.id);
      refreshLikeButtons();
      libraryChanged();
      toast('تعذر حفظ التغيير، تحقق من اتصالك');
      return !liked;
    }
  }
  return liked;
}

async function savePlaylist(pl) {
  lib.saveLocal();
  libraryChanged();
  if (!currentUser) return;
  const { error } = await supabase.from('user_playlists').upsert(
    { user_id: currentUser.id, id: pl.id, title: pl.name, tracks: pl.tracks.map(cloudId) },
    { onConflict: 'user_id,id' });
  if (error) { console.warn('Could not save playlist:', error); toast('تعذر حفظ القائمة في حسابك'); }
}

async function createPlaylist(name, tracks = []) {
  const pl = { id: `pl_${Date.now()}`, name, tracks: [...tracks] };
  lib.playlists.push(pl);
  await savePlaylist(pl);
  return pl;
}

async function deletePlaylist(pl) {
  if (currentUser) {
    const { error } = await supabase.from('user_playlists').delete().eq('user_id', currentUser.id).eq('id', pl.id);
    if (error) { console.warn('Could not delete playlist:', error); toast('تعذر حذف القائمة، تحقق من اتصالك'); return false; }
  }
  lib.playlists = lib.playlists.filter((p) => p.id !== pl.id);
  lib.saveLocal();
  libraryChanged();
  return true;
}

let followedNow = null; // { name, at }: the button drawn for it right after pops too

async function toggleFollow(reciter) {
  const following = !lib.follows.has(reciter.name);
  followedNow = following ? { name: reciter.name, at: Date.now() } : null;
  if (following) lib.follows.add(reciter.name); else lib.follows.delete(reciter.name);
  lib.saveLocal();
  libraryChanged();
  paintFollowButtons();
  if (currentUser && reciter.dbId) {
    const q = following
      ? supabase.from('follows').upsert({ follower_id: currentUser.id, followed_reciter_id: Number(reciter.dbId) }, { onConflict: 'follower_id,followed_reciter_id', ignoreDuplicates: true })
      : supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('followed_reciter_id', Number(reciter.dbId));
    const { error } = await q;
    if (error) {
      console.warn('Could not save follow:', error);
      if (following) lib.follows.delete(reciter.name); else lib.follows.add(reciter.name);
      libraryChanged();
      paintFollowButtons();
      toast('تعذر حفظ التغيير، تحقق من اتصالك');
      return !following;
    }
  }
  toast(following ? `تتابع الآن ${reciter.name}` : `ألغيت متابعة ${reciter.name}`);
  return following;
}

// Offline listening: the file and its covers go into the cache the service
// worker serves from, and the track's details are kept on the device so the
// downloads can be listed and played with no connection at all.
const DOWNLOAD_META = 'sawt_download_meta';
const downloadMeta = store.get(DOWNLOAD_META, {});
// The cover sizes the list, the mini player and the full player ask for
const coverUrls = (track) => (track.coverImage ? [...new Set([48, 50, 400].map((w) => thumb(track.coverImage, w)))] : []);

function rememberDownload(track) {
  const { id, title, reciterName, reciterDbId, coverImage, audioUrl, category, duration, listens, lyrics, addedAt, credits } = track;
  downloadMeta[id] = { id, title, reciterName, reciterDbId, coverImage, audioUrl, category, duration, listens, lyrics, addedAt, credits };
  store.set(DOWNLOAD_META, downloadMeta);
}

// Downloads made before their details were stored
function backfillDownloadMeta() {
  [...lib.downloads].forEach((id) => { if (!downloadMeta[id] && trackById.has(id)) rememberDownload(trackById.get(id)); });
}

function downloadedTrack(id) {
  if (!trackById.has(id) && downloadMeta[id]) trackById.set(id, { ...downloadMeta[id] });
  return trackById.get(id);
}
const downloadedTracks = () => [...lib.downloads].map(downloadedTrack).filter(Boolean);

async function toggleDownload(track) {
  if (lib.downloads.has(track.id)) {
    lib.downloads.delete(track.id);
    delete downloadMeta[track.id];
    lib.saveLocal();
    store.set(DOWNLOAD_META, downloadMeta);
    libraryChanged();
    try {
      const cache = await caches.open(AUDIO_CACHE);
      await Promise.all([track.audioUrl, ...coverUrls(track)].map((u) => cache.delete(u)));
    } catch { /* ignore */ }
    toast('حُذف التنزيل');
    return false;
  }
  if (!('caches' in window)) { toast('المتصفح لا يدعم التنزيل'); return false; }
  toast('جارٍ التنزيل...');
  const ok = await saveOffline(track);
  toast(ok ? 'تم التنزيل، يمكنك الاستماع بدون إنترنت' : 'تعذر تنزيل المقطع');
  return ok;
}

// A whole list (a mix, a radio, a playlist), one track after another
async function downloadAll(list) {
  if (!('caches' in window)) { toast('المتصفح لا يدعم التنزيل'); return; }
  const missing = list.filter((t) => !lib.downloads.has(t.id) && t.audioUrl);
  if (!missing.length) { toast('كل المقاطع منزّلة'); return; }
  toast(`جارٍ تنزيل ${formatCount(missing.length)} مقطع...`);
  let done = 0;
  for (const t of missing) if (await saveOffline(t, { quiet: true })) done++;
  libraryChanged();
  toast(done ? `تم تنزيل ${formatCount(done)} مقطع` : 'تعذر التنزيل، تحقق من اتصالك');
}

// The file, its covers and its details into the offline cache; `quiet` leaves
// redrawing the screens to the caller (a whole list at once)
// Being downloaded right now (shown on the downloads tab)
const downloading = new Set();
const downloadingChanged = () => { if (currentTab === 'downloads' && !topPage()) renderDownloadsTab(); };

async function saveOffline(track, { quiet = false } = {}) {
  downloading.add(track.id);
  downloadingChanged();
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const res = await fetch(track.audioUrl, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await cache.put(track.audioUrl, res);
    // Covers and lyrics are extras: if they fail, the download still counts
    await Promise.all([
      loadDetails(track),
      ...coverUrls(track).map((u) => fetch(u, { mode: 'cors' }).then((r) => r.ok && cache.put(u, r)).catch(() => {})),
    ]);
    lib.downloads.add(track.id);
    rememberDownload(track);
    lib.saveLocal();
    if (!quiet) libraryChanged();
    // Ask the browser not to clear downloads when the device runs low on space
    navigator.storage?.persist?.()?.catch(() => {});
    return true;
  } catch (e) {
    console.warn('Download failed:', e);
    return false;
  } finally {
    downloading.delete(track.id);
    downloadingChanged();
  }
}

function addToHistory(track) {
  lib.history = [{ id: track.id, t: Date.now() }, ...lib.history.filter((h) => h.id !== track.id)].slice(0, 100);
  lib.plays[track.id] = (lib.plays[track.id] || 0) + 1;
  // Counts only for what history still holds (it keeps the last 100)
  const kept = new Set(lib.history.map((h) => h.id));
  Object.keys(lib.plays).forEach((id) => { if (!kept.has(id)) delete lib.plays[id]; });
  lib.saveLocal();
}

// Hidden: never suggested, skipped when reached; excluded: left out of their taste
function toggleHidden(track) {
  const hide = !lib.hidden.has(track.id);
  if (hide) lib.hidden.add(track.id); else lib.hidden.delete(track.id);
  lib.saveLocal();
  libraryChanged();
  toast(hide ? 'أُخفي المقطع، لن يُقترح عليك ولن يُشغَّل تلقائياً' : 'أُظهر المقطع');
}
function toggleExcluded(track) {
  const out = !lib.excluded.has(track.id);
  if (out) lib.excluded.add(track.id); else lib.excluded.delete(track.id);
  lib.saveLocal();
  libraryChanged();
  toast(out ? 'استُبعد المقطع من لمحة ذوقك' : 'أُعيد المقطع إلى لمحة ذوقك');
}
const visible = (list) => (lib.hidden.size ? list.filter((t) => !lib.hidden.has(t.id)) : list);
window.openHiddenPage = () => openListPage('المقاطع المخفية', () => [...lib.hidden].map((id) => trackById.get(id)).filter(Boolean), null, true);
window.openExcludedPage = () => openListPage('المستبعدة من لمحة ذوقك', () => [...lib.excluded].map((id) => trackById.get(id)).filter(Boolean), null, true);

// What they play again and again: the most played first, then the most recent
function mostPlayed(n = 30) {
  return visible(historyTracks()).map((t, i) => ({ t, i })).sort((a, b) => (lib.plays[b.t.id] || 1) - (lib.plays[a.t.id] || 1) || a.i - b.i)
    .map((x) => x.t).slice(0, n);
}
const historyTracks = () => lib.history.map((h) => trackById.get(h.id)).filter(Boolean);

// ═══ Recently played, taste, daily mixes, radios ═════════════════════════════
// As in the phone app. "Recently played" (Spotify's) holds not only tracks but
// what they were played from (a reciter, a playlist, the likes, a radio, a
// daily mix...); each opens its own page instead of playing at once.
let recentPlayed = store.get('sawt_recent_played', []); // [{ kind, id }] newest first
let queueSource = null;   // what the queue was played from
let playingFrom = '';     // its name, under "now playing"
const sameSource = (a, b) => !!a && !!b && a.kind === b.kind && String(a.id) === String(b.id);

function rememberPlayedFrom(source) {
  const id = String(source.id ?? '');
  queueSource = { kind: source.kind, id };
  recentPlayed = [queueSource, ...recentPlayed.filter((r) => !sameSource(r, queueSource))].slice(0, 40);
  store.set('sawt_recent_played', recentPlayed);
}

function topTrackOf(name) {
  let best = null;
  for (const t of tracksOf(name)) if (!best || t.listens > best.listens) best = t;
  return best;
}
const reciterPhoto = (name) => reciterByName.get(name)?.image || topTrackOf(name)?.coverImage || '';

// A thing they played from, ready to show: its name, what it is, its picture
// (see artHtml) and the page it opens
function recentEntry(r) {
  switch (r.kind) {
    case 'track': {
      const t = trackById.get(r.id);
      return t && { key: `t:${t.id}`, title: t.title, subtitle: `مقطع • ${t.reciterName}`, art: { cover: t.coverImage }, open: () => openTrackDetail(t), more: () => openTrackOptions(t) };
    }
    case 'reciter':
      return tracksOf(r.id).length ? { key: `r:${r.id}`, title: r.id, subtitle: 'رادود', art: { cover: reciterPhoto(r.id), round: true }, open: () => openArtistDetail(r.id), more: () => openReciterOptions(r.id) } : null;
    case 'playlist': {
      const pl = lib.playlists.find((p) => p.id === r.id);
      return pl && { key: `p:${pl.id}`, title: pl.name, subtitle: `قائمة تشغيل • ${formatCount(pl.tracks.length)} مقطع`, art: { covers: playlistTracks(pl).map((t) => t.coverImage) }, open: () => openPlaylistPage(pl) };
    }
    case 'likes':
      return { key: 'likes', title: 'المقاطع المفضلة', subtitle: `قائمة تشغيل • ${formatCount(likesCount())} مقطع`, art: { likes: true }, open: () => openLikesPage() };
    case 'downloads':
      return { key: 'downloads', title: 'التنزيلات', subtitle: `${formatCount(lib.downloads.size)} مقطع على جهازك`, art: { downloads: true }, open: () => openDownloadsPage() };
    case 'radio': {
      const t = trackById.get(r.id);
      return t && { key: `radio:${t.id}`, title: `${t.title} الراديو`, subtitle: `راديو • ${t.reciterName}`, art: { cover: t.coverImage, radio: true }, open: () => openRadioPage(t) };
    }
    case 'mix': {
      const m = dailyMixes().find((x) => String(x.number) === r.id);
      return m && { key: `mix:${m.number}`, title: mixTitle(m), subtitle: mixReciters(m), art: { mix: m }, open: () => openMixPage(m.number) };
    }
    case 'category': {
      const c = CATEGORIES.find((x) => x.id === r.id);
      return c && { key: `c:${c.id}`, title: c.title, subtitle: 'تصنيف', art: { category: c }, open: () => openCategoryDetail(c) };
    }
    default: return null;
  }
}

// Newest first, only what still exists (a deleted playlist drops out); topped
// up with the tracks they played while the list is short
function recentEntries(n = 20) {
  const items = recentPlayed.length >= 8 ? recentPlayed : [...recentPlayed, ...lib.history.map((h) => ({ kind: 'track', id: h.id }))];
  const out = [];
  const seen = new Set();
  for (const r of items) {
    const e = recentEntry(r);
    if (!e || seen.has(e.key)) continue;
    seen.add(e.key);
    out.push(e);
    if (out.length >= n) break;
  }
  return out;
}

// The brand's S, drawn from the same outline as the phone app's logo
const S_PATH = 'M93.3,252.99 L82.96,252.8 L77.64,252.38 L65.03,250.75 L55.48,249.31 L44.16,247.12 L38.05,245.48 L34.51,244.27 L18.43,239.6 L2.22,233.56 L0.96,232.83 L0.23,231.84 L0,230.52 L0.21,228.9 L3.62,217.07 L6.68,208.63 L11.05,193.75 L14.13,185.08 L18.19,171.14 L20.92,163.63 L23.21,156.17 L23.69,155.15 L24.39,154.42 L25.48,154.05 L26.85,154.26 L46.71,161.82 L51.9,163.38 L61.25,165.53 L72.88,167.4 L87.17,168.29 L89.98,168.17 L96.03,167.47 L98.33,166.78 L100.55,165.5 L101.64,164.1 L102.14,162.16 L102.13,160.86 L101.86,159.42 L101.31,157.97 L100.56,156.72 L99.61,155.67 L98.11,154.43 L94.56,152.22 L91.71,151.07 L88.8,150.23 L71.92,147.36 L66.6,145.93 L56.41,142.87 L49.57,140.47 L39.26,135.27 L34.17,132.11 L27.4,126.63 L24.77,124.01 L22.46,121.32 L18.29,115.74 L15.82,110.97 L12.57,102.21 L11.25,97.02 L10.83,93.95 L10.56,89.48 L10.54,83.24 L10.7,78.89 L11.11,74.56 L12.79,66.24 L14.7,60.15 L16.48,55.43 L17.8,52.5 L19.33,49.78 L23.41,43.37 L25.94,39.89 L28.35,37.06 L33.08,32.04 L39.58,26.53 L47.57,21.02 L52.15,18.36 L57.8,15.5 L66.94,11.64 L71.15,10.1 L76.89,8.34 L83.35,6.55 L91.04,4.74 L101.42,2.87 L118.53,0.97 L127.22,0.4 L136.8,0 L160.31,0.02 L179.31,0.96 L192.75,2.04 L195.93,2.62 L196.93,3.36 L197.37,4.59 L197.36,6.09 L196.86,9.81 L195.38,16.08 L190.89,43.84 L186.98,64.43 L184.54,79.74 L184.12,81.32 L183.46,82.41 L182.19,83.08 L180.53,83.18 L176.17,82.6 L161.6,81.18 L143.65,80.1 L129.17,80.07 L122.53,80.48 L118.98,80.93 L116.29,81.49 L113.24,82.44 L111.4,83.35 L109.71,84.66 L108.63,86.08 L108.07,87.73 L107.98,89.63 L108.2,90.84 L108.68,92.1 L109.45,93.33 L110.41,94.37 L113.19,96.34 L117.26,98.27 L123.1,99.93 L138.45,102.33 L147.34,104.2 L154.31,105.97 L166.03,109.5 L175.41,113.12 L182.84,116.69 L189.94,120.85 L195.14,124.64 L200.62,129.42 L204.17,133.36 L206.15,135.88 L210.52,143.26 L212.75,148.28 L214.01,153.02 L214.55,155.73 L215.08,160.71 L215.4,167.35 L215.38,173.14 L214.94,179.39 L214.31,184.51 L212.98,190.68 L212.38,192.84 L210.85,196.8 L207.13,204.83 L205.21,208.16 L199.98,215.19 L196.64,218.85 L190.37,224.57 L183.8,229.25 L177.44,233.14 L167.43,238.13 L159.45,241.4 L150.58,244.28 L147.31,245.51 L141.68,247.13 L133.58,248.78 L121.26,250.71 L107.16,252.35 L101.33,252.76 L93.3,252.99 Z';
document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="logo-s" viewBox="0 0 215.4 253"><path fill="#F1592A" d="${S_PATH}"/></symbol></svg>`);
// The app's mark on a white disc whose edge breaks into splashes (the large
// cards): a wavy rim with sharp spikes, and drops thrown around it
const SPLASH_PATH = 'M36.7 0C36.6 1.5 35.3 3.1 34.7 4.6C34 6 31.7 6.7 32.7 8.8C33.8 11 40.2 14.7 40.8 16.9C41.5 19.1 38.9 20.3 36.5 21.1C34.1 21.9 28.6 19.4 27.7 21.3C26.8 23.1 32.5 30.1 31.4 31.4C30.4 32.8 24.3 28.5 22.1 28.8C20 29 19.9 31 19 32.8C17.9 34.8 18.1 39.2 16.4 39.5C14.6 39.8 11.4 35.4 9.3 34.5C7.3 33.7 6.1 34.4 4.5 34.5C3 34.5 1.5 34.8 0 34.7C-1.5 34.6 -3 34 -4.4 33.8C-5.9 33.5 -7.4 33.4 -8.9 33.2C-10.4 32.9 -12 32.9 -13.4 32.4C-14.8 31.9 -16 30.8 -17.3 30C-18.7 29.3 -20 28.6 -21.4 27.9C-22.8 27.1 -24.3 26.5 -25.5 25.5C-26.8 24.6 -26.7 22.7 -28.9 22.2C-31.2 21.6 -37.7 23.7 -38.5 22.2C-39.3 20.7 -34.1 16.2 -33.3 13.8C-32.5 11.6 -32.1 10.4 -33.9 9.1C-35.7 7.6 -43.5 7.4 -43.6 5.7C-43.7 4.1 -34.4 2.1 -34.3 0C-34.2 -2.1 -43 -4 -43.1 -5.7C-43.2 -7.4 -36.6 -7.8 -34.9 -9.4C-33.4 -10.8 -34.6 -12.6 -34 -14.1C-33.5 -15.6 -32.5 -16.9 -31.6 -18.3C-30.8 -19.6 -29.7 -20.8 -28.8 -22.1C-27.8 -23.3 -26.9 -24.7 -25.9 -25.9C-24.8 -27.1 -23.7 -28.3 -22.5 -29.3C-21.3 -30.4 -19.9 -31.3 -18.6 -32.1C-17.2 -33 -15.5 -32.9 -14.2 -34.4C-12.9 -36 -12.8 -41.1 -11 -41.1C-9.2 -41 -6.5 -35.1 -4.5 -34C-2.6 -33 -1.7 -33.6 -0 -34.9C1.8 -36.4 3.9 -42.3 5.5 -42.1C7.2 -41.8 7.6 -35.3 9 -33.5C10.3 -31.8 11.8 -32.4 13.2 -31.9C14.7 -31.4 15.5 -30.3 17.7 -30.6C20 -31 24.7 -34.9 26.1 -34C27.4 -33 23.6 -26.5 25.3 -25.3C26.9 -24 34.5 -28.5 35.3 -27.1C36.2 -25.7 30.6 -19.8 30.1 -17.4C29.5 -15.1 31.5 -14.7 32.1 -13.3C32.6 -11.9 32.9 -10.4 33.4 -8.9C33.9 -7.5 34.7 -6.1 35.3 -4.6C35.8 -3.2 36.8 -1.5 36.7 0Z';
const SPLASH_DROPS = [[41.3, 19.0, 1.7], [-14.8, -42.8, 2.5], [-17.5, 44.6, 2.4], [-45.8, 16.3, 2.8], [-28.5, 40.8, 1.8], [-36.4, -30.5, 1.6], [-11.3, 47.4, 1.9], [41.1, -23.7, 1.5], [-37.8, 26.9, 1.4]];
const splashBadge = `<svg class="splash-badge" viewBox="-55 -55 110 110" aria-hidden="true"><g fill="#fff"><path d="${SPLASH_PATH}"/>${SPLASH_DROPS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g><use href="#logo-s" x="-17" y="-20" width="34" height="40"/></svg>`;
const sLogo = (cls = 's-disc') => `<span class="${cls}"><svg viewBox="0 0 215.4 253" aria-hidden="true"><use href="#logo-s"/></svg></span>`;

// A picture for what they played from: a cover (round for a reciter, a label
// on a radio), four covers for a playlist, the likes' and the downloads' own,
// a mix's, a category's colour. `small`: a thumbnail (no labels).
function artHtml(art, { small = false, width = 320 } = {}) {
  const img = (url, w = width) => `<img src="${esc(thumb(url, w))}" alt="" loading="lazy" />`;
  if (art.cover !== undefined) {
    return `<div class="art${art.round ? ' round' : ''}">${img(art.cover)}${art.radio && !small ? '<span class="art-badge">راديو</span>' : ''}</div>`;
  }
  if (art.covers) {
    const distinct = [...new Set(art.covers.filter(Boolean))];
    return distinct.length < 4
      ? `<div class="art">${img(distinct[0] || '')}</div>`
      : `<div class="art mosaic">${distinct.slice(0, 4).map((c) => img(c, width / 2)).join('')}</div>`;
  }
  if (art.likes) return `<div class="art art-likes">${icon('heart', { fill: true })}</div>`;
  if (art.downloads) return `<div class="art art-downloads">${icon('download-plain')}</div>`;
  if (art.mix) return mixCoverHtml(art.mix, width);
  if (art.category) return `<div class="art art-category" style="background:${art.category.color}">${small ? '' : `<span>${esc(art.category.title)}</span>`}</div>`;
  return '<div class="art"></div>';
}

// "Recently played" as the "most listened" section: short rows, five to a
// column, the columns scrolling sideways; a row opens its page, ⋮ gives a
// track's or a reciter's options
function recentColumns(entries) {
  const row = document.createElement('div');
  row.className = 'horizontal-scroller snap';
  for (let c = 0; c * 5 < entries.length && c < 5; c++) {
    const col = document.createElement('div');
    col.className = 'mini-col';
    entries.slice(c * 5, c * 5 + 5).forEach((e) => {
      const item = document.createElement('div');
      item.className = 'mini-row';
      item.innerHTML = `
        ${artHtml(e.art, { small: true, width: 48 })}
        <div class="mini-row-text"><div class="ellipsis">${esc(e.title)}</div><div class="ellipsis muted">${esc(e.subtitle)}</div></div>
        ${e.more ? `<button class="icon-btn row-more" aria-label="خيارات">${icon('more')}</button>` : '<span class="row-more-space"></span>'}`;
      clickable(item, e.open);
      if (e.more) item.querySelector('.row-more').onclick = (ev) => { ev.stopPropagation(); e.more(); };
      col.appendChild(item);
    });
    row.appendChild(col);
  }
  return row;
}

// ─── Taste: which reciters they love (what they play, more recent counts
// more; what they like; whom they follow) ───
function taste() {
  const w = new Map();
  const add = (name, v) => { if (name && name !== UNKNOWN_RECITER) w.set(name, (w.get(name) || 0) + v); };
  const skip = (id) => lib.excluded.has(id) || lib.hidden.has(id);
  lib.history.forEach((h, i) => { if (!skip(h.id)) add(trackById.get(h.id)?.reciterName, (1 + Math.log(lib.plays[h.id] || 1)) / (1 + i / 20)); });
  lib.likes.forEach((id) => { if (!skip(id)) add(trackById.get(id)?.reciterName, 1.5); });
  lib.follows.forEach((name) => add(name, 3));
  return w;
}
const topKeys = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

function interleave(a, b, every) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    for (let k = 0; k < every && i < a.length; k++) out.push(a[i++]);
    if (j < b.length) out.push(b[j++]);
  }
  return out;
}
const uniqueById = (list) => { const seen = new Set(); return list.filter((t) => !seen.has(t.id) && seen.add(t.id)); };

// "Made for you" before there is enough for a mix: unheard work by the reciters they love
function madeForYou(n = 15) {
  const w = taste();
  if (!w.size) return [];
  const heard = new Set(lib.history.map((h) => h.id));
  const picks = topKeys(w, 5).flatMap((name) => visible(tracksOf(name)).filter((t) => !heard.has(t.id)).sort((a, b) => b.listens - a.listens).slice(0, 12));
  return seededShuffle(picks, todaySeed()).slice(0, n);
}

// ─── Daily mixes (Spotify's "made for you") ───
// One around each of the reciters they love most, with the reciters they play
// alongside them (or ones like them to discover); their favourites and work
// they haven't heard yet alternate. Made once a day, so a mix doesn't change
// while it plays; a new set comes the next day.
const MIX_COLORS = ['#22D3EE', '#F5E142', '#FF7EB6', '#8BE36B', '#FFA552', '#B79CFF'];
const mixColor = (n) => MIX_COLORS[(n - 1) % MIX_COLORS.length];
const mixTitle = (m) => `الميكس اليومي ${m.number}`;
// "علي بوحجو وسيد سلام الحسيني وحسين فيصل والمزيد"
const mixReciters = (m) => m.reciters.slice(0, 3).join(' و') + (m.reciters.length > 3 ? ' والمزيد' : '');
const mixTracks = (m) => visible(m.tracks.map((id) => trackById.get(id)).filter(Boolean));

// The mix's cover: the lead reciter's photo, the app's S in a corner, the coloured band with its name
function mixCoverHtml(m, width = 320) {
  return `<div class="art mix-cover"><img src="${esc(thumb(reciterPhoto(m.lead), width))}" alt="" loading="lazy" />
    ${sLogo('mix-logo')}<span class="mix-band" style="background:${mixColor(m.number)}">${esc(mixTitle(m))}</span></div>`;
}

function buildMixes(day, max = 6, size = 50) {
  const w = taste();
  if (!w.size) return [];
  const heard = new Set(lib.history.map((h) => h.id));
  // Who they play together: reciters heard within a few tracks of each other
  const names = lib.history.map((h) => trackById.get(h.id)?.reciterName).filter((n) => n && n !== UNKNOWN_RECITER);
  const near = new Map();
  const bump = (a, b) => { if (!near.has(a)) near.set(a, new Map()); near.get(a).set(b, (near.get(a).get(b) || 0) + 1); };
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j <= Math.min(i + 4, names.length - 1); j++) {
      if (names[i] !== names[j]) { bump(names[i], names[j]); bump(names[j], names[i]); }
    }
  }
  const leads = topKeys(w, max * 2).filter((name) => visible(tracksOf(name)).length >= 5).slice(0, max);
  const used = new Set();
  const mixes = [];
  leads.forEach((lead, i) => {
    // Up to three with them: the reciters they play with this one, then ones like them
    const score = (n) => (near.get(lead)?.get(n) || 0) * 2 + (w.get(n) || 0);
    const together = [...w.keys()].filter((n) => n !== lead && !leads.includes(n) && tracksOf(n).length).sort((a, b) => score(b) - score(a)).slice(0, 3);
    const top = topTrackOf(lead);
    const alike = top ? seededShuffle(
      [...new Set(similarTo(top, 200, { others: true }).map((t) => t.reciterName))].filter((n) => n !== UNKNOWN_RECITER && !leads.includes(n) && !together.includes(n)),
      day + i,
    ) : [];
    const members = [lead, ...[...together, ...alike].slice(0, 3)];
    // Each one's favourites and unheard work, alternating, in a new order each day
    const pools = members.map((name, k) => {
      const all = tracksOf(name).filter((t) => !used.has(t.id) && !lib.hidden.has(t.id));
      const known = all.filter((t) => lib.likes.has(t.id) || heard.has(t.id));
      const fresh = all.filter((t) => !lib.likes.has(t.id) && !heard.has(t.id)).sort((a, b) => b.listens - a.listens).slice(0, 30);
      return interleave(seededShuffle(known, day + i * 10 + k), seededShuffle(fresh, day * 7 + i * 10 + k), 1);
    });
    // Two of the lead's, then one of each of the others, and again
    const out = [];
    while (out.length < size && pools.some((p) => p.length)) {
      pools.forEach((pool, k) => {
        for (let r = 0; r < (k === 0 ? 2 : 1); r++) if (out.length < size && pool.length) out.push(pool.shift());
      });
    }
    if (out.length >= 8) {
      out.forEach((t) => used.add(t.id));
      mixes.push({ number: mixes.length + 1, lead, reciters: members.filter((m) => out.some((t) => t.reciterName === m)), tracks: out.map((t) => t.id) });
    }
  });
  return mixes;
}

let savedMixes = store.get('sawt_mixes', null); // { day, mixes }: today's, once made from the whole library
let mixMemo = null;
function dailyMixes() {
  const day = todaySeed();
  if (savedMixes?.day === day && savedMixes.mixes?.length) return savedMixes.mixes;
  if (!allTracks.length) return [];
  const key = `${day}|${dataVersion}|${libVersion}|${lib.history.length}`;
  if (mixMemo?.key !== key) {
    const mixes = buildMixes(day);
    if (mixes.length && fullyLoaded) {
      savedMixes = { day, mixes };
      store.set('sawt_mixes', savedMixes);
    }
    mixMemo = { key, mixes };
  }
  return mixMemo.mixes;
}

// ─── Song radio: the track, then its reciter's best work mixed with similar
// tracks by other reciters (the ones they like first, three each at most) ───
function radioOf(seed, n = 50) {
  const own = seededShuffle(visible(tracksOf(seed.reciterName)).filter((t) => t.id !== seed.id).sort((a, b) => b.listens - a.listens).slice(0, 25), Number(seed.id) || 1);
  const liked = taste();
  const each = new Map();
  const others = visible(similarTo(seed, 120, { others: true }))
    .filter((t) => t.reciterName !== UNKNOWN_RECITER && (each.set(t.reciterName, (each.get(t.reciterName) || 0) + 1).get(t.reciterName) <= 3))
    .sort((a, b) => (liked.get(b.reciterName) || 0) - (liked.get(a.reciterName) || 0));
  return uniqueById([seed, ...interleave(own, others, 1)]).slice(0, n);
}

// The reciters of a list, the most present first
function recitersOfList(list) {
  const count = new Map();
  list.forEach((t) => { if (t.reciterName !== UNKNOWN_RECITER) count.set(t.reciterName, (count.get(t.reciterName) || 0) + 1); });
  return topKeys(count, count.size);
}
// "حسين خميس، محمد الخياط، يوسف العاملي والمزيد"
const withMore = (names, shown = 3) => names.slice(0, shown).join('، ') + (names.length > shown ? ' والمزيد' : '');

// "37 دقيقة", "1 س و 12 د": a list's length, as Spotify shows it
function totalDuration(list) {
  const secs = list.reduce((sum, t) => sum + (t.duration ? t.duration.split(':').reduce((a, p) => a * 60 + Number(p), 0) : 0), 0);
  const min = Math.floor(secs / 60);
  return min >= 60 ? `${Math.floor(min / 60)} س و ${min % 60} د` : `${min} دقيقة`;
}
// "46.1 ألف", "1.2 مليون": a big count, short (Spotify's monthly listeners)
const oneDecimal = (x) => x.toFixed(1).replace(/\.0$/, '');
const compactCount = (n) => (n >= 1e6 ? `${oneDecimal(n / 1e6)} مليون` : n >= 1e4 ? `${oneDecimal(n / 1e3)} ألف` : formatCount(n));

// ═══ Navigation ══════════════════════════════════════════════════════════════
// Tabs are the four bottom-bar screens. Pages (reciter, category, track, list)
// and overlays (player, sheets, modals) go on a stack mirrored in browser
// history, so the phone's back button closes / goes back one step.
const TABS = { home: 'home-view', search: 'search-view', library: 'library-view', downloads: 'downloads-view', profile: 'profile-view' };
let currentTab = 'home';
let navStack = [];
let ignorePops = 0;
let afterPop = null;
// While a tab switch rewinds history, new pages/overlays wait for it to finish
let rewinding = false;
let waiting = [];
// Back returns to where the listener was: each page remembers its scroll, and
// is only redrawn if its view was reused since or the library changed
let dataVersion = 0;     // bumped when tracks load (first screen, then the whole library)
let libVersion = 0;      // bumped when likes, playlists, downloads or follows change
let tabScroll = 0;       // the tab's scroll when a page was opened over it
const viewShows = {};    // view id → the page entry whose content it holds
const tabDrawnAt = {};   // tab → what it was drawn from (see tabStamp)
const tabStamp = () => `${dataVersion}|${libVersion}|${lib.history[0]?.id || ''}|${recentPlayed[0]?.kind}:${recentPlayed[0]?.id}`;
const pageStamp = (e) => `${dataVersion}|${e.library ? libVersion : ''}`;
const mainEl = () => document.querySelector('.main-container');
const topPage = () => [...navStack].reverse().find((e) => e.type === 'page');

// Pages with a picture or a colour of their own across the top don't take the gold glow
const OWN_TOP = new Set(['category-view', 'track-detail-view', 'page-view']);

function showView(viewId, scrollTop = 0) {
  document.querySelectorAll('.view').forEach((v) => { v.style.display = v.id === viewId ? 'block' : 'none'; });
  document.querySelector('.top-gradient').style.display = OWN_TOP.has(viewId) ? 'none' : '';
  mainEl().scrollTo(0, scrollTop);
  startPageScroll(viewId);
  if (viewId === 'home-view') paintHomeBar();
}

// ─── Pages drawn from code (reciter, radio, daily mix) ───
// Each says what happens as it scrolls (its photo moving, its bar coming
// down); the bar is one for all of them, fixed at the top of the screen
const viewScroll = {};     // view id → the page's scroll handler
let onPageScroll = null;
let scrollFrame = 0;
function startPageScroll(viewId) {
  onPageScroll = viewScroll[viewId] || null;
  $('page-bar').classList.remove('show');
  onPageScroll?.(mainEl().scrollTop, true);
}
mainEl().addEventListener('scroll', () => {
  if (!onPageScroll || scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; onPageScroll?.(mainEl().scrollTop, false); });
}, { passive: true });

// The bar: `title` on `color()`, shown once the page has scrolled past `at()`;
// `play`: a play button for the page's list at its end
function pageScroller({ title, color, at, play = null, extra = null }) {
  const bar = $('page-bar');
  const handler = (top, init) => {
    if (init) {
      bar.querySelector('.page-bar-title').textContent = title;
      bar.style.background = color();
      bar.querySelector('.page-bar-end').replaceChildren(...(play ? [play()] : []));
    }
    const show = top > at();
    if (show !== bar.classList.contains('show')) {
      bar.classList.toggle('show', show);
      bar.setAttribute('aria-hidden', String(!show));
    }
    extra?.(top);
  };
  handler.recolor = () => { if (onPageScroll === handler) bar.style.background = color(); };
  return handler;
}

function drawPage(entry) {
  entry.render();
  entry.drawn = pageStamp(entry);
  viewShows[entry.viewId] = entry;
  // Redrawn while on screen (a like, a follow): its scroll handler is a new one
  if ($(entry.viewId).style.display === 'block') startPageScroll(entry.viewId);
}

// `library`: the page shows the listener's own things (likes, a playlist, a
// track's like/download state) and is redrawn as soon as they change
function openPage(viewId, render, { library = false } = {}) {
  if (rewinding) { waiting.push(() => openPage(viewId, render, { library })); return; }
  const from = topPage();
  if (from) from.scrollTop = mainEl().scrollTop; else tabScroll = mainEl().scrollTop;
  const entry = { type: 'page', viewId, render, library };
  drawPage(entry);
  showView(viewId);
  navStack.push(entry);
  history.pushState({ depth: navStack.length }, '');
}

function openOverlay(show, hide) {
  if (rewinding) { waiting.push(() => openOverlay(show, hide)); return; }
  show();
  navStack.push({ type: 'overlay', hide });
  history.pushState({ depth: navStack.length }, '');
}

// Close the top overlay, then run fn (e.g. open the next sheet)
function closeOverlayThen(fn) {
  afterPop = fn;
  history.back();
}

window.addEventListener('popstate', () => {
  if (ignorePops > 0) {
    ignorePops--;
    if (!ignorePops) {
      rewinding = false;
      const queued = waiting;
      waiting = [];
      queued.forEach((fn) => fn());
    }
    return;
  }
  // An entry left over from before a reload (this session starts from a clean
  // one, see Boot): step over it instead of a back press that does nothing
  if (!navStack.length && history.state?.depth) { history.back(); return; }
  const top = navStack.pop();
  if (top?.type === 'overlay') {
    top.hide();
  } else if (top?.type === 'page') {
    const prev = topPage();
    if (prev) {
      if (viewShows[prev.viewId] !== prev || prev.drawn !== pageStamp(prev)) drawPage(prev);
      showView(prev.viewId, prev.scrollTop || 0);
    } else {
      if (tabDrawnAt[currentTab] !== tabStamp()) renderTab();
      showView(TABS[currentTab], tabScroll);
    }
  }
  if (afterPop) { const fn = afterPop; afterPop = null; fn(); }
});

function goTab(tab) {
  // Leave any open pages/overlays behind in one step
  navStack.filter((e) => e.type === 'overlay').forEach((e) => e.hide());
  if (navStack.length && !rewinding) {
    ignorePops = 1;
    rewinding = true;
    history.go(-navStack.length);
    navStack = [];
  }
  currentTab = tab;
  showView(TABS[tab]);
  // The bar holds home, search, the library and the downloads (the profile opens from the avatar);
  // the open tab's icon is lit, the library's filled as on Spotify
  document.querySelectorAll('.nav-item').forEach((n, i) => {
    const open = Object.keys(TABS)[i] === tab;
    n.classList.toggle('active', open);
    const ic = n.querySelector('.ic');
    if (ic.dataset.icon === 'library') setIcon(ic, 'library', { fill: open });
  });
}

window.goHome = () => { goTab('home'); if (tabDrawnAt.home !== tabStamp()) renderHome(); };
window.goSearch = () => { goTab('search'); renderTab(); };
window.goLibrary = () => { goTab('library'); renderTab(); };
window.goProfile = () => { goTab('profile'); renderTab(); };

function renderTab() {
  if (currentTab === 'home') renderHome();
  else if (currentTab === 'library') renderLibrary();
  else if (currentTab === 'search') renderSearchHome();
  else if (currentTab === 'downloads') renderDownloadsTab();
  else if (currentTab === 'profile') updateProfileUI();
  tabDrawnAt[currentTab] = tabStamp();
}

function refreshOpenViews() {
  const top = topPage();
  if (top) drawPage(top); else renderTab();
}

// After a like, playlist, download or follow change: redraw the screens that
// list them (a long list elsewhere keeps its place; it's redrawn on return)
function libraryChanged() {
  libVersion++;
  const top = topPage();
  if (top?.library) drawPage(top);
  else if (!top && ['library', 'downloads', 'profile'].includes(currentTab)) renderTab();
}

// ═══ Shared list rendering ═══════════════════════════════════════════════════
// Track rows: tap plays the list from that row; ⋮ opens the options sheet.
// Long lists render in chunks as you scroll.
// `source`: what the list is (a reciter, a playlist...) for "recently played";
// `subtitle`: the line under the title; `likedMark`: a gold check on liked
// tracks; `playList`: the whole list a row plays from, when `list` is its start
function renderTrackList(container, list, { numbered = false, emptyText = 'لا توجد مقاطع هنا بعد', playlist = null, source = null, subtitle = null, likedMark = false, playList = null } = {}) {
  container._io?.disconnect(); // the previous drawing's "load more" watcher
  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = `<div class="empty-state">${esc(emptyText)}</div>`;
    return;
  }
  let shown = 0;
  const addChunk = () => {
    const frag = document.createDocumentFragment();
    list.slice(shown, shown + 60).forEach((track, i) => {
      const index = shown + i;
      const el = document.createElement('div');
      el.className = 'track-item';
      el.dataset.trackId = track.id;
      const meta = subtitle ? esc(subtitle(track)) : [esc(track.reciterName), track.duration && `<span dir="ltr">${track.duration}</span>`].filter(Boolean).join(' • ');
      el.innerHTML = `
        ${numbered ? `<div class="track-number">${index + 1}</div>` : ''}
        <img src="${esc(thumb(track.coverImage, 50))}" class="track-img" alt="" loading="lazy" />
        <div class="track-info">
          <div class="track-title">${esc(track.title)}</div>
          <div class="track-artist">${meta}</div>
        </div>
        ${likedMark && lib.likes.has(track.id) ? `<span class="liked-mark" aria-label="في المفضلة">${icon('tick')}</span>` : ''}
        <button class="icon-btn row-more" aria-label="خيارات">${icon('more')}</button>`;
      clickable(el, () => playFromList(playList || list, index, { source }));
      el.querySelector('.row-more').onclick = (e) => { e.stopPropagation(); openTrackOptions(track, { playlist }); };
      frag.appendChild(el);
    });
    shown += 60;
    container.appendChild(frag);
    markPlayingRows();
    if (shown < list.length) {
      const sentinel = document.createElement('div');
      sentinel.className = 'list-sentinel';
      container.appendChild(sentinel);
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); sentinel.remove(); addChunk(); }
      }, { root: mainEl(), rootMargin: '600px' });
      io.observe(sentinel);
      container._io = io;
    }
  };
  addChunk();
}

function markPlayingRows() {
  document.querySelectorAll('.track-item').forEach((el) => el.classList.toggle('playing', !!currentTrack && el.dataset.trackId === currentTrack.id));
}

const sectionTitle = (text, onMore) => {
  const head = document.createElement('div');
  head.className = 'section-head';
  head.innerHTML = `<h2 class="section-title">${esc(text)}</h2>${onMore ? '<button class="link-btn">عرض الكل</button>' : ''}`;
  if (onMore) head.querySelector('button').onclick = onMore;
  return head;
};

function squareCard(track, onClick) {
  const card = document.createElement('div');
  card.className = 'square-card';
  card.innerHTML = `
    <img src="${esc(thumb(track.coverImage, 160))}" alt="" class="square-cover" loading="lazy" />
    <div class="square-title">${esc(track.title)}</div>
    <div class="square-subtitle">${esc(track.reciterName)}</div>`;
  return clickable(card, onClick || (() => openTrackDetail(track)));
}

function reciterCard(r) {
  const card = document.createElement('div');
  card.className = 'square-card';
  card.innerHTML = `
    <img src="${esc(thumb(r.image, 160))}" alt="" class="square-cover round" loading="lazy" />
    <div class="square-title" style="text-align: center;">${esc(r.name)}</div>
    <div class="square-subtitle" style="text-align: center;">${formatCount(r.count)} مقطع</div>`;
  return clickable(card, () => openArtistDetail(r.name));
}

function scroller(items, make) {
  const row = document.createElement('div');
  row.className = 'horizontal-scroller';
  items.forEach((it) => row.appendChild(make(it)));
  return row;
}

function section(title, content, onMore) {
  const s = document.createElement('div');
  s.className = 'section animate-in';
  s.appendChild(sectionTitle(title, onMore));
  s.appendChild(content);
  return s;
}

// ═══ Home ════════════════════════════════════════════════════════════════════
function showLoading() {
  $('sections-container').innerHTML = `<div class="loading">${icon('spinner')}</div>`;
}

function greeting() {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? 'صباح الخير' : h >= 12 && h < 18 ? 'مساء الخير' : 'طاب مساؤك';
}

function renderHome() {
  const container = $('sections-container');
  if (!allTracks.length) return;
  container.innerHTML = '';
  tabDrawnAt.home = tabStamp();
  $('home-greeting').textContent = greeting();
  renderHomeBar();

  // A category chosen in the top bar: its own home
  const chosen = CATEGORIES.find((c) => c.id === homeFilter);
  if (chosen) { renderCategoryHome(container, chosen); return; }

  const recent = historyTracks();
  const liked = likedTracks();
  // What they played from (a reciter, a playlist, the likes, a radio, a track...), newest first
  const recents = recentEntries(20);

  const newest = allTracks.slice(0, 15);
  const popularShown = popularTracks.slice(0, 25);
  const topReciters = reciters.filter((r) => r.count > 0).sort((a, b) => (b.hasPhoto - a.hasPhoto) || (b.count - a.count)).slice(0, 12);
  const returning = recent.length > 0 || lib.likes.size > 0 || lib.follows.size > 0;
  const w = taste();

  const sections = {
    // Quick grid (Spotify's, six cards): what they played from last, each
    // opening its page; otherwise the newest
    quick: () => {
      const quick = recents.length >= 4 ? recents.slice(0, 6)
        : allTracks.slice(0, 6).map((t) => ({ title: t.title, art: { cover: t.coverImage }, open: () => openTrackDetail(t) }));
      const grid = document.createElement('div');
      grid.className = 'recent-grid section animate-in';
      quick.forEach((e) => {
        const card = document.createElement('div');
        card.className = 'recent-card';
        card.innerHTML = `${artHtml(e.art, { small: true, width: 56 })}<div class="recent-title">${esc(e.title)}</div>`;
        grid.appendChild(clickable(card, e.open));
      });
      return grid;
    },

    // The hijri year's occasion today (or coming), and Thursday night / Friday
    occasion: occasionSection,
    friday: fridaySection,

    // Made for you: Spotify's daily mixes, from their taste (what they play,
    // like and follow); before there is enough for a mix, tracks picked for them
    mixes: () => {
      const mixes = dailyMixes();
      if (mixes.length) return section('مصممة من أجلك', scroller(mixes, mixCard));
      const picks = madeForYou(15);
      return picks.length >= 3 ? section('مصممة من أجلك', scroller(picks, (t) => squareCard(t))) : null;
    },

    // Recently played (Spotify's): tracks, reciters, playlists, the likes,
    // radios, mixes; each opens its own page instead of playing at once
    recents: () => (recents.length ? section('تم الاستماع إليه مؤخراً', recentColumns(recents), () => openListPage('تم الاستماع إليه مؤخراً', recent)) : null),

    followed: followedSection,

    // Newest uploads
    newest: () => section('مضاف حديثاً', scroller(newest, wideCard), () => openListPage('مضاف حديثاً', allTracks.slice(0, 100))),

    radios: () => radiosSection(w, topReciters, returning),

    // Liked or played often, not lately (other than the likes shown below)
    return: () => returnSection(new Set(liked.slice(0, 15).map((t) => t.id))),

    // Your likes
    likes: () => (liked.length ? section('استمع للقصائد التي أحببتها', scroller(liked.slice(0, 15), (t) => squareCard(t)), () => openLikesPage()) : null),

    similar: () => similarRecitersSection(w),

    // Most listened (real listen counts)
    popular: () => (popularShown.length ? section('الأكثر استماعاً', columnsScroller(popularShown), () => openListPage('الأكثر استماعاً', popularTracks)) : null),

    short: shortSection,

    // More from their favourite reciter (from their taste), or the most popular one
    more: () => {
      const focus = reciterByName.get(topKeys(w, 1)[0]) || topReciters[0];
      if (!focus) return null;
      const more = visible([...tracksOf(focus.name)]).sort((a, b) => b.listens - a.listens).slice(0, 15);
      return more.length >= 3 ? section(`المزيد من ${focus.name}`, scroller(more, (t) => squareCard(t)), () => openArtistDetail(focus.name)) : null;
    },

    // Top reciters (with a real photo first)
    reciters: () => section('أشهر الرواديد', scroller(topReciters, reciterCard), () => openAllReciters()),

    // Today's picks: the same all day, from the most listened, other than what
    // the newest and the most listened above already show
    daily: () => {
      const shown = new Set([...newest, ...popularShown].map((t) => t.id));
      const pool = [...allTracks].sort((a, b) => b.listens - a.listens).slice(0, 300).filter((t) => !shown.has(t.id));
      const daily = seededShuffle(visible(pool), todaySeed()).slice(0, 15);
      return daily.length >= 3 ? section('توصياتنا لك اليوم', scroller(daily, (t) => squareCard(t))) : null;
    },
  };

  // What is theirs first for a listener who has played, liked or followed;
  // for a new one, what is new and most listened first
  const order = returning
    ? ['quick', 'occasion', 'friday', 'mixes', 'recents', 'followed', 'newest', 'radios', 'return', 'likes', 'similar', 'popular', 'short', 'more', 'reciters', 'daily']
    : ['quick', 'occasion', 'friday', 'newest', 'reciters', 'popular', 'radios', 'short', 'daily', 'more'];
  order.forEach((key) => {
    const el = sections[key]();
    if (el) { el.dataset.home = key; container.appendChild(el); }
  });
}

// ═══ The home screen's newer sections (the phone app's have the same rules) ═══

// ─── The hijri year's occasions ───
// What an occasion plays (mourning, joy or prayer), from which categories, on which colours
const OCCASION_KINDS = {
  mourning: { cats: ['naei', 'hussainiya'], colors: ['#4A0E17', '#16090B'] },
  hussaini: { cats: ['hussainiya', 'naei'], colors: ['#5C1010', '#120708'] },
  joy: { cats: ['muwalid', 'nasheed'], colors: ['#0E5A3A', '#6E5414'] },
  prayer: { cats: ['dua', 'ziyarat'], colors: ['#123068', '#0A1530'] },
};
// Month 1 = Muharram. A season (the first nights of Muharram, Ramadan...) only
// counts on its own days; a day of its own also counts the day after, as the
// new moon is often seen a day later than the calendar says
const OCCASIONS = (() => {
  const day = (month, d, title, kind, ...words) => ({ month, from: d, to: d, title, kind, words });
  const days = (month, from, to, title, kind, ...words) => ({ month, from, to, title, kind, words });
  const season = (month, from, to, title, kind, ...words) => ({ month, from, to, title, kind, words, season: true });
  return [
    day(1, 10, 'يوم عاشوراء', 'hussaini', 'عاشوراء', 'الحسين', 'حسين', 'كربلاء', 'الطف'),
    season(1, 1, 13, 'ليالي محرم الحرام', 'hussaini', 'محرم', 'عاشوراء', 'الحسين', 'حسين', 'العباس', 'كربلاء'),
    day(1, 25, 'شهادة الإمام زين العابدين (ع)', 'mourning', 'السجاد', 'زين العابدين'),
    day(2, 20, 'أربعين الإمام الحسين (ع)', 'hussaini', 'الأربعين', 'اربعين', 'الحسين', 'حسين', 'كربلاء'),
    season(2, 13, 19, 'على طريق الأربعين', 'hussaini', 'الأربعين', 'اربعين', 'المشاية', 'مشاية', 'زوار', 'الحسين'),
    day(2, 28, 'وفاة النبي (ص) وشهادة الإمام الحسن (ع)', 'mourning', 'النبي', 'الرسول', 'المصطفى', 'الحسن', 'المجتبى'),
    days(2, 29, 30, 'شهادة الإمام الرضا (ع)', 'mourning', 'الرضا', 'غريب طوس'),
    day(3, 8, 'شهادة الإمام العسكري (ع)', 'mourning', 'العسكري'),
    day(3, 17, 'مولد النبي الأكرم (ص) والإمام الصادق (ع)', 'joy', 'النبي', 'الرسول', 'المصطفى', 'محمد', 'الصادق'),
    day(4, 8, 'مولد الإمام العسكري (ع)', 'joy', 'العسكري'),
    day(5, 5, 'مولد السيدة زينب (ع)', 'joy', 'زينب'),
    day(5, 13, 'الأيام الفاطمية', 'mourning', 'الزهراء', 'فاطمة', 'فاطمية', 'الفاطمية'),
    day(6, 3, 'شهادة السيدة الزهراء (ع)', 'mourning', 'الزهراء', 'فاطمة', 'فاطمية', 'الفاطمية'),
    day(6, 20, 'مولد السيدة الزهراء (ع)', 'joy', 'الزهراء', 'فاطمة'),
    day(7, 1, 'مولد الإمام الباقر (ع)', 'joy', 'الباقر'),
    day(7, 3, 'شهادة الإمام الهادي (ع)', 'mourning', 'الهادي'),
    day(7, 10, 'مولد الإمام الجواد (ع)', 'joy', 'الجواد'),
    day(7, 13, 'مولد أمير المؤمنين (ع)', 'joy', 'علي', 'أمير المؤمنين', 'حيدر', 'الكرار', 'الغدير'),
    day(7, 15, 'وفاة السيدة زينب (ع)', 'mourning', 'زينب'),
    day(7, 25, 'شهادة الإمام الكاظم (ع)', 'mourning', 'الكاظم', 'موسى بن جعفر'),
    day(7, 27, 'المبعث النبوي الشريف', 'joy', 'المبعث', 'النبي', 'الرسول', 'المصطفى', 'محمد'),
    day(8, 3, 'مولد الإمام الحسين (ع)', 'joy', 'الحسين', 'حسين'),
    day(8, 4, 'مولد أبي الفضل العباس (ع)', 'joy', 'العباس', 'أبو الفضل', 'ابا الفضل', 'أبي الفضل'),
    day(8, 5, 'مولد الإمام زين العابدين (ع)', 'joy', 'السجاد', 'زين العابدين'),
    day(8, 11, 'مولد علي الأكبر (ع)', 'joy', 'الأكبر'),
    day(8, 15, 'مولد الإمام المهدي (عج)', 'joy', 'المهدي', 'الحجة', 'صاحب الزمان', 'المنتظر', 'القائم'),
    day(9, 10, 'وفاة السيدة خديجة (ع)', 'mourning', 'خديجة'),
    day(9, 15, 'مولد الإمام الحسن المجتبى (ع)', 'joy', 'الحسن', 'المجتبى'),
    day(9, 21, 'شهادة أمير المؤمنين (ع)', 'mourning', 'علي', 'أمير المؤمنين', 'حيدر', 'الكوفة', 'المحراب'),
    season(9, 19, 23, 'ليالي القدر', 'prayer', 'القدر', 'الجوشن', 'علي', 'أمير المؤمنين'),
    season(9, 1, 30, 'شهر رمضان المبارك', 'prayer', 'رمضان', 'الافتتاح', 'السحر', 'أبو حمزة', 'الجوشن'),
    day(10, 1, 'عيد الفطر المبارك', 'joy', 'العيد', 'عيد', 'الفطر'),
    day(10, 25, 'شهادة الإمام الصادق (ع)', 'mourning', 'الصادق'),
    day(11, 1, 'مولد السيدة المعصومة (ع)', 'joy', 'المعصومة'),
    day(11, 11, 'مولد الإمام الرضا (ع)', 'joy', 'الرضا'),
    days(11, 29, 30, 'شهادة الإمام الجواد (ع)', 'mourning', 'الجواد'),
    day(12, 7, 'شهادة الإمام الباقر (ع)', 'mourning', 'الباقر'),
    day(12, 9, 'يوم عرفة', 'prayer', 'عرفة', 'عرفه'),
    day(12, 10, 'عيد الأضحى المبارك', 'joy', 'العيد', 'عيد', 'الأضحى'),
    day(12, 15, 'مولد الإمام الهادي (ع)', 'joy', 'الهادي'),
    day(12, 18, 'عيد الغدير الأغر', 'joy', 'الغدير', 'علي', 'أمير المؤمنين', 'حيدر'),
    day(12, 24, 'يوم المباهلة', 'joy', 'المباهلة', 'أهل البيت', 'الكساء'),
  ];
})();
const HIJRI_MONTHS = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
const hijriText = (d) => `${d.day} ${HIJRI_MONTHS[d.month - 1]}`;

// The hijri date (Umm al-Qura) at `ms`, in the listener's time zone; null
// where the browser has no such calendar
let hijriFormat;
function hijriDate(ms) {
  if (hijriFormat === undefined) {
    try {
      const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric' });
      hijriFormat = f.resolvedOptions().calendar === 'islamic-umalqura' ? f : null;
    } catch { hijriFormat = null; }
  }
  if (!hijriFormat) return null;
  const parts = hijriFormat.formatToParts(new Date(ms));
  const n = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { month: n('month'), day: n('day') };
}

const DAY_MS = 86400000;
const inOccasion = (o, d) => d.month === o.month && d.day >= o.from && d.day <= o.to;
// Today's occasion, or one coming in the next ten days: { occasion, date, inDays }
function currentOccasion(now = Date.now()) {
  const today = hijriDate(now);
  if (!today) return null;
  const yesterday = hijriDate(now - DAY_MS);
  let o = OCCASIONS.find((x) => !x.season && inOccasion(x, today));
  if (o) return { occasion: o, date: today, inDays: 0 };
  o = OCCASIONS.find((x) => !x.season && inOccasion(x, yesterday));
  if (o) return { occasion: o, date: yesterday, inDays: 0 };
  o = OCCASIONS.find((x) => x.season && inOccasion(x, today));
  if (o) return { occasion: o, date: today, inDays: 0 };
  for (let d = 1; d <= 10; d++) {
    const date = hijriDate(now + d * DAY_MS);
    o = OCCASIONS.find((x) => date.month === x.month && date.day === x.from);
    if (o) return { occasion: o, date, inDays: d };
  }
  return null;
}

// A word in a title, as a whole word: also with و ف ب ك ل يا before it, and
// "للحسين" for "الحسين"
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function wordPattern(word) {
  const w = normalize(word);
  const forms = [reEscape(w)];
  if (w.startsWith('ال') && w.length > 3) forms.push(reEscape(`ل${w.slice(2)}`));
  return new RegExp(`(?:^|[\\s\\p{P}])(?:و|ف|ب|ك|ل|يا)?(?:${forms.join('|')})(?=$|[\\s\\p{P}])`, 'u');
}

// Tracks for a time (`words` in their titles, from `categoryIds` or none), the
// most listened first; then the rest of those categories, in a new order every day
function tracksFor(categoryIds, words, n) {
  const cats = categoryIds.map((id) => CATEGORIES.find((c) => c.id === id)).filter(Boolean);
  const inCats = (t) => cats.some((c) => c.values.includes(t.category));
  const patterns = words.map(wordPattern);
  const shown = visible(allTracks);
  const matched = shown.filter((t) => (inCats(t) || !categoryOf(t)) && patterns.some((p) => p.test(normalize(t.title))))
    .sort((a, b) => b.listens - a.listens);
  const rest = seededShuffle(shown.filter(inCats).sort((a, b) => b.listens - a.listens).slice(0, 150), todaySeed());
  return uniqueById([...matched.slice(0, n), ...rest]).slice(0, n);
}

const inDaysText = (d) => (d === 1 ? 'غداً' : d === 2 ? 'بعد يومين' : `بعد ${d} أيام`);

// Today's occasion (or the next one, ten days ahead): a banner that plays it, then its tracks
function occasionSection() {
  const now = currentOccasion();
  if (!now) return null;
  const o = now.occasion;
  const kind = OCCASION_KINDS[o.kind];
  const tracks = tracksFor(kind.cats, o.words, 40);
  if (tracks.length < 3) return null;
  const banner = document.createElement('div');
  banner.className = 'occasion-banner';
  banner.style.background = `linear-gradient(135deg, ${kind.colors[0]}, ${kind.colors[1]})`;
  banner.innerHTML = `
    <div class="occasion-text">
      <div class="occasion-date">${esc(now.inDays ? `${inDaysText(now.inDays)} • ${hijriText(now.date)}` : hijriText(now.date))}</div>
      <div class="occasion-title">${esc(o.title)}</div>
      <div class="occasion-count">${formatCount(tracks.length)} مقطع لهذه المناسبة</div>
    </div>
    <div class="occasion-art">${artHtml({ covers: tracks.slice(0, 4).map((t) => t.coverImage) }, { width: 112 })}</div>`;
  banner.querySelector('.occasion-text').appendChild(playAllButton(tracks, { kind: 'occasion', id: `${o.month}-${o.from}` }));
  clickable(banner, () => openListPage(o.title, tracks));
  const content = document.createElement('div');
  content.append(banner, scroller(tracks.slice(0, 15), (t) => squareCard(t)));
  return section(now.inDays ? 'مناسبة قادمة' : 'مناسبة اليوم', content);
}

// ─── Friday night ───
// "ليلة الجمعة" from Thursday afternoon, "يوم الجمعة" on Friday; null on other days
function fridayTitle(d = new Date()) {
  if (d.getDay() === 4) return d.getHours() >= 15 ? 'ليلة الجمعة' : null;
  return d.getDay() === 5 ? 'يوم الجمعة' : null;
}
const FRIDAY_WORDS = ['كميل', 'الندبة', 'السمات', 'وارث', 'عاشوراء', 'الجامعة', 'العهد', 'الفرج', 'الجمعة'];

// On Thursday night and Friday: Kumayl, the Nudba, Warith and the rest, in short rows that play
function fridaySection() {
  const title = fridayTitle();
  if (!title) return null;
  const tracks = tracksFor(['dua', 'ziyarat'], FRIDAY_WORDS, 25);
  if (tracks.length < 5) return null;
  return noteSection(title, 'دعاء كميل وزيارة وارث وأعمال الليلة', columnsScroller(tracks), () => openListPage(title, tracks));
}

// ─── From their taste ───
// The newest tracks of the reciters they follow
function followedSection() {
  if (!lib.follows.size) return null;
  const tracks = visible(allTracks.filter((t) => lib.follows.has(t.reciterName))).slice(0, 100);
  if (!tracks.length) return null;
  return section('جديد من تتابعهم', scroller(tracks.slice(0, 15), (t) => squareCard(t)), () => openListPage('جديد من تتابعهم', tracks));
}

// A radio for each reciter they love (or the best known ones, for a new listener)
function radiosSection(w, topReciters, personal) {
  const names = (personal ? topKeys(w, 6) : []);
  const seeds = (names.length ? names : topReciters.map((r) => r.name))
    .filter((n) => n !== UNKNOWN_RECITER)
    .map((name) => {
      let best = null;
      for (const t of tracksOf(name)) if (!lib.hidden.has(t.id) && (!best || t.listens > best.listens)) best = t;
      return best && { name, t: best };
    })
    .filter(Boolean).slice(0, 6);
  if (seeds.length < 2) return null;
  return section(personal ? 'محطات راديو لك' : 'محطات الراديو', scroller(seeds, ({ name, t }) => radioCard(t, name)));
}

// Which categories they play most (as their taste in reciters, by category)
function tasteCategories() {
  const w = new Map();
  const skip = (id) => lib.excluded.has(id) || lib.hidden.has(id);
  const add = (t, v) => { const c = t && categoryOf(t); if (c) w.set(c.id, (w.get(c.id) || 0) + v); };
  lib.history.forEach((h, i) => { if (!skip(h.id)) add(trackById.get(h.id), (1 + Math.log(lib.plays[h.id] || 1)) / (1 + i / 20)); });
  lib.likes.forEach((id) => { if (!skip(id)) add(trackById.get(id), 1.5); });
  return w;
}

// Reciters they may like: the most listened in the categories they play, other
// than the ones they follow or play most; a new order every day
function similarRecitersSection(w) {
  const top = topKeys(w, 5);
  if (!top.length) return null;
  let catIds = topKeys(tasteCategories(), 2);
  if (!catIds.length) {
    const counts = new Map();
    top.flatMap((n) => tracksOf(n)).forEach((t) => { const c = categoryOf(t); if (c) counts.set(c.id, (counts.get(c.id) || 0) + 1); });
    catIds = topKeys(counts, 2);
  }
  const cats = catIds.map((id) => CATEGORIES.find((c) => c.id === id)).filter(Boolean);
  const skip = new Set([...lib.follows, ...top, UNKNOWN_RECITER]);
  const score = new Map();
  allTracks.forEach((t) => {
    if (skip.has(t.reciterName) || !cats.some((c) => c.values.includes(t.category))) return;
    score.set(t.reciterName, (score.get(t.reciterName) || 0) + t.listens + 1);
  });
  const ranked = topKeys(score, 30).map((n) => reciterByName.get(n)).filter(Boolean);
  const list = seededShuffle(ranked, todaySeed()).sort((a, b) => b.hasPhoto - a.hasPhoto).slice(0, 10);
  if (list.length < 3) return null;
  return noteSection('رواديد قد تعجبك', 'بناءً على ما تستمع إليه', scroller(list, reciterCard));
}

// Tracks to return to: liked or played more than once, but not lately (not in
// their last 30 plays), the most played first
function returnSection(skip) {
  const lately = new Set(lib.history.slice(0, 30).map((h) => h.id));
  const likes = [...lib.likes].reverse();
  const likeRank = new Map(likes.map((id, i) => [id, i]));
  const plays = lib.plays || {};
  const ids = [...new Set([...likes, ...Object.keys(plays).filter((id) => plays[id] >= 2)])];
  const tracks = ids.filter((id) => !lately.has(id) && !lib.hidden.has(id) && !skip.has(id))
    .map((id) => trackById.get(id)).filter(Boolean)
    .sort((a, b) => (plays[b.id] || 0) - (plays[a.id] || 0) || (likeRank.get(a.id) ?? 1e9) - (likeRank.get(b.id) ?? 1e9))
    .slice(0, 15);
  if (tracks.length < 4) return null;
  return noteSection('عُد إليها', 'قصائد أحببتها ولم تسمعها منذ مدة', scroller(tracks, (t) => squareCard(t)));
}

// "5:30" or "1:02:03" in seconds (0 when unknown)
const durationSec = (d) => {
  const parts = String(d || '').split(':').map(Number);
  return !d || parts.some((x) => !Number.isFinite(x)) ? 0 : parts.reduce((a, x) => a * 60 + x, 0);
};

// Short tracks (half a minute to five), the most listened, in a new order every day
function shortSection() {
  const pool = visible(allTracks).filter((t) => { const s = durationSec(t.duration); return s >= 30 && s <= 300; })
    .sort((a, b) => b.listens - a.listens).slice(0, 100);
  const tracks = seededShuffle(pool.slice(0, 60), todaySeed()).slice(0, 15);
  if (tracks.length < 6) return null;
  return noteSection('قصائد قصيرة', 'أقل من خمس دقائق', columnsScroller(tracks), () => openListPage('قصائد قصيرة', pool));
}

// A section with a small grey line over its title (Spotify's "more like...")
function noteSection(title, note, content, onMore) {
  const s = section(title, content, onMore);
  const n = document.createElement('div');
  n.className = 'section-note';
  n.textContent = note;
  s.prepend(n);
  return s;
}

// A daily mix on the home screen: its cover, then who is in it
function mixCard(m) {
  const card = document.createElement('div');
  card.className = 'square-card';
  card.innerHTML = `${mixCoverHtml(m, 160)}<div class="square-subtitle mix-names">${esc(mixReciters(m))}</div>`;
  return clickable(card, () => openMixPage(m.number));
}

// A large card: the cover, the app's mark on a white splash, and the title
// and the reciter over a dark fade
function wideCard(t) {
  const card = document.createElement('div');
  card.className = 'wide-card';
  card.innerHTML = `
    <img src="${esc(thumb(t.coverImage, 320))}" alt="" loading="lazy" />
    ${splashBadge}
    <div class="wide-card-text"><div class="ellipsis wide-title">${esc(t.title)}</div><div class="ellipsis muted">${esc(t.reciterName)}</div></div>`;
  return clickable(card, () => openTrackDetail(t));
}

// ─── The home screen's top bar (Spotify's): "all" and the categories ───
// It stays on top as the page scrolls, on the page's dark ground once the
// greeting has gone up; a category chosen turns the home screen into its own
let homeFilter = null;
function renderHomeBar() {
  const bar = $('home-bar');
  const withTracks = CATEGORIES.filter((c) => allTracks.some((t) => c.values.includes(t.category)));
  if (homeFilter && !withTracks.some((c) => c.id === homeFilter)) homeFilter = null;
  const chip = (id, label) => {
    const b = document.createElement('button');
    b.className = `filter-chip${homeFilter === id ? ' active' : ''}`;
    b.textContent = label;
    b.onclick = () => {
      homeFilter = homeFilter === id && id ? null : id;
      renderHome();
      // Back to the top of the new feed, the bar still in view
      const header = document.querySelector('#home-view .home-header');
      if (mainEl().scrollTop > header.offsetHeight) mainEl().scrollTo(0, header.offsetHeight);
    };
    return b;
  };
  bar.replaceChildren(chip(null, 'الكل'), ...withTracks.map((c) => chip(c.id, c.title)));
  bar.style.display = '';
  paintHomeBar();
}
function paintHomeBar() {
  const bar = $('home-bar');
  if (bar.style.display === 'none' || $('home-view').style.display === 'none') return;
  bar.classList.toggle('stuck', bar.getBoundingClientRect().top <= mainEl().getBoundingClientRect().top + 1);
}
let homeBarFrame = 0;
mainEl().addEventListener('scroll', () => {
  if (homeBarFrame) return;
  homeBarFrame = requestAnimationFrame(() => { homeBarFrame = 0; paintHomeBar(); });
}, { passive: true });

// A category's own home: its newest, its most listened, its reciters, today's picks from it, and all of it
function renderCategoryHome(container, cat) {
  const tracks = visible(allTracks.filter((t) => cat.values.includes(t.category)));
  if (!tracks.length) {
    container.innerHTML = '<div class="empty-state">لا توجد مقاطع في هذا التصنيف بعد</div>';
    return;
  }
  const source = { kind: 'category', id: cat.id };
  container.appendChild(section(`الأحدث في ${cat.title}`, scroller(tracks.slice(0, 15), wideCard), () => openCategoryDetail(cat)));
  const popular = [...tracks].sort((a, b) => b.listens - a.listens).slice(0, 25);
  container.appendChild(section('الأكثر استماعاً', columnsScroller(popular, source)));
  const counts = new Map();
  tracks.forEach((t) => { if (t.reciterName !== UNKNOWN_RECITER) counts.set(t.reciterName, (counts.get(t.reciterName) || 0) + 1); });
  const catReciters = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => reciterByName.get(n)).filter(Boolean).slice(0, 12);
  if (catReciters.length) container.appendChild(section(`رواديد ${cat.title}`, scroller(catReciters, reciterCard)));
  container.appendChild(section('توصيات اليوم', scroller(seededShuffle(tracks, todaySeed()).slice(0, 15), (t) => squareCard(t))));
  const all = document.createElement('div');
  all.className = 'pv-center section';
  all.innerHTML = `<button class="pill-btn">عرض كل ${esc(cat.title)}</button>`;
  all.firstElementChild.onclick = () => openCategoryDetail(cat);
  container.appendChild(all);
}

// Several short rows per column, scrolling sideways; `source`: what they are (for "recently played")
function columnsScroller(list, source = null) {
  const row = document.createElement('div');
  row.className = 'horizontal-scroller snap';
  for (let c = 0; c * 5 < list.length && c < 5; c++) {
    const col = document.createElement('div');
    col.className = 'mini-col';
    list.slice(c * 5, c * 5 + 5).forEach((t, i) => {
      const item = document.createElement('div');
      item.className = 'mini-row';
      item.innerHTML = `
        <img src="${esc(thumb(t.coverImage, 48))}" alt="" loading="lazy" />
        <div class="mini-row-text"><div class="ellipsis">${esc(t.title)}</div><div class="ellipsis muted">${esc(t.reciterName)}${t.listens ? ` • ${formatCount(t.listens)} استماع` : ''}</div></div>
        <button class="icon-btn row-more" aria-label="خيارات">${icon('more')}</button>`;
      clickable(item, () => playFromList(list, c * 5 + i, { source }));
      item.querySelector('.row-more').onclick = (e) => { e.stopPropagation(); openTrackOptions(t); };
      col.appendChild(item);
    });
    row.appendChild(col);
  }
  return row;
}

// ═══ Pages ═══════════════════════════════════════════════════════════════════
let playlistPage = null; // { title, list, playlist?, source? }

// `source`: what the list is, for "recently played" (the likes, a playlist, a reciter...)
function openListPage(title, list, playlist = null, library = false, source = null) {
  openPage('playlist-detail-view', () => renderListPage(title, typeof list === 'function' ? list() : list, playlist, source), { library });
}
const likedTracks = () => [...lib.likes].map((id) => trackById.get(id)).filter(Boolean).reverse();
// Once the whole library is in, likes of deleted tracks no longer count
const likesCount = () => (fullyLoaded ? likedTracks().length : lib.likes.size);
const playlistTracks = (pl) => pl.tracks.map((id) => trackById.get(id)).filter(Boolean);

function renderListPage(title, list, playlist, source = null) {
  playlistPage = { title, list, playlist, source };
  $('playlist-tracks').className = 'track-list';
  $('playlist-search').parentElement.style.display = 'block';
  $('playlist-title').textContent = title;
  $('playlist-subtitle').textContent = `${formatCount(list.length)} مقطع`;
  $('playlist-search').value = '';
  renderTrackList($('playlist-tracks'), list, { numbered: true, playlist, source });
  $('playlist-play-all').onclick = () => playFromList(list, 0, { shuffleStart: isShuffle, source });
  const del = $('playlist-delete-btn');
  del.style.display = playlist ? 'flex' : 'none';
  del.onclick = () => {
    if (!playlist) return;
    openConfirm({
      title: `حذف قائمة "${playlist.name}"؟`, text: 'لا يمكن التراجع عن هذا.', okText: 'حذف',
      onConfirm: async () => {
        if (!(await deletePlaylist(playlist))) return;
        toast('حُذفت القائمة');
        history.back();
      },
    });
  };
}

$('playlist-search').addEventListener('input', (e) => {
  if (!playlistPage) return;
  const q = normalize(e.target.value.trim());
  const list = q ? playlistPage.list.filter((t) => searchKey(t).includes(q)) : playlistPage.list;
  renderTrackList($('playlist-tracks'), list, { numbered: true, playlist: playlistPage.playlist, source: playlistPage.source, emptyText: 'لا توجد نتائج' });
});

function openAllReciters() {
  openPage('playlist-detail-view', () => {
    playlistPage = null;
    const withTracks = reciters.filter((r) => r.count > 0);
    $('playlist-title').textContent = 'كل الرواديد';
    $('playlist-subtitle').textContent = `${formatCount(withTracks.length)} رادود`;
    $('playlist-delete-btn').style.display = 'none';
    $('playlist-search').parentElement.style.display = 'none';
    const grid = $('playlist-tracks');
    grid.className = 'reciter-grid';
    grid.innerHTML = '';
    withTracks.forEach((r) => grid.appendChild(reciterCard(r)));
    $('playlist-play-all').onclick = () => playFromList(popularTracks, 0);
  });
}

window.openCategoryDetail = (cat) => openPage('category-view', () => renderCategory(cat));

function renderCategory(cat) {
  const list = allTracks.filter((t) => cat.values.includes(t.category));
  $('category-detail-name').textContent = cat.title;
  $('category-detail-stats').textContent = `${formatCount(list.length)} مقطع`;
  $('category-detail-image').src = thumb(list[0]?.coverImage, 400);
  $('category-view').querySelector('.hero-image').style.background = cat.color;
  const source = { kind: 'category', id: cat.id };
  renderTrackList($('category-tracks'), list, { numbered: true, source, emptyText: 'لا توجد مقاطع في هذا التصنيف بعد' });
  $('category-play-all').onclick = () => playFromList(list, 0, { shuffleStart: isShuffle, source });
}

// ─── Shared by the reciter, radio and mix pages ───
// The cover's shades now (worked out before, or a stand-in), then `apply` again
// once they are read from the cover
function withShades(t, apply) {
  const known = t.coverImage && coverShades.get(t.coverImage);
  apply(known || fallbackShades(t));
  if (!known) coverShadesFor(t).then(apply);
}

// The page's play button: plays the list (from what it was played from), or
// pauses / resumes it when it is what is playing
function playAllButton(list, source, cls = 'big-play') {
  const b = document.createElement('button');
  b.className = cls;
  b.setAttribute('aria-label', 'تشغيل');
  b.dataset.plays = '';
  b._source = source;
  b.innerHTML = icon('play', { fill: true });
  b.onclick = (e) => {
    e.stopPropagation();
    if (sameSource(queueSource, source) && currentTrack && queue.some((t) => t.id === currentTrack.id)) togglePlay();
    else playFromList(list, 0, { shuffleStart: isShuffle, source });
  };
  paintPlayButton(b);
  return b;
}
function paintPlayButton(b) {
  const on = !audio.paused && sameSource(queueSource, b._source);
  setIcon(b.querySelector('.ic'), on ? 'pause' : 'play', { fill: true });
  b.setAttribute('aria-label', on ? 'إيقاف مؤقت' : 'تشغيل');
}

// Spotify's follow button: a fixed size, so nothing beside it moves when it
// changes; filled with gold and a check once they follow
function followButton(reciter, { small = false } = {}) {
  const b = document.createElement('button');
  b.className = `follow-btn${small ? ' small' : ''}`;
  b.dataset.follow = reciter.name;
  b.onclick = (e) => { e.stopPropagation(); toggleFollow(reciter); };
  paintFollowButton(b);
  return b;
}

// Three faces in circles: the biggest in the middle, the others behind it on either side
const facesHtml = (urls) => `<div class="faces">${[urls[1], urls[2], urls[0]].map((u, i) => (u !== undefined
  ? `<img class="face ${['left', 'right', 'big'][i]}" src="${esc(thumb(u, i === 2 ? 240 : 160))}" alt="" loading="lazy" />` : '')).join('')}</div>`;
const facesOf = (names, list) => names.slice(0, 3).map((n) => reciterByName.get(n)?.image || list.find((t) => t.reciterName === n)?.coverImage || '');

// A radio to discover: its light colour and faces, "<track> الراديو", who is
// in it. `label`: a reciter's radio, their name across the card instead
function radioCard(t, label = null) {
  const radio = radioOf(t, 20);
  const names = recitersOfList(radio);
  const card = document.createElement('div');
  card.className = 'radio-card';
  card.innerHTML = `
    <div class="radio-art">${facesHtml(facesOf(names, radio))}
      ${label ? `<span class="radio-tag">راديو</span><span class="radio-label ellipsis">${esc(label)}</span>` : '<span class="radio-word">الراديو</span>'}
    </div>
    ${label ? '' : `<div class="radio-card-title">${esc(t.title)} الراديو</div>`}
    <div class="square-subtitle">${esc(label ? withMore(names.filter((n) => n !== label), 3) : `مع ${withMore(names, 2)}`)}</div>`;
  withShades(t, (sh) => { card.querySelector('.radio-art').style.background = sh.pastel; });
  return clickable(card, () => openRadioPage(t));
}

// The actions under a radio's or a mix's header: keep it in the library (as a
// playlist) or let it go, download it all, and more
function keepButton(title, list, kept) {
  const b = document.createElement('button');
  b.className = `icon-btn pv-icon${kept ? ' on' : ''}`;
  b.setAttribute('aria-label', kept ? 'في مكتبتك' : 'حفظ في مكتبتك');
  b.innerHTML = icon(kept ? 'check' : 'circle-plus');
  b.onclick = async () => {
    if (kept) { if (await deletePlaylist(kept)) toast('أُزيل من مكتبتك'); }
    else { await createPlaylist(title, list.map((t) => t.id)); toast('حُفظ في مكتبتك'); }
  };
  return b;
}
function downloadButton(list) {
  const all = list.length > 0 && list.every((t) => lib.downloads.has(t.id));
  const b = document.createElement('button');
  b.className = `icon-btn pv-icon${all ? ' on' : ''}`;
  b.setAttribute('aria-label', all ? 'منزّل' : 'تنزيل');
  b.innerHTML = icon(all ? 'check' : 'download');
  b.onclick = () => { if (!all) { setIcon(b.querySelector('.ic'), 'spinner'); downloadAll(list); } else toast('كل المقاطع منزّلة'); };
  return b;
}
function actionsRow(start, list, source) {
  const row = document.createElement('div');
  row.className = 'pv-actions';
  const shuffle = document.createElement('button');
  shuffle.className = `icon-btn pv-icon shuffle-toggle${isShuffle ? ' on' : ''}`;
  shuffle.setAttribute('aria-label', 'تشغيل عشوائي');
  shuffle.innerHTML = icon('shuffle');
  shuffle.onclick = () => toggleShuffle();
  const spacer = document.createElement('span');
  spacer.className = 'pv-spacer';
  row.append(...start, spacer, shuffle, playAllButton(list, source));
  return row;
}
const iconButton = (name, label, onClick, cls = 'icon-btn pv-icon') => {
  const b = document.createElement('button');
  b.className = cls;
  b.setAttribute('aria-label', label);
  b.innerHTML = icon(name);
  b.onclick = onClick;
  return b;
};

// ═══ Reciter page (Spotify's artist page) ════════════════════════════════════
// The photo with the name over it, moving up slower than the page and
// darkening as it goes; listens, follow, options, shuffle and play; the
// popular tracks, the releases, "this is" and their radio, about, fans also like
const expandedReciters = new Set();
window.openArtistDetail = (name) => openPage('page-view', () => renderReciterPage(name), { library: true });

// Each drawing of the page view: a colour worked out for an earlier one is dropped
const newPageToken = (view) => (view._token = (view._token || 0) + 1);

function renderReciterPage(name) {
  const view = $('page-view');
  const token = newPageToken(view);
  const r = reciterByName.get(name) || { name, dbId: null, image: '', count: 0, hasPhoto: false };
  const newest = tracksOf(name);
  const list = [...newest].sort((a, b) => b.listens - a.listens);
  const source = { kind: 'reciter', id: name };
  const photo = r.image || list[0]?.coverImage || '';
  const listens = `${compactCount(list.reduce((sum, t) => sum + t.listens, 0))} استماع`;
  const releases = newest.slice(0, 4);
  const radioSeed = list[0];
  // Fans also like: the reciters of the same kind of work, those with a photo first
  const fans = radioSeed ? [...new Set(similarTo(radioSeed, 300, { others: true }).map((t) => t.reciterName))]
    .filter((n) => n !== UNKNOWN_RECITER && n !== name).map((n) => reciterByName.get(n)).filter(Boolean)
    .sort((a, b) => b.hasPhoto - a.hasPhoto).slice(0, 10) : [];

  view.innerHTML = `
    <div class="rc-hero">
      <div class="rc-photo"><img src="${esc(thumb(photo, 640))}" alt="" /></div>
      <div class="rc-shade"></div>
      <div class="rc-darken"></div>
      <button class="hero-back" onclick="history.back()" aria-label="رجوع">${icon('chevron-right')}</button>
      <h1 class="rc-name">${esc(name)}</h1>
    </div>
    <div class="rc-top">
      <div class="rc-listens">${esc(listens)}</div>
    </div>
    ${list.length ? `<section class="pv-section"><h2 class="sub-title">القصائد الرائجة</h2><div class="track-list rc-popular"></div>
      ${list.length > 5 ? '<div class="pv-center"><button class="pill-btn rc-toggle"></button></div>' : ''}</section>` : '<div class="empty-state">لا توجد قصائد لهذا الرادود بعد</div>'}
    ${releases.length ? `<section class="pv-section rc-releases">
      <div class="section-head"><h2 class="section-title">الإصدارات الرائجة</h2><button class="link-btn rc-releases-all">عرض الكل</button></div>
      <div class="rc-release-list"></div>
      <div class="pv-center"><button class="pill-btn rc-recordings">الانتقال إلى التسجيلات</button></div>
    </section>` : ''}
    ${radioSeed ? `<section class="pv-section"><h2 class="sub-title">تضم ${esc(name)}</h2><div class="pv-pair rc-featuring"></div></section>` : ''}
    <section class="pv-section">
      <h2 class="sub-title">معلومات تعريفية</h2>
      <div class="rc-about">
        <img src="${esc(thumb(photo, 640))}" alt="" class="rc-about-photo" loading="lazy" />
        <div class="rc-about-body">
          <div class="rc-about-head">
            <div style="min-width: 0; flex: 1;">
              <div class="rc-about-name"><span class="ellipsis">${esc(name)}</span>${r.dbId ? `<span class="verified" aria-label="رادود موثّق">${icon('tick')}</span>` : ''}</div>
              <div class="muted rc-about-listens">${esc(listens)}</div>
            </div>
            <span class="rc-about-follow"></span>
          </div>
          <p class="rc-bio"></p>
        </div>
      </div>
    </section>
    ${fans.length ? '<section class="pv-section rc-fans"><h2 class="sub-title">المعجبون يحبون أيضاً</h2></section>' : ''}`;

  // Listens, then the actions: follow, ⋮ ... shuffle, play
  const more = iconButton('more', 'خيارات', () => openReciterOptions(name), 'icon-btn rc-more');
  view.querySelector('.rc-top').appendChild(actionsRow([followButton(r), more], list, source));

  // Popular: numbered, how often each was heard, a check on the liked ones
  const paintPopular = () => {
    const open = expandedReciters.has(name);
    renderTrackList(view.querySelector('.rc-popular'), list.slice(0, open ? 10 : 5), {
      numbered: true, source, playList: list, likedMark: true, subtitle: (t) => formatCount(t.listens),
    });
    const toggle = view.querySelector('.rc-toggle');
    if (toggle) toggle.textContent = open ? 'عرض أقل' : 'عرض المزيد';
  };
  if (list.length) paintPopular();
  const toggle = view.querySelector('.rc-toggle');
  if (toggle) toggle.onclick = () => { if (!expandedReciters.delete(name)) expandedReciters.add(name); paintPopular(); };

  // Releases: the newest first ("latest release"), each with its year
  if (releases.length) {
    const box = view.querySelector('.rc-release-list');
    const paintReleases = () => box.replaceChildren(...releases.map((t, i) => {
      const year = /^\d{4}/.test(t.addedAt || '') ? t.addedAt.slice(0, 4) : '';
      const row = document.createElement('div');
      row.className = 'release-row';
      row.innerHTML = `
        <img src="${esc(thumb(t.coverImage, 84))}" alt="" loading="lazy" />
        <div style="min-width: 0; flex: 1;">
          ${i === 0 ? '<div class="muted release-latest">أحدث الإصدارات</div>' : ''}
          <div class="release-title">${esc(t.title)}</div>
          <div class="muted release-meta ellipsis">${esc([categoryOf(t)?.title || 'قصيدة', year].filter(Boolean).join(' • '))}</div>
        </div>`;
      return clickable(row, () => openTrackDetail(t));
    }));
    paintReleases();
    loadDates(releases).then(() => { if (box.isConnected) paintReleases(); });
    const all = () => openListPage(`إصدارات ${name}`, newest, null, false, source);
    view.querySelector('.rc-releases-all').onclick = all;
    view.querySelector('.rc-recordings').onclick = () => openListPage(`تسجيلات ${name}`, newest, null, false, source);
  }

  // Featuring them: "this is" (their best in one list) and their radio
  let pastel = fallbackShades({ reciterName: name }).pastel;
  if (radioSeed) {
    const thisIs = document.createElement('div');
    thisIs.className = 'radio-card';
    thisIs.innerHTML = `
      <div class="this-is">
        <div class="this-is-word">هذا هو</div>
        <div class="this-is-band"></div>
        <img src="${esc(thumb(photo, 240))}" alt="" loading="lazy" />
        <div class="this-is-name ellipsis">${esc(name)}</div>
      </div>
      <div class="square-subtitle">هذا هو ${esc(name)}. أبرز قصائده في قائمة واحدة</div>`;
    clickable(thisIs, () => openListPage(`هذا هو ${name}`, list.slice(0, 50), null, false, source));
    view.querySelector('.rc-featuring').append(thisIs, radioCard(radioSeed, name));
  }

  // About: the photo, the name, the listens, follow, and the bio
  view.querySelector('.rc-about-follow').appendChild(followButton(r));
  const bio = view.querySelector('.rc-bio');
  const paintBio = (text) => { bio.textContent = text || `قصائد ${name} على صوت الأحزان: ${formatCount(list.length)} قصيدة.`; };
  paintBio(reciterBios.get(r.dbId));
  if (r.dbId) loadReciterBio(r).then((text) => { if (text && bio.isConnected) paintBio(text); });

  if (fans.length) view.querySelector('.rc-fans').appendChild(scroller(fans, reciterCard));

  // The page's colour, from the photo: under the photo and in the bar on top
  const hero = view.querySelector('.rc-hero');
  let tint = '#121212';
  const handler = pageScroller({
    title: name,
    color: () => tint,
    at: () => hero.offsetHeight - barHeight(),
    extra: (top) => {
      const h = hero.offsetHeight || 1;
      view.querySelector('.rc-photo').style.transform = `translateY(${Math.min(top, h) * 0.5}px)`;
      view.querySelector('.rc-darken').style.opacity = String(Math.min(Math.max(top / h, 0), 1));
    },
  });
  withShades({ coverImage: photo, reciterName: name }, (sh) => {
    if (view._token !== token) return;
    tint = mixHex('#121212', sh.vivid, 0.5);
    pastel = sh.pastel;
    view.style.setProperty('--tint', tint);
    view.querySelector('.this-is-band')?.style.setProperty('background', pastel);
    handler.recolor();
  });
  viewScroll['page-view'] = handler;
}

const barHeight = () => $('page-bar').offsetHeight || 56;

// The years of a few tracks' releases, in one request
function loadDates(list) {
  const ids = list.filter((t) => t.addedAt === undefined).map((t) => Number(t.id));
  if (!ids.length) return Promise.resolve();
  return supabase.from('audio_library').select('id,created_at').in('id', ids)
    .then(({ data, error }) => {
      if (error) throw error;
      (data || []).forEach((row) => { const t = trackById.get(String(row.id)); if (t) t.addedAt = row.created_at || ''; });
    })
    .catch(() => {});
}

function openReciterOptions(name) {
  const r = reciterByName.get(name) || { name, dbId: null, image: '' };
  const tracks = [...tracksOf(name)].sort((a, b) => b.listens - a.listens);
  const following = lib.follows.has(name);
  const sheet = $('action-sheet');
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <img src="${esc(thumb(reciterPhoto(name), 55))}" alt="" style="border-radius: 50%;" />
      <div style="flex: 1; overflow: hidden;">
        <div class="ellipsis" style="font-size: 18px; font-weight: bold; margin-bottom: 4px;">${esc(name)}</div>
        <div class="muted" style="font-size: 14px;">رادود • ${formatCount(tracks.length)} مقطع</div>
      </div>
    </div>`;
  const item = (iconName, text, fn) => {
    const b = document.createElement('button');
    b.className = 'sheet-item';
    b.innerHTML = `${icon(iconName)}<span>${esc(text)}</span>`;
    b.onclick = () => closeOverlayThen(fn);
    sheet.appendChild(b);
  };
  item(following ? 'following' : 'follow', following ? 'إلغاء المتابعة' : 'متابعة', () => toggleFollow(r));
  if (tracks[0]) item('radio', 'الانتقال إلى راديو الرادود', () => openRadioPage(tracks[0]));
  item('playlist', 'عرض كل القصائد', () => openListPage(`قصائد ${name}`, tracksOf(name), null, false, { kind: 'reciter', id: name }));
  item('share-nodes', 'مشاركة', () => share(`${name} | صوت الأحزان`, `استمع إلى قصائد ${name}`, r.dbId ? `${SITE_URL}/reciter?id=${r.dbId}` : APP_URL));
  openSheet('action-modal');
}

// ═══ Radio page (Spotify's song radio) ═══════════════════════════════════════
// A light colour with the faces of its reciters, its name in big letters, who
// is in it (and who wrote it), "made for you", how long it is, the actions,
// the tracks, and more radios to discover
window.openRadioPage = (t) => openPage('page-view', () => renderRadioPage(t), { library: true });

function renderRadioPage(seed) {
  const view = $('page-view');
  const token = newPageToken(view);
  const radio = radioOf(seed, 50);
  const title = `${seed.title} الراديو`;
  const names = recitersOfList(radio);
  const source = { kind: 'radio', id: seed.id };
  const kept = lib.playlists.find((p) => p.name === title);
  // More radios: a track of each of the other reciters in this one
  const seen = new Set([seed.reciterName, UNKNOWN_RECITER]);
  const more = radio.slice(1).filter((t) => !seen.has(t.reciterName) && seen.add(t.reciterName)).slice(0, 6);

  view.innerHTML = `
    <div class="rd-top">
      <button class="pv-round-back" onclick="history.back()" aria-label="رجوع">${icon('back')}</button>
      ${facesHtml(facesOf(names, radio))}
      <h1 class="rd-title">${esc(title)}</h1>
    </div>
    <div class="pv-details rd-details">
      ${names.length ? `<div class="muted pv-line">مع ${esc(withMore(names))}</div>` : ''}
      <div class="muted pv-line rd-poets" style="display: none;"></div>
      <div class="made-for">${sLogo()} مُصمم من أجلك</div>
      <p class="pv-about"><b>حول هذا الراديو</b> مبني على «${esc(seed.title)}» لـ ${esc(seed.reciterName)}<span class="rd-seed-poet"></span>، ومرتّب حسب ذوقك.</p>
      <div class="muted pv-line">${totalDuration(radio)} • ${formatCount(radio.length)} مقطع</div>
    </div>
    <div class="pv-actions-slot"></div>
    <div class="track-list pv-list"></div>
    ${more.length >= 2 ? '<section class="pv-section"><h2 class="pv-big-title">قد يعجبك أيضاً</h2><div class="pv-grid rd-more"></div></section>' : ''}`;

  view.querySelector('.pv-actions-slot').replaceWith(actionsRow([
    keepButton(title, radio, kept), downloadButton(radio), iconButton('more', 'خيارات', () => openTrackOptions(seed)),
  ], radio, source));
  renderTrackList(view.querySelector('.pv-list'), radio, { source, likedMark: true });
  if (more.length >= 2) view.querySelector('.rd-more').append(...more.map((t) => radioCard(t)));

  // Who wrote the track it is built on, once its details are in
  loadDetails(seed).then(() => {
    const poet = seed.credits?.find((c) => c.role === 'الكلمات')?.name;
    if (!poet || view._token !== token) return;
    const line = view.querySelector('.rd-poets');
    if (line) { line.textContent = `كلمات: ${poet}`; line.style.display = ''; }
    const about = view.querySelector('.rd-seed-poet');
    if (about) about.textContent = `، كلمات ${poet}`;
  });

  const top = view.querySelector('.rd-top');
  let deep = '#121212';
  const handler = pageScroller({
    title, color: () => deep, at: () => top.offsetHeight - barHeight() * 1.4,
    play: () => playAllButton(radio, source, 'big-play small'),
  });
  withShades(seed, (sh) => {
    if (view._token !== token) return;
    deep = sh.vivid;
    view.style.setProperty('--pastel', sh.pastel);
    view.style.setProperty('--deep', sh.vivid);
    handler.recolor();
  });
  viewScroll['page-view'] = handler;
}

// ═══ Daily mix page ══════════════════════════════════════════════════════════
// Its colour, cover, who is in it, "made for you", how long it is, the
// actions and the tracks (a check on the ones they like), then their other mixes
window.openMixPage = (number) => openPage('page-view', () => renderMixPage(number), { library: true });

function renderMixPage(number) {
  const view = $('page-view');
  newPageToken(view);
  view.style.removeProperty('--tint');
  const mixes = dailyMixes();
  const mix = mixes.find((m) => m.number === number);
  if (!mix) {
    view.innerHTML = `<header class="page-header pv-plain"><button class="icon-btn" onclick="history.back()" aria-label="رجوع">${icon('back')}</button></header>
      <div class="empty-state">هذا الميكس لم يعد متوفراً، وتصلك ميكسات جديدة كل يوم</div>`;
    viewScroll['page-view'] = null;
    return;
  }
  const tracks = mixTracks(mix);
  const title = mixTitle(mix);
  const deep = mixHex(mixColor(mix.number), '#000000', 0.38);
  const source = { kind: 'mix', id: String(mix.number) };
  const others = mixes.filter((m) => m.number !== mix.number);
  view.style.setProperty('--deep', deep);
  view.innerHTML = `
    <div class="mx-top">
      <button class="icon-btn" onclick="history.back()" aria-label="رجوع">${icon('back')}</button>
      <div class="mx-cover">${mixCoverHtml(mix, 300)}</div>
      <div class="pv-details mx-details">
        <div class="muted pv-line">${esc(mixReciters(mix))}</div>
        <div class="made-for">${sLogo()} مُصممة من أجلك</div>
        <p class="pv-about"><b>حول هذا الميكس</b> يجمع ${esc(mix.lead)} ومن تستمع إليهم معه، بين ما تحبه وما لم تسمعه بعد، ويتجدد كل يوم بحسب ما تستمع إليه.</p>
        <div class="muted pv-line">${totalDuration(tracks)} • ${formatCount(tracks.length)} مقطع</div>
      </div>
    </div>
    <div class="pv-actions-slot"></div>
    <div class="track-list pv-list"></div>
    ${others.length ? '<section class="pv-section"><h2 class="pv-big-title">ميكسات أخرى من أجلك</h2><div class="pv-grid mx-others"></div></section>' : ''}`;

  view.querySelector('.pv-actions-slot').replaceWith(actionsRow([
    keepButton(title, tracks, lib.playlists.find((p) => p.name === title)), downloadButton(tracks),
    iconButton('share-nodes', 'مشاركة', () => share(`${title} | صوت الأحزان`, `${title} من صوت الأحزان: ${mixReciters(mix)}`, APP_URL)),
  ], tracks, source));
  renderTrackList(view.querySelector('.pv-list'), tracks, { source, likedMark: true });
  if (others.length) view.querySelector('.mx-others').append(...others.map(mixCard));

  const top = view.querySelector('.mx-top');
  viewScroll['page-view'] = pageScroller({
    title, color: () => deep, at: () => top.offsetHeight - barHeight() * 1.6,
    play: () => playAllButton(tracks, source, 'big-play small'),
  });
}

// ═══ Collections: the likes, the downloads, a playlist (Spotify's playlist page) ═
// The page's colour fading down from the top, the cover (four covers for a
// playlist), the title, who made it and how long it is, the actions, the chips
// (add, edit, name, sort), the tracks, and tracks suggested from them
const TRACK_SORTS = { custom: 'ترتيب مخصص', title: 'العنوان', reciter: 'الرادود', popular: 'الأكثر استماعاً' };
const collectionUi = new Map(); // the page → { sort, editing, round }
const arabicOrder = new Intl.Collator('ar');

function sortTracks(list, sort) {
  if (sort === 'title') return [...list].sort((a, b) => arabicOrder.compare(a.title, b.title));
  if (sort === 'reciter') return [...list].sort((a, b) => arabicOrder.compare(a.reciterName, b.reciterName) || arabicOrder.compare(a.title, b.title));
  if (sort === 'popular') return [...list].sort((a, b) => b.listens - a.listens);
  return list;
}

// Suggestions for a list ("based on the tracks in this playlist"): the radios
// of its first tracks, minus what it already has; `round` gives another set
function forList(list, n = 10, round = 0) {
  if (!list.length) return madeForYou(n);
  const have = new Set(list.map((t) => t.id));
  const pool = uniqueById(list.slice(0, 6).flatMap((t) => radioOf(t, 30).slice(1))).filter((t) => !have.has(t.id) && !lib.hidden.has(t.id));
  return seededShuffle(pool, list.length * 31 + round).slice(0, n);
}

const playlistText = (title, list) => `قائمة «${title}» على صوت الأحزان:\n${list.slice(0, 15).map((t) => `• ${t.title} — ${t.reciterName}`).join('\n')}`;

function renamePlaylist(pl) {
  openPrompt({
    title: 'الاسم والتفاصيل', hint: 'اسم جديد لقائمة التشغيل.', value: pl.name,
    onSubmit: async (name) => { pl.name = name; await savePlaylist(pl); toast('تم تغيير الاسم'); },
  });
}

function confirmDeletePlaylist(pl, after = null) {
  openConfirm({
    title: `حذف قائمة "${pl.name}"؟`, text: 'لا يمكن التراجع عن هذا.', okText: 'حذف',
    onConfirm: async () => {
      if (!(await deletePlaylist(pl))) return;
      toast('حُذفت القائمة');
      after?.();
    },
  });
}

window.openLikesPage = () => openPage('page-view', () => renderCollection({ kind: 'likes' }), { library: true });
window.openDownloadsPage = () => openPage('page-view', () => renderCollection({ kind: 'downloads' }), { library: true });
window.openPlaylistPage = (pl) => openPage('page-view', () => renderCollection({ kind: 'playlist', id: pl.id }), { library: true });

function renderCollection(spec) {
  const view = $('page-view');
  const token = newPageToken(view);
  const pl = spec.kind === 'playlist' ? lib.playlists.find((p) => p.id === spec.id) : null;
  if (spec.kind === 'playlist' && !pl) {
    view.innerHTML = `<header class="page-header pv-plain"><button class="icon-btn" onclick="history.back()" aria-label="رجوع">${icon('back')}</button></header>
      <div class="empty-state">هذه القائمة لم تعد موجودة</div>`;
    viewScroll['page-view'] = null;
    return;
  }
  const key = pl ? `p:${pl.id}` : spec.kind;
  if (!collectionUi.has(key)) collectionUi.set(key, { sort: 'custom', editing: false, round: 0 });
  const ui = collectionUi.get(key);
  const title = pl ? pl.name : spec.kind === 'likes' ? 'المقاطع المفضلة' : 'التنزيلات';
  const base = uniqueById(spec.kind === 'likes' ? likedTracks() : spec.kind === 'downloads' ? downloadedTracks().reverse() : playlistTracks(pl));
  const list = sortTracks(base, ui.sort);
  const source = pl ? { kind: 'playlist', id: pl.id } : { kind: spec.kind, id: '' };
  // The colour of the page, strong as Spotify's: the first cover's, gold for the likes
  let color = spec.kind === 'likes' ? '#9A7418' : spec.kind === 'downloads' ? '#5A5A5A' : '#4A4A4A';
  const cover = spec.kind === 'likes' ? artHtml({ likes: true }) : spec.kind === 'downloads' ? artHtml({ downloads: true })
    : artHtml({ covers: list.map((t) => t.coverImage) }, { width: 300 });

  view.innerHTML = `
    <div class="cl-top">
      <button class="icon-btn cl-back" onclick="history.back()" aria-label="رجوع">${icon('back')}</button>
      <div class="cl-cover">${cover}</div>
      <h1 class="cl-title">${esc(title)}</h1>
      <div class="cl-owner"><span class="cl-owner-dot">${icon('user')}</span>${spec.kind === 'downloads' ? 'على هذا الجهاز' : 'أنت'}</div>
      <div class="muted cl-meta">${icon('clock')} ${formatCount(list.length)} مقطع • ${totalDuration(list)}</div>
    </div>
    <div class="pv-actions-slot"></div>
    <div class="horizontal-scroller cl-chips"></div>
    <div class="track-list pv-list cl-list"></div>
    ${pl && base.length ? `<section class="pv-section cl-suggest">
      <div class="cl-suggest-head"><div><h2 class="pv-big-title" style="margin: 0;">المقاطع المقترحة</h2><div class="muted" style="font-size: 14px;">بناءً على المقاطع في هذه القائمة</div></div>
      <button class="link-btn cl-refresh">تحديث</button></div>
      <div class="track-list cl-suggestions"></div></section>` : ''}`;

  // Actions: download, share, the playlist's options ... shuffle, play
  const start = [];
  if (list.length) start.push(downloadButton(list));
  start.push(iconButton('share-nodes', 'مشاركة', () => share(`${title} | صوت الأحزان`, playlistText(title, list), APP_URL)));
  if (pl) start.push(iconButton('more', 'خيارات القائمة', () => openPlaylistOptions(pl)));
  view.querySelector('.pv-actions-slot').replaceWith(actionsRow(start, list, source));

  // Spotify's chips: add, edit, name and details, sort
  const chip = (iconName, text, onClick, active = false) => {
    const b = document.createElement('button');
    b.className = `page-chip${active ? ' on' : ''}`;
    b.innerHTML = `${icon(iconName)}<span>${esc(text)}</span>`;
    b.onclick = onClick;
    return b;
  };
  const chips = [];
  if (pl) {
    chips.push(chip('plus', 'إضافة', () => openAddTracks(pl)));
    chips.push(chip(ui.editing ? 'tick' : 'list', ui.editing ? 'تم' : 'تعديل', () => {
      ui.editing = !ui.editing;
      if (ui.editing) ui.sort = 'custom';
      renderCollection(spec);
    }, ui.editing));
    chips.push(chip('pencil', 'الاسم والتفاصيل', () => renamePlaylist(pl)));
  }
  chips.push(chip('sort', ui.sort === 'custom' ? 'ترتيب' : TRACK_SORTS[ui.sort], () => openChoices('ترتيب حسب', TRACK_SORTS, ui.sort, (s) => {
    ui.sort = s;
    if (s !== 'custom') ui.editing = false;
    renderCollection(spec);
  })));
  view.querySelector('.cl-chips').append(...chips);

  // The tracks; in "edit", remove and move instead of ⋮
  const box = view.querySelector('.cl-list');
  if (!list.length) {
    box.innerHTML = `<div class="empty-state">${spec.kind === 'likes' ? 'المقاطع التي تعجبك تظهر هنا. اضغط ♡ على أي مقطع.'
      : spec.kind === 'downloads' ? 'نزّل مقاطع لتسمعها بدون إنترنت.' : 'هذه القائمة فارغة. أضف إليها مقاطع.'}
      ${pl ? '<br/><button class="pill-btn" style="margin-top: 16px;">إضافة مقاطع</button>' : ''}</div>`;
    box.querySelector('button')?.addEventListener('click', () => openAddTracks(pl));
  } else if (ui.editing && pl) {
    list.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'track-item editing';
      row.innerHTML = `
        <button class="icon-btn edit-remove" aria-label="إزالة">${icon('circle-minus')}</button>
        <img src="${esc(thumb(t.coverImage, 56))}" class="track-img" alt="" loading="lazy" />
        <div class="track-info"><div class="track-title">${esc(t.title)}</div><div class="track-artist">${esc(t.reciterName)}</div></div>
        <button class="icon-btn edit-move" aria-label="تحريك للأعلى"${i === 0 ? ' disabled' : ''}>${icon('arrow-up')}</button>
        <button class="icon-btn edit-move" aria-label="تحريك للأسفل"${i === list.length - 1 ? ' disabled' : ''}>${icon('arrow-down')}</button>`;
      row.querySelector('.edit-remove').onclick = async () => {
        pl.tracks = pl.tracks.filter((id) => id !== t.id);
        await savePlaylist(pl);
        toast('أُزيل من القائمة');
      };
      const move = (step) => {
        const other = list[i + step];
        if (!other) return;
        const a = pl.tracks.indexOf(t.id);
        const b = pl.tracks.indexOf(other.id);
        if (a < 0 || b < 0) return;
        [pl.tracks[a], pl.tracks[b]] = [pl.tracks[b], pl.tracks[a]];
        savePlaylist(pl);
      };
      const [up, down] = row.querySelectorAll('.edit-move');
      up.onclick = () => move(-1);
      down.onclick = () => move(1);
      box.appendChild(row);
    });
  } else {
    renderTrackList(box, list, { source, playlist: pl, subtitle: (t) => t.reciterName });
  }

  // Suggested from the playlist's own tracks, each with (+)
  if (pl && base.length) {
    const suggestions = forList(base, 10, ui.round);
    view.querySelector('.cl-suggestions').append(...suggestions.map((t) => addableRow(t, pl)));
    view.querySelector('.cl-refresh').onclick = () => { ui.round++; renderCollection(spec); };
  }

  const top = view.querySelector('.cl-top');
  const handler = pageScroller({
    title, color: () => color, at: () => top.offsetHeight - barHeight() * 1.6,
    play: list.length ? () => playAllButton(list, source, 'big-play small') : null,
  });
  const paint = (c) => { color = c; view.style.setProperty('--deep', c); handler.recolor(); };
  if (pl && list[0]) withShades(list[0], (sh) => { if (view._token === token) paint(sh.vivid); });
  else paint(color);
  viewScroll['page-view'] = handler;
}

// A track that can be added to a playlist: (+), then ✓ once it is in
function addableRow(t, pl) {
  const row = document.createElement('div');
  row.className = 'track-item';
  row.dataset.trackId = t.id;
  const paint = () => {
    const added = pl.tracks.includes(t.id);
    const b = row.querySelector('.add-btn');
    b.classList.toggle('on', added);
    b.setAttribute('aria-label', added ? 'في القائمة' : 'إضافة');
    setIcon(b.querySelector('.ic'), added ? 'check' : 'circle-plus');
  };
  row.innerHTML = `
    <img src="${esc(thumb(t.coverImage, 56))}" class="track-img" alt="" loading="lazy" />
    <div class="track-info"><div class="track-title">${esc(t.title)}</div><div class="track-artist">${esc(t.reciterName)}</div></div>
    <button class="icon-btn add-btn pv-icon">${icon('circle-plus')}</button>`;
  paint();
  row.querySelector('.add-btn').onclick = (e) => {
    e.stopPropagation();
    if (pl.tracks.includes(t.id)) return;
    pl.tracks.push(t.id);
    paint();
    savePlaylist(pl);
    toast(`أُضيف إلى «${pl.name}»`);
  };
  return clickable(row, () => playFromList([t], 0));
}

// Spotify's "add to this playlist": search the library, or take a suggestion
function openAddTracks(pl) {
  openPage('page-view', () => {
    const view = $('page-view');
    newPageToken(view);
    view.innerHTML = `
      <header class="page-header pv-plain"><button class="icon-btn" onclick="history.back()" aria-label="رجوع">${icon('back')}</button>
        <h1 class="search-header">إضافة إلى القائمة</h1></header>
      <div class="search-input-container" style="padding: 0 16px; margin-bottom: 16px;">
        <i class="ic search-icon" data-icon="search" style="color: rgba(255,255,255,0.6); right: 32px;"></i>
        <input type="search" class="search-input dark at-input" placeholder="ابحث عن مقاطع" autocomplete="off" />
      </div>
      <h2 class="sub-title at-title" style="padding: 0 16px; margin-bottom: 12px;"></h2>
      <div class="track-list pv-list at-list"></div>`;
    const input = view.querySelector('.at-input');
    const fill = () => {
      const words = normalize(input.value.trim()).split(/\s+/).filter(Boolean);
      const inList = playlistTracks(pl);
      const shown = words.length ? allTracks.filter((t) => words.every((w) => searchKey(t).includes(w))) : forList(inList, 25);
      view.querySelector('.at-title').textContent = words.length ? `النتائج (${formatCount(shown.length)})` : 'مقترحة لك';
      const box = view.querySelector('.at-list');
      if (!shown.length) box.innerHTML = `<div class="empty-state">${words.length ? 'لم يتم العثور على نتائج' : 'استمع إلى بعض المقاطع لتظهر لك اقتراحات'}</div>`;
      else box.replaceChildren(...shown.slice(0, 150).map((t) => addableRow(t, pl)));
    };
    let timer;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(fill, 150); });
    fill();
    viewScroll['page-view'] = null;
  });
}

// A playlist's ⋮: add, rename, download, share, delete
function openPlaylistOptions(pl) {
  const tracks = playlistTracks(pl);
  const sheet = $('action-sheet');
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <div class="sheet-art">${artHtml({ covers: tracks.map((t) => t.coverImage) }, { width: 54 })}</div>
      <div style="flex: 1; overflow: hidden;">
        <div class="ellipsis" style="font-size: 18px; font-weight: bold; margin-bottom: 4px;">${esc(pl.name)}</div>
        <div class="muted" style="font-size: 14px;">قائمة تشغيل • ${formatCount(tracks.length)} مقطع</div>
      </div>
    </div>`;
  const item = (iconName, text, fn, cls = '') => sheetItem(sheet, iconName, text, () => closeOverlayThen(fn), cls);
  item('plus', 'إضافة مقاطع', () => openAddTracks(pl));
  item('pencil', 'تغيير الاسم', () => renamePlaylist(pl));
  item('download-plain', 'تنزيل القائمة', () => downloadAll(tracks));
  item('share-nodes', 'مشاركة', () => share(`${pl.name} | صوت الأحزان`, playlistText(pl.name, tracks), APP_URL));
  item('trash', 'حذف القائمة', () => confirmDeletePlaylist(pl, () => history.back()), 'danger');
  openSheet('action-modal');
}

function sheetItem(sheet, iconName, text, onClick, cls = '', trailing = '') {
  const b = document.createElement('button');
  b.className = `sheet-item ${cls}`;
  b.innerHTML = `${typeof iconName === 'string' && !iconName.startsWith('<') ? icon(iconName) : iconName}<span style="flex: 1;">${esc(text)}</span>${trailing ? `<span class="muted sheet-trailing">${esc(trailing)}</span>` : ''}`;
  b.onclick = onClick;
  sheet.appendChild(b);
  return b;
}

// A choice from a few (a sort), as a sheet with the current one checked
function openChoices(title, choices, current, onPick) {
  const sheet = $('action-sheet');
  sheet.innerHTML = `<div class="sheet-handle"></div><h2 class="modal-title" style="border: none;">${esc(title)}</h2>`;
  Object.entries(choices).forEach(([value, label]) => {
    const b = sheetItem(sheet, value === current ? 'tick' : '<span class="ic"></span>', label, () => closeOverlayThen(() => onPick(value)));
    if (value === current) b.classList.add('chosen');
  });
  openSheet('action-modal');
}

window.openTrackDetail = (trackOrId) => {
  const track = typeof trackOrId === 'object' ? trackOrId : trackById.get(String(trackOrId));
  if (track) openPage('track-detail-view', () => renderTrackDetail(track), { library: true });
};

function renderTrackDetail(track) {
  $('td-cover').src = thumb(track.coverImage, 350);
  $('td-title').textContent = track.title;
  $('td-artist').textContent = track.reciterName;
  const r = reciterOf(track);
  $('td-artist-img').src = thumb(r?.image || track.coverImage, 32);
  $('td-artist-row').onclick = () => openArtistDetail(track.reciterName);
  const cat = categoryOf(track);
  $('td-meta').innerHTML = [cat && esc(cat.title), track.duration && `<span dir="ltr">${track.duration}</span>`, `${formatCount(track.listens)} استماع`].filter(Boolean).join(' • ');

  // The lyrics and who wrote them, once the track's details are in
  const paintDetails = () => {
    $('td-lyrics-section').style.display = track.lyrics ? 'block' : 'none';
    $('td-lyrics').textContent = track.lyrics || '';
    const poet = track.credits?.find((c) => c.role === 'الكلمات')?.name;
    $('td-poet').textContent = poet ? `كلمات: ${poet}` : '';
    $('td-poet').style.display = poet ? '' : 'none';
  };
  paintDetails();
  const shown = () => $('td-play-btn').dataset.trackId === track.id;
  loadDetails(track).then(() => { if (shown()) paintDetails(); });
  // The cover's colour, bright, glowing down from the top
  withShades(track, (sh) => { if (shown()) $('td-glow').style.setProperty('--glow', sh.vivid); });

  const playBtn = $('td-play-btn');
  playBtn.dataset.trackId = track.id;
  playBtn.onclick = () => {
    if (currentTrack?.id === track.id) togglePlay();
    else playFromList(radioOf(track, 50), 0); // the track, then its radio
  };
  paintPlayButtons();

  const like = $('td-like-btn');
  like.dataset.trackId = track.id;
  like.onclick = () => toggleLike(track);
  const dl = $('td-download-btn');
  const paintDl = () => { dl.classList.toggle('on', lib.downloads.has(track.id)); setIcon(dl.querySelector('.ic'), lib.downloads.has(track.id) ? 'check' : 'download'); };
  paintDl();
  dl.onclick = async () => { setIcon(dl.querySelector('.ic'), 'spinner'); await toggleDownload(track); paintDl(); };
  $('td-options-btn').onclick = () => openTrackOptions(track);
  refreshLikeButtons();

  const similar = visible(similarTo(track, 12)).slice(0, 6);
  renderTrackList($('td-similar-list'), similar);

  const trending = visible(tracksOf(track.reciterName)).filter((t) => t.id !== track.id).sort((a, b) => b.listens - a.listens).slice(0, 10);
  $('td-trending-title').textContent = `الأعمال الرائجة لـ ${track.reciterName}`;
  $('td-trending-title').parentElement.style.display = trending.length ? 'block' : 'none';
  const tr = $('td-trending-list');
  tr.innerHTML = '';
  trending.forEach((t) => tr.appendChild(squareCard(t, () => openTrackDetail(t))));

  const fans = seededShuffle(reciters.filter((x) => x.name !== track.reciterName && x.count > 0).slice(0, 20), Number(track.id)).slice(0, 8);
  const fl = $('td-fans-like-list');
  fl.innerHTML = '';
  fans.forEach((x) => fl.appendChild(reciterCard(x)));
  fl.parentElement.style.display = fans.length ? 'block' : 'none';
}

// Same reciter first (unless `others`: other reciters only), then the same
// category (any of its Arabic or English values), in a fixed order per track
function similarTo(track, n, { others = false } = {}) {
  const same = others ? [] : tracksOf(track.reciterName).filter((t) => t.id !== track.id);
  const cat = categoryOf(track);
  const inCat = cat ? (t) => cat.values.includes(t.category) : (t) => !!track.category && t.category === track.category;
  const sameCat = allTracks.filter((t) => inCat(t) && t.reciterName !== track.reciterName);
  return [...seededShuffle(same, Number(track.id)), ...seededShuffle(sameCat.slice(0, 300), Number(track.id))].slice(0, n);
}

// ═══ Search ══════════════════════════════════════════════════════════════════
function renderSearchHome() {
  const grid = $('genre-grid');
  grid.innerHTML = '';
  CATEGORIES.forEach((cat) => {
    const inCat = allTracks.filter((t) => cat.values.includes(t.category));
    const card = document.createElement('div');
    card.className = 'genre-card';
    card.style.backgroundColor = cat.color;
    card.innerHTML = `
      <div class="genre-card-title">${esc(cat.title)}<div class="genre-card-count">${formatCount(inCat.length)} مقطع</div></div>
      ${inCat[0] ? `<img src="${esc(thumb(inCat[0].coverImage, 65))}" class="genre-card-img" alt="" loading="lazy" />` : ''}`;
    grid.appendChild(clickable(card, () => openCategoryDetail(cat)));
  });
}

// ─── The search page (Spotify's): what they searched for lately; while typing,
// words to search for and the best matches; then the results, with filters ───
const SEARCH_FILTERS = { all: 'الكل', tracks: 'المقاطع', reciters: 'الرواديد', playlists: 'قوائم التشغيل', categories: 'التصنيفات' };
const searchUi = { query: '', shownFor: null, filter: 'all' };
let recentSearches = store.get('sawt_recent_searches', []); // [{ kind, id, title, subtitle, image }]

function addRecentSearch(r) {
  recentSearches = [r, ...recentSearches.filter((x) => x.kind !== r.kind || x.id !== r.id)].slice(0, 20);
  store.set('sawt_recent_searches', recentSearches);
}
function removeRecentSearch(r) {
  recentSearches = recentSearches.filter((x) => x.kind !== r.kind || x.id !== r.id);
  store.set('sawt_recent_searches', recentSearches);
}

// What a search finds, the best first: a name that starts with the words, then
// one that has them, then by how much it's listened to
function find(query) {
  const q = normalize(query.trim());
  const words = q.split(/\s+/).filter(Boolean);
  const has = (n) => words.every((w) => n.includes(w));
  const rank = (s) => { const n = normalize(s); return n.startsWith(q) ? 2 : n.includes(q) ? 1 : 0; };
  const tracks = visible(allTracks.filter((t) => has(searchKey(t))))
    .map((t) => ({ t, a: rank(t.title), b: rank(t.reciterName) }))
    .sort((x, y) => y.a - x.a || y.b - x.b || y.t.listens - x.t.listens).map((x) => x.t);
  const found = reciters.filter((r) => r.count > 0 && has(normalize(r.name))).sort((a, b) => rank(b.name) - rank(a.name) || b.count - a.count);
  const playlists = lib.playlists.filter((p) => normalize(p.name).includes(q));
  const categories = CATEGORIES.filter((c) => normalize(c.title).includes(q));
  const suggestions = [...new Set([...found.map((r) => r.name), ...tracks.slice(0, 40).map((t) => t.title)])]
    .sort((a, b) => rank(b) - rank(a)).slice(0, 5);
  return { tracks, reciters: found, playlists, categories, suggestions, empty: !tracks.length && !found.length && !playlists.length && !categories.length };
}

window.openSearchPage = (query = '', show = false) => {
  searchUi.query = query;
  searchUi.shownFor = show ? query : null;
  searchUi.filter = 'all';
  openPage('page-view', () => renderSearchPage());
};

function renderSearchPage() {
  const view = $('page-view');
  newPageToken(view);
  viewScroll['page-view'] = null;
  view.innerHTML = `
    <div class="sp-head">
      <button class="icon-btn" onclick="history.back()" aria-label="رجوع">${icon('back')}</button>
      <div class="sp-field">
        <input type="search" class="sp-input" placeholder="ماذا تريد أن تسمع؟" enterkeyhint="search" autocomplete="off" aria-label="البحث" />
        <button class="sp-clear" aria-label="مسح">${icon('close')}</button>
      </div>
    </div>
    <div class="horizontal-scroller sp-filters"></div>
    <div class="sp-body"></div>`;
  const input = view.querySelector('.sp-input');
  const clear = view.querySelector('.sp-clear');
  const body = view.querySelector('.sp-body');
  input.value = searchUi.query;

  const search = (words) => {
    searchUi.query = words;
    searchUi.shownFor = words;
    searchUi.filter = 'all';
    input.value = words;
    input.blur();
    addRecentSearch({ kind: 'query', id: words.trim(), title: words.trim() });
    paint();
  };
  // What opening a result does: a track plays (and its radio after it), the rest open
  const openTrack = (t) => {
    input.blur();
    addRecentSearch({ kind: 'track', id: t.id, title: t.title, subtitle: `مقطع • ${t.reciterName}`, image: t.coverImage });
    playFromList(radioOf(t, 50), 0);
  };
  const openReciter = (r) => { addRecentSearch({ kind: 'reciter', id: r.name, title: r.name, subtitle: 'رادود', image: r.image }); openArtistDetail(r.name); };
  const openCategory = (c) => { addRecentSearch({ kind: 'category', id: c.id, title: c.title, subtitle: 'تصنيف' }); openCategoryDetail(c); };
  const openPlaylist = (pl) => { addRecentSearch({ kind: 'playlist', id: pl.id, title: pl.name, subtitle: 'قائمة تشغيل' }); openPlaylistPage(pl); };

  // A row of the results: a picture, two lines, something at the end
  const row = (art, title, subtitle, onClick, end = []) => {
    const el = document.createElement('div');
    el.className = 'track-item sp-row';
    el.innerHTML = `${art}<div class="track-info"><div class="track-title">${esc(title)}</div><div class="track-artist">${esc(subtitle)}</div></div>`;
    el.append(...end);
    return clickable(el, onClick);
  };
  const catArt = (c) => `<div class="art sp-art" style="background:${c?.color || '#333'}">${icon('music')}</div>`;
  const trackRow = (t) => {
    const like = document.createElement('button');
    const paintLike = () => {
      const on = lib.likes.has(t.id);
      like.className = `icon-btn pv-icon sp-like${on ? ' on' : ''}`;
      like.setAttribute('aria-label', on ? 'في المفضلة' : 'إضافة إلى المفضلة');
      like.innerHTML = icon(on ? 'check' : 'circle-plus');
    };
    paintLike();
    like.onclick = async (e) => { e.stopPropagation(); await toggleLike(t); paintLike(); };
    const more = iconButton('more', 'خيارات', (e) => { e.stopPropagation(); openTrackOptions(t); }, 'icon-btn row-more');
    const el = row(`<div class="art sp-art">${`<img src="${esc(thumb(t.coverImage, 56))}" alt="" loading="lazy" />`}</div>`, t.title, `مقطع • ${t.reciterName}`, () => openTrack(t), [more, like]);
    el.dataset.trackId = t.id;
    return el;
  };
  const reciterRow = (r) => row(`<div class="art sp-art round"><img src="${esc(thumb(r.image, 56))}" alt="" loading="lazy" /></div>`, r.name, `رادود • ${formatCount(r.count)} مقطع`, () => openReciter(r), [followButton(r)]);
  const playlistRow = (pl) => row(`<div class="sp-art">${artHtml({ covers: playlistTracks(pl).map((t) => t.coverImage) }, { width: 56 })}</div>`, pl.name, `قائمة تشغيل • ${formatCount(pl.tracks.length)} مقطع`, () => openPlaylist(pl));
  const categoryRow = (c) => row(catArt(c), c.title, 'تصنيف', () => openCategory(c));
  const empty = (text) => { const d = document.createElement('div'); d.className = 'empty-state'; d.textContent = text; return d; };

  const paint = () => {
    const q = searchUi.query;
    clear.style.display = q ? '' : 'none';
    const showResults = !!q.trim() && searchUi.shownFor === q;
    const filters = view.querySelector('.sp-filters');
    filters.replaceChildren(...(showResults ? Object.entries(SEARCH_FILTERS).map(([k, label]) => {
      const b = document.createElement('button');
      b.className = `filter-chip${searchUi.filter === k ? ' active' : ''}`;
      b.textContent = label;
      b.onclick = () => { searchUi.filter = k; paint(); };
      return b;
    }) : []));
    filters.style.display = showResults ? '' : 'none';

    // Nothing typed: what they searched for lately
    if (!q.trim()) {
      if (!recentSearches.length) { body.replaceChildren(empty('ابحث عن مقطع أو رادود أو تصنيف')); return; }
      const head = document.createElement('h2');
      head.className = 'sub-title sp-title';
      head.textContent = 'عمليات البحث الأخيرة';
      const rows = recentSearches.map((r) => {
        const x = iconButton('close', 'إزالة', (e) => { e.stopPropagation(); removeRecentSearch(r); paint(); }, 'icon-btn row-more');
        const art = r.kind === 'query' ? `<div class="art sp-art">${icon('search')}</div>`
          : r.kind === 'category' ? catArt(CATEGORIES.find((c) => c.id === r.id))
          : r.kind === 'playlist' ? `<div class="sp-art">${artHtml({ covers: playlistTracks(lib.playlists.find((p) => p.id === r.id) || { tracks: [] }).map((t) => t.coverImage) }, { width: 56 })}</div>`
          : `<div class="art sp-art${r.kind === 'reciter' ? ' round' : ''}"><img src="${esc(thumb(r.image, 56))}" alt="" loading="lazy" /></div>`;
        return row(art, r.title, r.kind === 'query' ? 'بحث' : r.subtitle, () => {
          if (r.kind === 'query') search(r.title);
          else if (r.kind === 'track') { const t = trackById.get(r.id); if (t) openTrack(t); }
          else if (r.kind === 'reciter') openReciter(reciterByName.get(r.id) || { name: r.id, image: r.image });
          else if (r.kind === 'category') { const c = CATEGORIES.find((x) => x.id === r.id); if (c) openCategory(c); }
          else if (r.kind === 'playlist') { const pl = lib.playlists.find((p) => p.id === r.id); if (pl) openPlaylist(pl); }
        }, [x]);
      });
      const clearAll = document.createElement('div');
      clearAll.className = 'pv-center';
      clearAll.innerHTML = '<button class="pill-btn">مسح عمليات البحث الأخيرة</button>';
      clearAll.firstElementChild.onclick = () => { recentSearches = []; store.set('sawt_recent_searches', []); paint(); };
      body.replaceChildren(head, ...rows, clearAll);
      return;
    }
    const f = find(q);
    if (f.empty) { body.replaceChildren(empty(fullyLoaded ? `لم يتم العثور على نتائج لـ «${q}»` : 'لم يتم العثور على نتائج، ما زالت المكتبة تُحمَّل')); return; }
    // Typing: words to search for, and the best matches straight away
    if (!showResults) {
      const all = document.createElement('div');
      all.className = 'sp-all';
      all.innerHTML = `${icon('search')}<span>عرض كل النتائج لـ «${esc(q)}»</span>`;
      clickable(all, () => search(q));
      body.replaceChildren(
        ...f.suggestions.map((s) => { const el = row(`<span class="sp-suggest">${icon('search')}</span>`, s, '', () => search(s)); el.classList.add('sp-suggestion'); return el; }),
        ...f.reciters.slice(0, 2).map(reciterRow),
        ...f.tracks.slice(0, 6).map(trackRow),
        all,
      );
      paintFollowButtons();
      markPlayingRows();
      return;
    }
    // The results, as Spotify lists them
    const k = searchUi.filter;
    const out = [];
    if (k === 'all' || k === 'reciters') out.push(...(k === 'all' ? f.reciters.slice(0, 1) : f.reciters).map(reciterRow));
    if (k === 'all' || k === 'playlists') out.push(...f.playlists.map(playlistRow));
    if (k === 'all' || k === 'tracks') out.push(...f.tracks.slice(0, k === 'all' ? 40 : 200).map(trackRow));
    if (k === 'all' || k === 'categories') out.push(...f.categories.map(categoryRow));
    if (k === 'all') out.push(...f.reciters.slice(1, 12).map(reciterRow));
    body.replaceChildren(...(out.length ? out : [empty('لا توجد نتائج هنا')]));
    paintFollowButtons();
    markPlayingRows();
  };

  let timer;
  input.addEventListener('input', () => {
    searchUi.query = input.value;
    clearTimeout(timer);
    timer = setTimeout(paint, 120);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) search(input.value); });
  clear.onclick = () => { searchUi.query = ''; searchUi.shownFor = null; input.value = ''; paint(); input.focus(); };
  paint();
  if (searchUi.shownFor === null) setTimeout(() => { if (input.isConnected) input.focus(); }, 60);
}

// ═══ Downloads tab ═══════════════════════════════════════════════════════════
// What is saved here to hear with no connection: a gold card with how many
// and how long, the room they take (a gold bar) and the room left, shuffle and
// play; the reciters they come from (tap one to show only theirs); a sort and
// a search; what is downloading now; and liked tracks not downloaded yet (or
// the most listened), to save one by one or all at once
const DOWNLOAD_SORTS = { newest: 'الأحدث', title: 'العنوان', reciter: 'الرادود' };
const downloadsUi = { sort: 'newest', reciter: null, query: '' };

// "245 ميغابايت", "1.2 غيغابايت"
function formatBytes(bytes) {
  if (bytes >= 1e9) return `${oneDecimal(bytes / 1e9)} غيغابايت`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} ميغابايت`;
  return bytes > 0 ? `${Math.max(1, Math.round(bytes / 1e3))} كيلوبايت` : '0 ميغابايت';
}

window.goDownloads = () => { goTab('downloads'); renderTab(); };

function renderDownloadsTab() {
  const box = $('downloads-content');
  const newest = downloadedTracks().reverse();
  const source = { kind: 'downloads', id: '' };
  $('dl-search-btn').style.display = newest.length ? '' : 'none';
  const parts = [];

  if (!newest.length) {
    const empty = document.createElement('div');
    empty.className = 'dl-empty animate-in';
    empty.innerHTML = `
      <div class="dl-empty-ring"><span class="dl-empty-disc">${icon('download-plain')}</span></div>
      <h2>لا توجد تنزيلات بعد</h2>
      <p class="muted">نزّل القصائد التي تحبها لتسمعها في أي مكان، حتى في الطريق أو بدون إنترنت.</p>
      <button class="pill-btn">تصفح القصائد</button>`;
    empty.querySelector('button').onclick = () => goHome();
    parts.push(empty);
  } else {
    // The card: a gold disc, how many and how long, the room they take, shuffle and play
    const card = document.createElement('div');
    card.className = 'dl-card animate-in';
    card.innerHTML = `
      <div class="dl-card-head">
        <span class="dl-disc">${icon('download-plain')}</span>
        <div style="min-width: 0;"><div class="dl-card-title">مكتبتك بلا إنترنت</div>
        <div class="muted dl-card-sub">${formatCount(newest.length)} مقطع • ${totalDuration(newest)}</div></div>
      </div>
      <div class="dl-bar"><span></span></div>
      <div class="dl-room muted"><span class="dl-used">…</span><span class="dl-free"></span></div>
      <div class="dl-card-actions">
        <span class="dl-offline">${icon('wifi-off')} تعمل بدون إنترنت</span>
        <span class="pv-spacer"></span>
      </div>`;
    const shuffle = iconButton('shuffle', 'تشغيل عشوائي', () => toggleShuffle(), `icon-btn pv-icon shuffle-toggle${isShuffle ? ' on' : ''}`);
    card.querySelector('.dl-card-actions').append(shuffle, playAllButton(newest, source));
    // The browser says how much it keeps for this app, and how much more it would
    navigator.storage?.estimate?.().then(({ usage = 0, quota = 0 }) => {
      card.querySelector('.dl-used').textContent = `تستخدم ${formatBytes(usage)}`;
      if (quota) card.querySelector('.dl-free').textContent = `${formatBytes(Math.max(quota - usage, 0))} متاحة`;
      card.querySelector('.dl-bar span').style.width = `${quota ? Math.max((usage / quota) * 100, 2) : 0}%`;
    }).catch(() => {});
    if (!navigator.storage?.estimate) card.querySelector('.dl-used').textContent = '';
    parts.push(card);
  }

  // Downloading now
  const now = [...downloading].map((id) => trackById.get(id)).filter(Boolean);
  if (now.length) {
    const list = document.createElement('div');
    list.className = 'track-list';
    now.forEach((t) => list.appendChild(downloadRow(t, t.reciterName, `<span class="dl-spin">${icon('spinner')}</span>`)));
    parts.push(section('جارٍ التنزيل', list));
  }

  if (newest.length) {
    // The reciters they come from: tap one to show only theirs
    const counts = new Map();
    newest.forEach((t) => counts.set(t.reciterName, (counts.get(t.reciterName) || 0) + 1));
    if (downloadsUi.reciter && !counts.has(downloadsUi.reciter)) downloadsUi.reciter = null;
    if (counts.size > 1) {
      const row = document.createElement('div');
      row.className = 'horizontal-scroller dl-reciters';
      [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([name, n]) => {
        const chosen = downloadsUi.reciter === name;
        const el = document.createElement('div');
        el.className = `dl-reciter${chosen ? ' on' : ''}${downloadsUi.reciter && !chosen ? ' dim' : ''}`;
        el.innerHTML = `<span class="dl-reciter-photo"><img src="${esc(thumb(reciterPhoto(name), 76))}" alt="" loading="lazy" /></span>
          <div class="ellipsis dl-reciter-name">${esc(name)}</div><div class="muted dl-reciter-count">${formatCount(n)} مقطع</div>`;
        row.appendChild(clickable(el, () => { downloadsUi.reciter = chosen ? null : name; renderDownloadsTab(); }));
      });
      parts.push(section('حسب الرادود', row));
    }

    // Sort
    const sorts = document.createElement('div');
    sorts.className = 'horizontal-scroller dl-sorts';
    Object.entries(DOWNLOAD_SORTS).forEach(([k, label]) => {
      const b = document.createElement('button');
      b.className = `filter-chip${downloadsUi.sort === k ? ' active' : ''}`;
      b.textContent = label;
      b.onclick = () => { downloadsUi.sort = k; renderDownloadsTab(); };
      sorts.appendChild(b);
    });
    parts.push(sorts);

    // The tracks
    const q = normalize(downloadsUi.query.trim());
    let shown = newest.filter((t) => (!downloadsUi.reciter || t.reciterName === downloadsUi.reciter) && (!q || searchKey(t).includes(q)));
    if (downloadsUi.sort === 'title') shown = [...shown].sort((a, b) => arabicOrder.compare(a.title, b.title));
    if (downloadsUi.sort === 'reciter') shown = [...shown].sort((a, b) => arabicOrder.compare(a.reciterName, b.reciterName) || arabicOrder.compare(a.title, b.title));
    const list = document.createElement('div');
    list.className = 'track-list dl-list';
    if (!shown.length) list.innerHTML = '<div class="empty-state">لا توجد نتائج</div>';
    shown.forEach((t, i) => {
      const more = iconButton('more', 'خيارات', (e) => { e.stopPropagation(); openTrackOptions(t); }, 'icon-btn row-more');
      const row = downloadRow(t, t.reciterName, '', true);
      row.appendChild(more);
      list.appendChild(clickable(row, () => playFromList(shown, i, { source })));
    });
    parts.push(list);
  }

  // Ready to save: their likes not downloaded yet, or else the most listened
  const free = (t) => !lib.downloads.has(t.id) && !downloading.has(t.id) && t.audioUrl;
  const liked = likedTracks().filter(free).slice(0, 8);
  const toSave = liked.length ? liked : popularTracks.filter(free).slice(0, 8);
  if (toSave.length) {
    const s = document.createElement('div');
    s.className = 'section dl-save';
    s.innerHTML = `<div class="cl-suggest-head"><div><h2 class="section-title">${liked.length ? 'من مفضلتك' : 'مقترحة للتنزيل'}</h2>
      <div class="muted" style="font-size: 13px;">${liked.length ? 'مقاطع تحبها ولم تنزّلها بعد' : 'الأكثر استماعاً، لتسمعها في أي مكان'}</div></div>
      <button class="link-btn">تنزيل الكل</button></div>`;
    s.querySelector('.link-btn').onclick = () => downloadAll(toSave);
    const list = document.createElement('div');
    list.className = 'track-list';
    toSave.forEach((t) => {
      const row = downloadRow(t, t.reciterName, '');
      const get = iconButton('download', 'تنزيل', (e) => { e.stopPropagation(); toggleDownload(t); }, 'icon-btn pv-icon dl-get');
      row.appendChild(get);
      list.appendChild(clickable(row, () => playFromList([t], 0)));
    });
    s.appendChild(list);
    parts.push(s);
  }
  box.replaceChildren(...parts);
  markPlayingRows();
}

// A track of this page: its cover, a gold sign when it is on the device, two lines
function downloadRow(t, subtitle, end = '', onDevice = false) {
  const row = document.createElement('div');
  row.className = 'track-item dl-row';
  row.dataset.trackId = t.id;
  row.innerHTML = `
    <img src="${esc(thumb(t.coverImage, 56))}" class="track-img" alt="" loading="lazy" />
    <div class="track-info"><div class="track-title">${esc(t.title)}</div>
      <div class="track-artist">${onDevice ? `<span class="dl-mark" aria-label="منزّل">${icon('arrow-down')}</span>` : ''}${esc(subtitle)}</div></div>
    ${end}`;
  return row;
}

$('dl-search-btn').onclick = () => {
  const box = $('dl-search');
  const open = box.style.display === 'none';
  box.style.display = open ? '' : 'none';
  if (open) $('dl-search-input').focus();
  else { $('dl-search-input').value = ''; downloadsUi.query = ''; renderDownloadsTab(); }
};
$('dl-search-input').addEventListener('input', (e) => { downloadsUi.query = e.target.value; renderDownloadsTab(); });

// ═══ Library tab (Spotify's "Your Library") ══════════════════════════════════
// Filters, a sort, a grid (or a list) of their collections, the likes and the
// downloads pinned on top
const LIBRARY_FILTERS = { playlists: 'قوائم التشغيل', reciters: 'الرواديد', downloads: 'التنزيلات' };
const libraryUi = { filter: null, sort: 'recent', grid: store.get('sawt_library_grid', true), query: '' };
const playlistTime = (pl) => Number(String(pl.id).match(/\d{10,}/)?.[0] || 0);

function libraryEntries() {
  const all = [
    { key: 'likes', kind: 'likes', title: 'المقاطع المفضلة', subtitle: `قائمة تشغيل • ${formatCount(likesCount())} مقطع`, art: { likes: true }, pinned: true, time: 2, open: () => openLikesPage() },
    { key: 'downloads', kind: 'downloads', title: 'التنزيلات', subtitle: `${formatCount(lib.downloads.size)} مقطع على الجهاز`, art: { downloads: true }, pinned: true, time: 1, open: () => goDownloads() },
    ...lib.playlists.map((pl) => {
      const tracks = playlistTracks(pl);
      return { key: `p:${pl.id}`, kind: 'playlist', pl, title: pl.name, subtitle: `قائمة تشغيل • ${formatCount(fullyLoaded ? tracks.length : pl.tracks.length)} مقطع`,
        art: { covers: tracks.map((t) => t.coverImage) }, time: playlistTime(pl), open: () => openPlaylistPage(pl) };
    }),
    ...[...lib.follows].map((name, i) => ({ key: `r:${name}`, kind: 'reciter', title: name, subtitle: 'رادود', art: { cover: reciterPhoto(name), round: true }, time: i, open: () => openArtistDetail(name) })),
  ];
  const { filter, query, sort } = libraryUi;
  const q = normalize(query.trim());
  const shown = all.filter((e) => {
    if (filter === 'playlists' && e.kind !== 'likes' && e.kind !== 'playlist') return false;
    if (filter === 'reciters' && e.kind !== 'reciter') return false;
    if (filter === 'downloads' && e.kind !== 'downloads' && !(e.pl?.tracks.length && e.pl.tracks.every((id) => lib.downloads.has(id)))) return false;
    return !q || normalize(e.title).includes(q);
  });
  return shown.sort((a, b) => (!!b.pinned - !!a.pinned) || (sort === 'recent' ? b.time - a.time : arabicOrder.compare(a.title, b.title)));
}

function renderLibrary() {
  // Filters: once one is chosen, an ✕ to go back to all of it
  const chip = (key, active) => {
    const b = document.createElement('button');
    b.className = `filter-chip${active ? ' active' : ''}`;
    b.textContent = LIBRARY_FILTERS[key];
    b.onclick = () => { libraryUi.filter = active ? null : key; renderLibrary(); };
    return b;
  };
  if (libraryUi.filter) {
    const clear = document.createElement('button');
    clear.className = 'filter-clear';
    clear.setAttribute('aria-label', 'كل المكتبة');
    clear.innerHTML = icon('close');
    clear.onclick = () => { libraryUi.filter = null; renderLibrary(); };
    $('lib-filters').replaceChildren(clear, chip(libraryUi.filter, true));
  } else {
    $('lib-filters').replaceChildren(...Object.keys(LIBRARY_FILTERS).map((k) => chip(k, false)));
  }
  $('lib-sort').querySelector('span').textContent = libraryUi.sort === 'recent' ? 'مؤخراً' : 'أبجدياً';
  const layout = $('lib-layout');
  setIcon(layout.querySelector('.ic'), libraryUi.grid ? 'list' : 'grid');
  layout.setAttribute('aria-label', libraryUi.grid ? 'عرض كقائمة' : 'عرض كشبكة');

  const container = $('library-content');
  container.className = libraryUi.grid ? 'lib-grid' : 'lib-list';
  const entries = libraryEntries();
  if (!entries.length) {
    container.innerHTML = `<div class="empty-state">${libraryUi.query.trim() ? 'لا توجد نتائج' : 'لا يوجد شيء هنا بعد'}</div>`;
    return;
  }
  container.replaceChildren(...entries.map((e) => {
    const el = document.createElement('div');
    el.className = libraryUi.grid ? 'lib-tile' : 'lib-row';
    el.innerHTML = `${artHtml(e.art, { width: libraryUi.grid ? 120 : 64 })}
      <div class="lib-text"><div class="lib-title">${esc(e.title)}</div>
      <div class="lib-sub">${e.pinned ? `<span class="lib-pin">${icon('pin', { fill: true })}</span>` : ''}<span class="ellipsis">${esc(e.subtitle)}</span></div></div>`;
    return clickable(el, e.open);
  }));
}

$('lib-sort').onclick = () => { libraryUi.sort = libraryUi.sort === 'recent' ? 'alpha' : 'recent'; renderLibrary(); };
$('lib-layout').onclick = () => { libraryUi.grid = !libraryUi.grid; store.set('sawt_library_grid', libraryUi.grid); renderLibrary(); };
$('lib-search-btn').onclick = () => {
  const box = $('lib-search');
  const open = box.style.display === 'none';
  box.style.display = open ? '' : 'none';
  if (open) $('lib-search-input').focus();
  else { $('lib-search-input').value = ''; libraryUi.query = ''; renderLibrary(); }
};
$('lib-search-input').addEventListener('input', (e) => { libraryUi.query = e.target.value; renderLibrary(); });

// Create: a playlist, or one made from their taste or what they play most
window.openCreateSheet = () => {
  const sheet = $('action-sheet');
  sheet.innerHTML = '<div class="sheet-handle"></div>';
  const makeFrom = (name, tracks) => {
    if (!tracks.length) { toast('استمع إلى بعض المقاطع أولاً ليتعرّف التطبيق على ذوقك'); return; }
    closeOverlayThen(async () => {
      const pl = await createPlaylist(name, tracks.map((t) => t.id));
      openPlaylistPage(pl);
      toast('أُنشئت القائمة');
    });
  };
  const item = (iconName, title, sub, onClick) => {
    const b = document.createElement('button');
    b.className = 'create-item';
    b.innerHTML = `<span class="create-disc">${icon(iconName)}</span><span><b>${esc(title)}</b><span class="muted">${esc(sub)}</span></span>`;
    b.onclick = onClick;
    sheet.appendChild(b);
  };
  item('music', 'قائمة تشغيل', 'أنشئ قائمة للمقاطع التي تحبها', () => closeOverlayThen(() => promptCreatePlaylist()));
  item('blend', 'مزيج من ذوقك', 'قائمة جاهزة من مقاطع تناسب ذوقك', () => makeFrom('مزيج من ذوقك', madeForYou(30)));
  item('flame', 'الأكثر استماعاً لديك', 'المقاطع التي تكرر الاستماع إليها', () => makeFrom('الأكثر استماعاً لديك', mostPlayed(30)));
  openSheet('action-modal');
};

// ═══ Prompts, options, playlists ═════════════════════════════════════════════
function openPrompt({ title, hint = '', value = '', placeholder = '', type = 'text', minLength = 1, onSubmit }) {
  const modal = $('prompt-modal');
  $('prompt-title').textContent = title;
  $('prompt-hint').textContent = hint;
  const input = $('prompt-input');
  input.type = type;
  input.autocomplete = type === 'password' ? 'new-password' : 'off';
  input.dir = type === 'password' ? 'ltr' : 'auto';
  input.value = value;
  input.placeholder = placeholder;
  const submit = async () => {
    const v = type === 'password' ? input.value : input.value.trim();
    if (v.length < minLength) { input.focus(); return; }
    closeOverlayThen(() => onSubmit(v));
  };
  $('prompt-submit').onclick = submit;
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  openOverlay(() => { modal.style.display = 'flex'; setTimeout(() => input.focus(), 50); }, () => { modal.style.display = 'none'; });
}

function openConfirm({ title, text = '', okText, onConfirm }) {
  const modal = $('confirm-modal');
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okText;
  $('confirm-ok').onclick = () => closeOverlayThen(onConfirm);
  openOverlay(() => { modal.style.display = 'flex'; $('confirm-ok').focus(); }, () => { modal.style.display = 'none'; });
}

window.promptCreatePlaylist = (thenAddTrack = null) => {
  const run = () => openPrompt({
    title: 'إنشاء قائمة تشغيل', hint: 'أدخل اسماً لقائمة التشغيل الجديدة.', placeholder: 'مثال: قصائد للسيارة',
    onSubmit: async (name) => {
      const pl = await createPlaylist(name);
      if (thenAddTrack) { pl.tracks.push(thenAddTrack.id); await savePlaylist(pl); toast(`أُضيف إلى "${name}"`); }
      else toast('أُنشئت القائمة');
    },
  });
  if ($('playlist-modal').style.display === 'flex') closeOverlayThen(run); else run();
};

function openPlaylistPicker(track) {
  const modal = $('playlist-modal');
  const list = $('playlist-modal-list');
  list.innerHTML = '';
  if (!lib.playlists.length) list.innerHTML = '<div class="empty-state">لا توجد قوائم تشغيل. أنشئ واحدة أولاً.</div>';
  lib.playlists.forEach((pl) => {
    const item = document.createElement('button');
    item.className = 'sheet-item';
    const has = pl.tracks.includes(track.id);
    item.innerHTML = `${icon(has ? 'check' : 'playlist')}<span style="flex:1">${esc(pl.name)}</span><span class="muted" style="font-size:12px">${formatCount(pl.tracks.length)} مقطع</span>`;
    item.onclick = () => {
      if (has) { toast('المقطع موجود في هذه القائمة'); return; }
      pl.tracks.push(track.id);
      savePlaylist(pl);
      toast(`أُضيف إلى "${pl.name}"`);
      history.back();
    };
    list.appendChild(item);
  });
  modal.querySelector('.secondary-btn').onclick = () => promptCreatePlaylist(track);
  openOverlay(() => { modal.style.display = 'flex'; }, () => { modal.style.display = 'none'; });
}

function openSheet(backdropId) {
  const modal = $(backdropId);
  const sheet = modal.querySelector('.sheet');
  openOverlay(
    () => { modal.style.display = 'flex'; void modal.offsetWidth; modal.classList.add('open'); sheet.classList.add('open'); },
    () => { modal.classList.remove('open'); sheet.classList.remove('open'); setTimeout(() => { modal.style.display = 'none'; }, 250); },
  );
}

// The items of Spotify's menu, in its order
function openTrackOptions(track, { playlist = null } = {}) {
  $('track-options-img').src = thumb(track.coverImage, 55);
  $('track-options-title').textContent = track.title;
  $('track-options-artist').textContent = track.reciterName;
  const box = $('track-options-items');
  box.innerHTML = '';
  const then = (fn) => () => closeOverlayThen(fn);
  // A page opens where the player was: the player closes first
  const toPage = (fn) => () => closeOverlayThen(() => ($('full-player-view').classList.contains('open') ? closeOverlayThen(fn) : fn()));
  const liked = lib.likes.has(track.id);
  const downloaded = lib.downloads.has(track.id);
  const cat = categoryOf(track);

  sheetItem(box, 'share-nodes', 'مشاركة', then(() => openShareSheet(track)));
  sheetItem(box, `<span class="liked-square">${icon('heart', { fill: true })}</span>`, liked ? 'إزالة من "المقاطع المفضلة"' : 'إضافة إلى "المقاطع المفضلة"', then(() => toggleLike(track)));
  sheetItem(box, 'circle-plus', 'إضافة إلى قائمة تشغيل', then(() => openPlaylistPicker(track)));
  if (playlist) {
    sheetItem(box, 'trash', 'إزالة من هذه القائمة', then(async () => {
      playlist.tracks = playlist.tracks.filter((id) => id !== track.id);
      await savePlaylist(playlist);
      toast('أُزيل من القائمة');
    }));
  }
  sheetItem(box, lib.hidden.has(track.id) ? 'eye' : 'eye-off', lib.hidden.has(track.id) ? 'إظهار هذا المقطع' : 'إخفاء هذا المقطع', then(() => toggleHidden(track)));
  sheetItem(box, 'list-plus', 'إضافة إلى قائمة الانتظار', then(() => playNextInQueue(track)));
  if (currentTrack) sheetItem(box, 'queue', 'الذهاب إلى قائمة الانتظار', then(() => openQueue()));
  sheetItem(box, downloaded ? 'check' : 'download', downloaded ? 'حذف التنزيل' : 'تنزيل للاستماع بدون إنترنت', then(() => toggleDownload(track)), downloaded ? 'gold' : '');
  if (cat) sheetItem(box, 'album', `الانتقال إلى التصنيف: ${cat.title}`, toPage(() => openCategoryDetail(cat)));
  if (track.reciterName !== UNKNOWN_RECITER) sheetItem(box, 'mic', 'الانتقال إلى الرادود', toPage(() => openArtistDetail(track.reciterName)));
  sheetItem(box, 'circle-x', lib.excluded.has(track.id) ? 'إعادة المقطع إلى "لمحة عن ذوقك"' : 'استبعاد المقطع من "لمحة عن ذوقك"', then(() => toggleExcluded(track)));
  sheetItem(box, 'timer', 'مؤقت النوم', then(() => openSleepTimerSheet()), '', $('sleep-timer-label').textContent);
  sheetItem(box, 'radio', 'الانتقال إلى راديو المقطع', toPage(() => openRadioPage(track)));
  sheetItem(box, 'playlist', 'عرض لائحة الشكر للمقطع', then(() => loadDetails(track).then(() => openCredits(track, reciterForTrack(track)))));
  sheetItem(box, 'audio-lines', 'عرض رمز المقطع', then(() => openCodeSheet(track)));
  openSheet('track-options-modal');
}

// The track's code (Spotify's): its cover on its colour, a QR code that opens
// it on any phone's camera, share and copy the link
async function openCodeSheet(t) {
  const url = `${SITE_URL}/track?id=${t.id}`;
  let qrSvg = '';
  try {
    const { default: qrcode } = await import('qrcode-generator');
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 1} ${r + 1}h1v1h-1z`;
    qrSvg = `<svg viewBox="0 0 ${n + 2} ${n + 2}" shape-rendering="crispEdges" aria-label="رمز QR للمقطع"><path fill="#121212" d="${d}"/></svg>`;
  } catch { /* offline: the code's script didn't load; the link still works */ }
  const sheet = $('action-sheet');
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <h2 class="modal-title" style="border: none; text-align: center;">رمز المقطع</h2>
    <div class="code-card">
      <img src="${esc(thumb(t.coverImage, 320))}" alt="" class="code-cover" />
      <div class="code-row">
        ${qrSvg ? `<div class="code-qr">${qrSvg}</div>` : ''}
        <div style="min-width: 0;">
          <div class="code-title">${esc(t.title)}</div>
          <div class="code-reciter ellipsis">${esc(t.reciterName)}</div>
          <div class="code-hint">امسح الرمز بكاميرا أي هاتف لفتح المقطع</div>
        </div>
      </div>
    </div>
    <div class="code-actions">
      <button class="secondary-btn code-share">${icon('share-nodes')} مشاركة</button>
      <button class="secondary-btn code-copy">${icon('copy')} نسخ الرابط</button>
    </div>`;
  withShades(t, (sh) => { const card = sheet.querySelector('.code-card'); if (card) card.style.background = sh.top; });
  sheet.querySelector('.code-share').onclick = () => closeOverlayThen(() => openShareSheet(t));
  sheet.querySelector('.code-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast('تم نسخ الرابط'); } catch { prompt('انسخ الرابط:', url); }
  };
  openSheet('action-modal');
}

window.openCurrentTrackOptions = () => { if (currentTrack) openTrackOptions(currentTrack); };
window.shareCurrentTrack = () => { if (currentTrack) openShareSheet(currentTrack); };

// Shared links point at the website: it shows a preview in chats/search and
// sends phones back into this app on the same track.
async function share(title, text, url) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); } catch { /* cancelled */ }
    return;
  }
  try { await navigator.clipboard.writeText(url); toast('تم نسخ الرابط'); } catch { prompt('انسخ الرابط:', url); }
}

// ─── Share sheet (Spotify's): a story card of the track (its cover, name and
// reciter on the cover's colour, the app's logo), four backgrounds to choose
// from, then where to send it. The card goes as a picture where the browser
// can share files, with the track's link always ───
const CARD_STYLES = ['colour', 'fade', 'black', 'picture'];
let shareState = null; // { track, style, colour, cover }

const trackLink = (t) => `${SITE_URL}/track?id=${t.id}`;
const shareText = (t) => `استمع إلى ${t.title} بصوت ${t.reciterName}`;

// The cover, readable by the canvas (its pixels go into the picture): through
// the image service that allows it, else the file itself, else the app's icon
function loadCardCover(url) {
  const tryLoad = (src) => new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 8000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = src;
  });
  const sources = url ? [`https://wsrv.nl/?url=${encodeURIComponent(url)}&w=1080&h=1080&fit=cover&output=jpg&q=90`, url] : [];
  return sources.reduce((p, src) => p.then((img) => img || tryLoad(src)), Promise.resolve(null))
    .then((img) => img || tryLoad(FALLBACK_COVER));
}

// Lines of `text` that fit `width`, `max` at most (the last one cut with "…")
function wrapLines(ctx, text, width, max) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= width || !line) { line = next; continue; }
    lines.push(line);
    line = words[i];
    if (lines.length === max) { line = ''; break; }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, max);
  if (lines.length > max || words.join(' ') !== shown.join(' ')) {
    let last = shown[shown.length - 1] || '';
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    shown[shown.length - 1] = `${last.trim()}…`;
  }
  return shown;
}

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); // older browsers: square corners
};

function drawShareCard() {
  const { track: t, style, colour, cover } = shareState;
  const canvas = $('share-card');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  roundRect(ctx, 0, 0, W, H, W * 0.06);
  ctx.clip();
  // The background
  if (style === 'picture' && cover) {
    // The cover blurred: drawn tiny then stretched (works where canvas filters don't)
    const tiny = document.createElement('canvas');
    tiny.width = 12;
    tiny.height = 21;
    const s = Math.max(12 / cover.width, 21 / cover.height);
    tiny.getContext('2d').drawImage(cover, (12 - cover.width * s) / 2, (21 - cover.height * s) / 2, cover.width * s, cover.height * s);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tiny, 0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, W, H);
  } else if (style === 'fade') {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, colour);
    g.addColorStop(1, '#0E0E0E');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = style === 'black' ? '#0E0E0E' : colour;
    ctx.fillRect(0, 0, W, H);
  }

  // The card: the cover, the name, the reciter, the app's logo
  const x = W * 0.07;
  const cw = W - 2 * x;
  const pad = W * 0.045;
  const inner = cw - 2 * pad;
  const titleSize = W * 0.062;
  const nameSize = W * 0.05;
  const logo = W * 0.075;
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = `800 ${titleSize}px Tajawal, sans-serif`;
  const titleLines = wrapLines(ctx, t.title, inner, 2);
  const ch = pad + inner + W * 0.045 + titleLines.length * titleSize * 1.25 + W * 0.012 + nameSize * 1.3 + W * 0.05 + logo + pad;
  const y = (H - ch) / 2;
  ctx.fillStyle = style === 'black' ? '#232323' : style === 'picture' ? 'rgba(0,0,0,0.55)' : mixHex(colour, '#000000', 0.62);
  roundRect(ctx, x, y, cw, ch, W * 0.035);
  ctx.fill();

  let cy = y + pad;
  ctx.save();
  roundRect(ctx, x + pad, cy, inner, inner, W * 0.025);
  ctx.clip();
  if (cover) {
    const s = Math.max(inner / cover.width, inner / cover.height);
    ctx.drawImage(cover, x + pad + (inner - cover.width * s) / 2, cy + (inner - cover.height * s) / 2, cover.width * s, cover.height * s);
  } else {
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(x + pad, cy, inner, inner);
  }
  ctx.restore();
  cy += inner + W * 0.045;

  const right = x + cw - pad;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 ${titleSize}px Tajawal, sans-serif`;
  titleLines.forEach((line) => { ctx.fillText(line, right, cy); cy += titleSize * 1.25; });
  cy += W * 0.012;
  ctx.font = `500 ${nameSize}px Tajawal, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(wrapLines(ctx, t.reciterName, inner, 1)[0] || '', right, cy);
  cy += nameSize * 1.3 + W * 0.05;

  // The logo, where Spotify puts its own: the S in a dark circle, the app's name
  ctx.fillStyle = '#161B1F';
  ctx.beginPath();
  ctx.arc(right - logo / 2, cy + logo / 2, logo / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  const sh = logo * 0.62;
  const sc = sh / 253;
  ctx.translate(right - logo / 2 - (215.4 * sc) / 2, cy + (logo - sh) / 2);
  ctx.scale(sc, sc);
  ctx.fillStyle = '#F1592A';
  ctx.fill(new Path2D(S_PATH));
  ctx.restore();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${W * 0.045}px Tajawal, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('صوت الأحزان', right - logo - W * 0.02, cy + logo / 2);
  ctx.restore();
}

const cardBlob = () => new Promise((resolve) => {
  try { $('share-card').toBlob((b) => resolve(b), 'image/png'); } catch { resolve(null); } // a cover the canvas can't export
});

async function shareCardFile(t) {
  const blob = await cardBlob();
  if (!blob) return null;
  const file = new File([blob], 'sawt-alahzan.png', { type: 'image/png' });
  return navigator.canShare?.({ files: [file] }) ? file : null;
}

window.openShareSheet = (t) => {
  shareState = { track: t, style: 'colour', colour: fallbackShades(t).vivid, cover: null };
  const paintStyles = () => {
    $('share-styles').replaceChildren(...CARD_STYLES.map((style) => {
      const dot = document.createElement('button');
      dot.className = `style-dot${shareState.style === style ? ' on' : ''}`;
      dot.setAttribute('aria-label', { colour: 'لون الغلاف', fade: 'تدرّج', black: 'أسود', picture: 'صورة الغلاف' }[style]);
      dot.setAttribute('aria-pressed', String(shareState.style === style));
      dot.innerHTML = style === 'picture' ? `<span>${icon('image-down')}</span>` : '<span></span>';
      const fill = dot.firstElementChild;
      if (style === 'colour') fill.style.background = shareState.colour;
      if (style === 'fade') fill.style.background = `linear-gradient(180deg, ${shareState.colour}, #0E0E0E)`;
      if (style === 'black') fill.style.background = '#0E0E0E';
      dot.onclick = () => { shareState.style = style; paintStyles(); drawShareCard(); };
      return dot;
    }));
  };
  paintStyles();
  drawShareCard();
  coverShadesFor(t).then((sh) => {
    if (shareState?.track !== t) return;
    shareState.colour = sh.vivid;
    paintStyles();
    drawShareCard();
  });
  loadCardCover(t.coverImage).then((img) => {
    if (shareState?.track !== t) return;
    shareState.cover = img;
    drawShareCard();
  });
  document.fonts?.ready.then(() => { if (shareState?.track === t) drawShareCard(); });

  const link = trackLink(t);
  const text = shareText(t);
  const enc = encodeURIComponent;
  // Opened (or copied, or shared) straight from the tap, which browsers ask
  // for, then the sheet closes
  const openUrl = (url) => () => { window.open(url, '_blank', 'noopener'); history.back(); };
  const targets = [
    ['نسخ الرابط', 'link', '#2E2E2E', async () => {
      try { await navigator.clipboard.writeText(link); toast('تم نسخ الرابط'); } catch { prompt('انسخ الرابط:', link); }
      history.back();
    }],
    ['واتساب', 'whatsapp', '#25D366', openUrl(`https://wa.me/?text=${enc(`${text}\n${link}`)}`)],
    ['تيليجرام', 'send', '#229ED9', openUrl(`https://t.me/share/url?url=${enc(link)}&text=${enc(text)}`)],
    ['X', 'x', '#000000', openUrl(`https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(link)}`)],
    ['فيسبوك', 'facebook', '#1877F2', openUrl(`https://www.facebook.com/sharer/sharer.php?u=${enc(link)}`)],
    ['الرسائل', 'message', '#2E2E2E', () => { location.href = `sms:?&body=${enc(`${text}\n${link}`)}`; history.back(); }],
    ['حفظ الصورة', 'image-down', '#2E2E2E', async () => {
      const blob = await cardBlob();
      if (!blob) { toast('تعذر حفظ الصورة'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${t.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'sawt-alahzan'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('حُفظت الصورة');
    }],
    ['عرض المزيد', 'ellipsis', '#2E2E2E', async () => {
      const file = await shareCardFile(t);
      let done = false;
      if (file) {
        try { await navigator.share({ files: [file], title: t.title, text: `${text}\n${link}` }); done = true; } catch (e) { done = e.name === 'AbortError'; }
      }
      if (!done) await share(t.title, text, link);
      if ($('share-modal').classList.contains('open')) history.back();
    }],
  ];
  $('share-targets').replaceChildren(...targets.map(([label, glyph, bg, fn]) => {
    const b = document.createElement('button');
    b.className = 'share-target';
    const mark = glyph === 'x' ? '<b class="brand-x">𝕏</b>' : glyph === 'facebook' ? '<b class="brand-f">f</b>' : icon(glyph);
    b.innerHTML = `<span class="share-disc" style="background:${bg}">${mark}</span><span class="share-label">${esc(label)}</span>`;
    b.onclick = fn;
    return b;
  }));
  openSheet('share-modal');
};

// ═══ Player ══════════════════════════════════════════════════════════════════
const audio = new Audio();
audio.preload = 'metadata';
let currentTrack = null;
let queue = [];
let queueIndex = 0;
let queueOriginal = null; // order before shuffling
let isShuffle = false;
let repeatMode = 'off';    // off → all → one
let isAutoplay = store.get('sawt_autoplay', true);
let countedListen = null;  // track id whose listen was already counted
let hls = null;
let wantsToPlay = false;   // false for a track restored paused at startup
let failedInARow = 0;

let loadToken = 0;
async function loadSource(url) {
  const token = ++loadToken;
  if (hls) { hls.destroy(); hls = null; }
  if (/\.m3u8(\?|$)/i.test(url) && !audio.canPlayType('application/vnd.apple.mpegurl')) {
    const { default: Hls } = await import('hls.js'); // only for the rare streamed track
    if (token !== loadToken) return; // another track was chosen meanwhile
    if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(audio);
      return;
    }
  }
  audio.src = url;
}

async function playTrack(track, { autoplay = true, startAt = 0 } = {}) {
  if (!track.audioUrl) { toast('هذا المقطع لا يحتوي على ملف صوتي'); return; }
  currentTrack = track;
  countedListen = null;
  wantsToPlay = autoplay;
  await loadSource(track.audioUrl);
  if (currentTrack !== track) return; // another track was chosen meanwhile
  if (startAt) audio.addEventListener('loadedmetadata', () => { if (currentTrack === track) audio.currentTime = startAt; }, { once: true });
  updateNowPlaying();
  if (autoplay) {
    addToHistory(track);
    audio.play().catch((err) => { if (err.name !== 'AbortError') console.warn('play failed:', err); });
  }
}

// Play `list` starting at `index`; the list becomes the queue. `source` is
// what it was played from (a reciter, a playlist, a radio...), for "recently
// played" and the player's "playing from"; a single track otherwise.
function playFromList(list, index, { shuffleStart = false, source = null } = {}) {
  if (!list.length) return;
  queueOriginal = list.slice();
  if (isShuffle) {
    const start = shuffleStart ? Math.floor(Math.random() * list.length) : index;
    const first = list[start];
    queue = [first, ...shuffled(list.filter((_, i) => i !== start))];
    queueIndex = 0;
  } else {
    queue = list.slice();
    queueIndex = index;
  }
  const from = source || { kind: 'track', id: queue[queueIndex].id };
  rememberPlayedFrom(from);
  playingFrom = source ? recentEntry(source)?.title || '' : '';
  playTrack(queue[queueIndex]);
}

function playNextInQueue(track) {
  if (!currentTrack) { playFromList([track], 0); return; }
  queue.splice(queueIndex + 1, 0, track);
  toast('سيُشغَّل بعد المقطع الحالي');
  updateQueueUI();
}

window.togglePlay = (event) => {
  event?.stopPropagation?.();
  if (!currentTrack) return;
  if (audio.paused) {
    if (!audio.currentSrc || audio.error) playTrack(currentTrack); // (re)load a file that failed
    else audio.play().catch(() => {});
  } else audio.pause();
};
const togglePlay = window.togglePlay;

// Next track: from the queue; at its end repeat-all wraps, autoplay continues
// with similar tracks, otherwise playback stops. Returns whether a track started.
window.playNext = (fromEnded = false) => {
  // Reached by itself, a hidden track is passed over (one picked by hand still plays)
  for (let tries = 0; tries <= queue.length; tries++) {
    if (!advanceQueue(fromEnded)) return false;
    if (!fromEnded || !lib.hidden.has(queue[queueIndex]?.id)) break;
  }
  playTrack(queue[queueIndex]);
  return true;
};

// One step on in the queue (see playNext); false when there is nowhere to go
function advanceQueue(fromEnded) {
  if (queueIndex < queue.length - 1) {
    queueIndex++;
  } else if (repeatMode === 'all' && queue.length) {
    queueIndex = 0;
  } else if (isAutoplay && currentTrack) {
    const played = new Set(queue.map((t) => t.id));
    const more = visible(similarTo(currentTrack, 40)).filter((t) => !played.has(t.id));
    if (!more.length) return false;
    queue.push(...more.slice(0, 10));
    queueIndex++;
  } else {
    if (!fromEnded && queue.length) queueIndex = 0; else return false;
  }
  return true;
}

window.playPrev = () => {
  if (audio.currentTime > 3 || queueIndex === 0) { audio.currentTime = 0; return; }
  queueIndex--;
  playTrack(queue[queueIndex]);
};

window.toggleShuffle = () => {
  isShuffle = !isShuffle;
  if (currentTrack && queue.length > 1) {
    if (isShuffle) {
      queueOriginal = queue.slice();
      queue = [...queue.slice(0, queueIndex + 1), ...shuffled(queue.slice(queueIndex + 1))];
    } else if (queueOriginal) {
      const i = queueOriginal.findIndex((t) => t.id === currentTrack.id);
      if (i !== -1) { queue = queueOriginal.slice(); queueIndex = i; }
    }
    updateQueueUI();
  }
  document.querySelectorAll('.shuffle-toggle').forEach((b) => { b.classList.toggle('on', isShuffle); b.setAttribute('aria-pressed', String(isShuffle)); });
  toast(isShuffle ? 'التشغيل العشوائي مفعّل' : 'التشغيل العشوائي متوقف');
};

window.toggleRepeat = () => {
  repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
  const btn = $('fp-repeat-btn');
  btn.classList.toggle('on', repeatMode !== 'off');
  btn.setAttribute('aria-pressed', String(repeatMode !== 'off'));
  setIcon(btn.querySelector('.ic'), repeatMode === 'one' ? 'repeat-one' : 'repeat');
  toast({ off: 'التكرار متوقف', all: 'تكرار القائمة', one: 'تكرار المقطع الحالي' }[repeatMode]);
};

window.toggleAutoplay = () => {
  isAutoplay = !isAutoplay;
  store.set('sawt_autoplay', isAutoplay);
  paintAutoplay();
};
function paintAutoplay() {
  const sw = $('fp-autoplay-switch');
  sw.classList.toggle('on', isAutoplay);
  sw.setAttribute('aria-checked', String(isAutoplay));
}

// Radio from the track playing: what follows it becomes its song radio
window.startRadio = () => {
  if (!currentTrack) return;
  queue = radioOf(currentTrack, 50);
  queueOriginal = null;
  queueIndex = 0;
  rememberPlayedFrom({ kind: 'radio', id: currentTrack.id });
  playingFrom = `${currentTrack.title} الراديو`;
  $('fp-context').textContent = playingFrom;
  updateQueueUI();
  paintPlayButtons();
  toast(playingFrom);
};

// Repeat-one replays here rather than with audio.loop, which never fires
// 'ended' and so kept the "end of current track" sleep timer from stopping
audio.addEventListener('ended', () => {
  if (sleepAtEnd) { setSleepTimer('off'); return; }
  if (repeatMode === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  playNext(true);
});
audio.addEventListener('play', () => { wantsToPlay = true; paintPlayButtons(); });
audio.addEventListener('pause', () => { paintPlayButtons(); saveLastPosition(); });
audio.addEventListener('playing', () => {
  failedInARow = 0;
  // One listen per play (same counter as the website and the phone app)
  if (currentTrack && countedListen !== currentTrack.id) {
    countedListen = currentTrack.id;
    currentTrack.listens++;
    supabase.rpc('increment_listens', { row_id: Number(currentTrack.id) }).then(({ error }) => {
      if (error) console.warn('increment_listens failed:', error.message);
    });
  }
});
// A file that won't play (missing, or offline and not downloaded) is skipped,
// a few in a row at most so a dead connection doesn't run through the queue
audio.addEventListener('error', () => {
  if (!currentTrack || !audio.error || !wantsToPlay) return; // a restored track reports when played
  if (failedInARow < 3 && playNext(true)) {
    failedInARow++;
    toast('تعذر تشغيل المقطع، انتقلنا إلى التالي');
  } else {
    failedInARow = 0;
    audio.pause(); // a failed load still counts as "playing": show the play button again
    toast(navigator.onLine ? 'تعذر تشغيل هذا المقطع' : 'لا يوجد اتصال، وهذا المقطع غير منزّل');
  }
});

let lastSaved = 0;
audio.addEventListener('timeupdate', () => {
  updateProgressUI();
  if (Date.now() - lastSaved > 5000) saveLastPosition();
});
audio.addEventListener('loadedmetadata', updateProgressUI);

function saveLastPosition() {
  if (!currentTrack) return;
  lastSaved = Date.now();
  store.set('sawt_last', { id: currentTrack.id, t: Math.floor(audio.currentTime || 0) });
}

// Reopening the app shows the last track, paused where it was left
function restoreLastTrack() {
  const last = store.get('sawt_last', null);
  const track = last && trackById.get(String(last.id));
  if (!track || currentTrack) return;
  queue = [track];
  queueIndex = 0;
  playTrack(track, { autoplay: false, startAt: last.t || 0 });
}

function paintPlayButtons() {
  const playing = !audio.paused;
  [$('mp-play-btn'), $('fp-play-btn')].forEach((b) => setIcon(b.querySelector('.ic'), playing ? 'pause' : 'play', { fill: true }));
  const td = $('td-play-btn');
  setIcon(td.querySelector('.ic'), playing && currentTrack?.id === td.dataset.trackId ? 'pause' : 'play', { fill: true });
  document.querySelectorAll('[data-plays]').forEach(paintPlayButton);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

let isDragging = false;
const RING = 2 * Math.PI * 21.75; // the ring's length (r = 21.75 in a 46 box)
function updateProgressUI() {
  const d = audio.duration;
  if (!d || !isFinite(d)) return;
  const pct = (audio.currentTime / d) * 100;
  // The mini player's ring: its gold part grows round the play button
  $('mp-ring-fill').style.strokeDashoffset = String(RING * (1 - Math.min(pct, 100) / 100));
  if (!isDragging) {
    const range = $('fp-progress');
    range.value = pct;
    range.style.setProperty('--pct', `${pct}%`);
    $('fp-current-time').textContent = formatTime(audio.currentTime);
  }
  $('fp-total-time').textContent = formatTime(d);
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(audio.currentTime, d), playbackRate: audio.playbackRate }); } catch { /* ignore */ }
  }
}

const progress = $('fp-progress');
progress.addEventListener('input', (e) => {
  isDragging = true;
  e.target.style.setProperty('--pct', `${e.target.value}%`);
  if (audio.duration) $('fp-current-time').textContent = formatTime((e.target.value / 100) * audio.duration);
});
progress.addEventListener('change', (e) => {
  isDragging = false;
  if (audio.duration && isFinite(audio.duration)) audio.currentTime = (e.target.value / 100) * audio.duration;
});

function updateNowPlaying() {
  const t = currentTrack;
  const mini = $('mini-player');
  if (mini.style.display !== 'flex') { mini.style.display = 'flex'; void mini.offsetWidth; }
  if (!$('full-player-view').classList.contains('open')) mini.classList.add('active');
  document.body.classList.add('has-player');

  $('mp-cover').src = thumb(t.coverImage, 48);
  marquee($('mp-title'), t.title);
  marquee($('mp-reciter'), t.reciterName);
  $('mp-ring-fill').style.strokeDashoffset = String(RING);
  $('fp-context').textContent = playingFrom;
  $('fp-cover').src = thumb(t.coverImage, 400);
  paintPlayerColor(t);
  $('fp-title').textContent = t.title;
  $('fp-artist').textContent = t.reciterName;
  $('fp-artist').onclick = () => closeOverlayThen(() => openArtistDetail(t.reciterName));
  paintPlayerLyrics(t, t.lyrics === undefined);
  paintPlayerExtras(t);
  loadDetails(t).then(() => {
    if (currentTrack !== t) return;
    paintPlayerLyrics(t, false);
    paintCredits(t, reciterForTrack(t));
  });
  $('ly-title').textContent = t.title;
  $('ly-artist').textContent = t.reciterName;
  $('mp-like-btn').dataset.trackId = t.id;
  $('fp-like-btn').dataset.trackId = t.id;
  $('fp-current-time').textContent = '0:00';
  $('fp-total-time').textContent = t.duration || '0:00';

  const similar = $('fp-similar-list');
  similar.innerHTML = '';
  // The reciter's own work is under "explore" above: similar = other reciters
  const others = similarTo(t, 40).filter((x) => x.reciterName !== t.reciterName);
  (others.length >= 3 ? others : similarTo(t, 8)).slice(0, 8)
    .forEach((x) => similar.appendChild(squareCard(x, () => playFromList([x, ...similarTo(x, 20)], 0))));
  updateQueueUI();
  refreshLikeButtons();
  paintPlayButtons();
  markPlayingRows();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.reciterName,
      album: 'صوت الأحزان',
      artwork: [96, 256, 512].map((s) => ({ src: thumb(t.coverImage, s / 2), sizes: `${s}x${s}` })),
    });
  }
}

// Names too long to show whole scroll by, again and again (Spotify's): two
// copies side by side, moving one copy's width plus the gap
function marquee(box, text) {
  box.classList.remove('moving');
  box.innerHTML = `<span class="mq">${esc(text)}</span>`;
  requestAnimationFrame(() => {
    const one = box.firstElementChild;
    if (!one || one.offsetWidth <= box.clientWidth + 1) return;
    const dist = one.offsetWidth + 40;
    box.innerHTML = `<span class="mq-track"><span class="mq">${esc(text)}</span><span class="mq" aria-hidden="true">${esc(text)}</span></span>`;
    box.style.setProperty('--mq-dist', `${dist}px`);
    box.style.setProperty('--mq-time', `${Math.max(dist / 32, 4) / 0.85}s`);
    box.classList.add('moving');
  });
}

function paintPlayerLyrics(t, loading) {
  const text = loading ? 'جارٍ تحميل الكلمات...' : t.lyrics || NO_LYRICS;
  $('fp-lyrics-box').style.display = loading || t.lyrics ? '' : 'none';
  $('fp-lyrics-preview').textContent = text;
  $('lyrics-content').textContent = text;
}

// ─── Full player: about the reciter, credits, more of their work ───
const UNKNOWN_RECITER = 'مجهول';
const reciterForTrack = (t) => reciterOf(t) || { name: t.reciterName, dbId: t.reciterDbId, image: '', count: 0 };

function paintPlayerExtras(t) {
  const r = reciterForTrack(t);
  const known = r.name !== UNKNOWN_RECITER;
  const works = [...tracksOf(t.reciterName)].sort((a, b) => b.listens - a.listens);
  const openReciter = () => closeOverlayThen(() => openArtistDetail(t.reciterName));

  // 1. About the reciter: photo, numbers, bio (or their best-known work)
  $('fp-about').style.display = known ? '' : 'none';
  $('fp-about-img').src = thumb(r.image || t.coverImage, 400);
  $('fp-about-name').textContent = r.name;
  $('fp-about-stats').textContent = `${formatCount(works.length)} مقطع • ${formatCount(works.reduce((sum, x) => sum + x.listens, 0))} استماع`;
  const famous = works.slice(0, 3).map((x) => `«${x.title}»`).join('، ');
  const paintBio = (bio) => {
    const text = bio || (famous && `أشهر أعماله في صوت الأحزان: ${famous}.`);
    $('fp-about-text').textContent = text;
    $('fp-about-text').style.display = text ? '' : 'none';
  };
  paintBio(reciterBios.get(r.dbId));
  if (known) loadReciterBio(r).then((bio) => { if (bio && currentTrack === t) paintBio(bio); });
  $('fp-about').onclick = openReciter;
  $('fp-about-follow').replaceChildren(followButton(r));

  // 2. Credits
  paintCredits(t, r);

  // 3. Explore: the reciter's most listened work
  const explore = works.filter((x) => x.id !== t.id).slice(0, 10);
  $('fp-explore').style.display = known && explore.length >= 2 ? '' : 'none';
  $('fp-explore-title').textContent = `فلنستكشف الإبداعات: من ${r.name}`;
  $('fp-explore-all').onclick = openReciter;
  const list = $('fp-explore-list');
  list.innerHTML = '';
  list.scrollLeft = 0;
  explore.forEach((x, i) => list.appendChild(exploreCard(x, () => playFromList(explore, i))));
  paintFollowButtons();
}

function creditRow(name, role, reciter = null) {
  const row = document.createElement('div');
  row.className = 'credit-row';
  row.innerHTML = `<div class="credit-text"><div class="credit-name ellipsis">${esc(name)}</div><div class="credit-role">${esc(role)}</div></div>`;
  if (reciter) row.appendChild(followButton(reciter, { small: true }));
  return row;
}

function paintCredits(t, r) {
  const box = $('fp-credits-list');
  box.innerHTML = '';
  if (r.name !== UNKNOWN_RECITER) box.appendChild(creditRow(r.name, 'الأداء • رادود رئيسي', r));
  (t.credits || []).forEach((c) => box.appendChild(creditRow(c.name, c.role)));
  box.appendChild(creditRow('صوت الأحزان', 'المصدر'));
  $('fp-credits-all').onclick = () => openCredits(t, r);
  paintFollowButtons();
}

// "Show all": every detail the library has about the track
function openCredits(t, r) {
  $('credits-track').textContent = `${t.title} — ${t.reciterName}`;
  const box = $('credits-full');
  box.innerHTML = '';
  const group = (title, rows) => {
    const g = document.createElement('div');
    g.className = 'credits-group';
    g.innerHTML = `<h3>${esc(title)}</h3>`;
    rows.forEach((row) => g.appendChild(row));
    box.appendChild(g);
  };
  if (r.name !== UNKNOWN_RECITER) group('الأداء', [creditRow(r.name, 'رادود رئيسي', r)]);
  const writers = t.credits || [];
  group('الكلمات والألحان', writers.length ? writers.map((c) => creditRow(c.name, c.role)) : [creditRow('غير مذكور', 'الشاعر • الملحّن')]);
  const cat = categoryOf(t);
  const about = [];
  if (cat) about.push(creditRow(cat.title, 'التصنيف'));
  if (t.duration) about.push(creditRow(t.duration, 'المدة'));
  if (t.addedAt && !Number.isNaN(Date.parse(t.addedAt))) {
    about.push(creditRow(new Date(t.addedAt).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' }), 'تاريخ الإضافة'));
  }
  about.push(creditRow(formatCount(t.listens), 'مرات الاستماع'));
  group('عن المقطع', about);
  group('المصدر', [creditRow('صوت الأحزان', 'النشر')]);
  paintFollowButtons();
  openSheet('credits-modal');
}

function exploreCard(t, onClick) {
  const card = document.createElement('div');
  card.className = 'explore-card';
  const img = esc(thumb(t.coverImage, 160));
  card.innerHTML = `
    <img src="${img}" alt="" class="explore-bg" loading="lazy" />
    <img src="${img}" alt="" class="explore-cover" loading="lazy" />
    <div class="explore-shade"></div>
    <span class="explore-play">${icon('play', { fill: true })}</span>
    <div class="explore-text">
      <div class="explore-title">${esc(t.title)}</div>
      <div class="explore-sub">${t.listens ? `${formatCount(t.listens)} استماع` : esc(t.reciterName)}</div>
    </div>`;
  return clickable(card, onClick);
}

// Every follow button on screen (reciter page, player, credits) shows the same state
function paintFollowButtons() {
  document.querySelectorAll('[data-follow]').forEach(paintFollowButton);
}
// "متابعة", or the gold fill with a check; it pops when they follow
function paintFollowButton(b) {
  const on = lib.follows.has(b.dataset.follow);
  const was = b.dataset.state;
  b.dataset.state = on ? 'on' : 'off';
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', on ? `تتابع ${b.dataset.follow}` : `متابعة ${b.dataset.follow}`);
  if (was === b.dataset.state) return;
  b.classList.toggle('on', on);
  b.innerHTML = on ? icon('tick', { strokeWidth: 3 }) : '<span>متابعة</span>';
  const fresh = was === undefined && followedNow?.name === b.dataset.follow && Date.now() - followedNow.at < 500;
  if (on && (was === 'off' || fresh)) {
    b.classList.remove('pop');
    void b.offsetWidth; // restart the animation
    b.classList.add('pop');
  }
}

function updateQueueUI() {
  if ($('queue-modal').style.display === 'flex') renderQueueSheet();
  const box = $('fp-queue-list');
  box.innerHTML = '';
  const upcoming = queue.slice(queueIndex + 1, queueIndex + 6);
  if (!upcoming.length) {
    box.innerHTML = `<div class="muted" style="text-align: center; padding: 10px;">${isAutoplay ? 'ستُشغَّل مقاطع مشابهة تلقائياً' : 'لا توجد مقاطع تالية في القائمة'}</div>`;
    return;
  }
  upcoming.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'track-item';
    row.innerHTML = `
      <img src="${esc(thumb(t.coverImage, 45))}" class="track-img" style="width: 45px; height: 45px;" alt="" />
      <div class="track-info"><div class="track-title">${esc(t.title)}</div><div class="track-artist">${esc(t.reciterName)}</div></div>`;
    box.appendChild(clickable(row, () => { queueIndex += i + 1; playTrack(queue[queueIndex]); }));
  });
}

function refreshLikeButtons() {
  paintFollowButtons();
  document.querySelectorAll('#mp-like-btn, #fp-like-btn, #td-like-btn').forEach((btn) => {
    const liked = !!btn.dataset.trackId && lib.likes.has(btn.dataset.trackId);
    btn.classList.toggle('liked', liked);
    btn.setAttribute('aria-pressed', String(liked));
    setIcon(btn.querySelector('.ic'), 'heart', { fill: liked });
  });
}
$('mp-like-btn').onclick = (e) => { e.stopPropagation(); if (currentTrack) toggleLike(currentTrack); };
$('fp-like-btn').onclick = () => { if (currentTrack) toggleLike(currentTrack); };

// Lock screen / notification controls
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* unsupported */ } };
  set('play', () => audio.play());
  set('pause', () => audio.pause());
  set('previoustrack', () => playPrev());
  set('nexttrack', () => playNext());
  set('seekbackward', (d) => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); });
  set('seekforward', (d) => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10)); });
  set('seekto', (d) => { audio.currentTime = d.seekTime; });
}

// Full player and lyrics
function openFullPlayer() {
  if (!currentTrack) return;
  const fp = $('full-player-view');
  openOverlay(() => { fp.classList.add('open'); $('mini-player').classList.remove('active'); setThemeColor(nowShades?.vivid); },
    () => { fp.classList.remove('open'); if (currentTrack) $('mini-player').classList.add('active'); setThemeColor(); });
}
$('mini-player').addEventListener('click', (e) => { if (!e.target.closest('button')) openFullPlayer(); });

window.openLyricsView = () => {
  const view = $('lyrics-view');
  openOverlay(() => { view.style.display = 'block'; void view.offsetWidth; view.classList.add('open'); },
    () => { view.classList.remove('open'); setTimeout(() => { view.style.display = 'none'; }, 350); });
};

// ─── Now-playing colour ───
// Taken from the cover (see color.js) and laid behind the player as a gradient
// into the dark, as Spotify does; the mini player, the lyrics card and the
// phone's status bar take shades of it.
let nowShades = null;
let shadesFor = null;          // the track the colour is being worked out for

// Worked out once per cover and kept on the device
const COLOR_STORE = 'sawt_cover_colors_v2'; // v2: with the pages' bright and light shades
const coverShades = new Map(Object.entries(store.get(COLOR_STORE, {})));
function rememberShades(url, shades) {
  coverShades.set(url, shades);
  while (coverShades.size > 500) coverShades.delete(coverShades.keys().next().value); // oldest first
  store.set(COLOR_STORE, Object.fromEntries(coverShades));
}

// When no copy of the cover can be read: a calm colour of its own for each
// reciter, so the player is never plain
const FALLBACK_HUES = [0.02, 0.08, 0.3, 0.45, 0.55, 0.62, 0.75, 0.9];
function fallbackShades(t) {
  let h = 0;
  for (const ch of t.reciterName) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return playerShades([FALLBACK_HUES[h % FALLBACK_HUES.length], 0.35, 0.28]);
}

// Reading a cover's pixels needs its server to allow it (CORS). Small copies
// are tried in turn: the site's own resized one (soutalahzan.com does not
// allow it yet), then a public image service that does (wsrv.nl).
function colorSampleUrls(url) {
  let own;
  try {
    own = IMAGE_HOSTS.has(new URL(url).hostname)
      ? `https://soutalahzan.com/cdn-cgi/image/width=48,quality=70,format=auto,fit=scale-down/${url}`
      : url;
  } catch { return []; } // not a full URL
  return [own, `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=48&h=48&fit=cover&output=jpg&q=70`];
}

function readShades(src) {
  return new Promise((resolve) => {
    const img = new Image();
    const done = (value) => { clearTimeout(timer); img.onload = img.onerror = null; resolve(value); };
    const timer = setTimeout(() => done(null), 8000);
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try { const hsl = dominantHsl(img); done(hsl ? playerShades(hsl) : null); } catch { done(null); } // pixels not readable
    };
    img.onerror = () => done(null);
    img.src = src;
  });
}

const unreadableCovers = new Set(); // tried this session with no luck: not again until the next one
async function coverShadesFor(t) {
  const url = t.coverImage;
  if (!url || unreadableCovers.has(url)) return fallbackShades(t);
  if (coverShades.has(url)) return coverShades.get(url);
  for (const src of colorSampleUrls(url)) {
    const shades = await readShades(src);
    if (shades) { rememberShades(url, shades); return shades; }
  }
  unreadableCovers.add(url);
  return fallbackShades(t);
}

function paintPlayerColor(t) {
  shadesFor = t;
  coverShadesFor(t).then((sh) => {
    if (shadesFor !== t) return;
    nowShades = sh;
    const root = document.documentElement.style;
    root.setProperty('--np-top', sh.vivid);
    root.setProperty('--np-mini', sh.mini);
    root.setProperty('--np-card', sh.card);
    if ($('full-player-view').classList.contains('open')) setThemeColor(sh.vivid);
  });
}

function setThemeColor(color = '#121212') {
  document.querySelector('meta[name="theme-color"]').setAttribute('content', color || '#121212');
}

// ─── Listening queue ───
function queueRow(t, onClick) {
  const row = document.createElement('div');
  row.className = 'track-item';
  row.dataset.trackId = t.id;
  row.innerHTML = `
    <img src="${esc(thumb(t.coverImage, 45))}" class="track-img" alt="" />
    <div class="track-info"><div class="track-title">${esc(t.title)}</div><div class="track-artist">${esc(t.reciterName)}</div></div>`;
  return onClick ? clickable(row, onClick) : row;
}

function renderQueueSheet() {
  if (!currentTrack) return;
  $('queue-now').replaceChildren(queueRow(currentTrack));
  const box = $('queue-next');
  box.innerHTML = '';
  const upcoming = queue.slice(queueIndex + 1, queueIndex + 101);
  $('queue-next-label').textContent = upcoming.length ? `التالي (${formatCount(queue.length - queueIndex - 1)})` : 'التالي';
  if (!upcoming.length) {
    box.innerHTML = `<div class="muted" style="padding: 6px 0 12px;">${isAutoplay ? 'ستُشغَّل مقاطع مشابهة تلقائياً' : 'لا توجد مقاطع تالية'}</div>`;
  }
  upcoming.forEach((t, i) => box.appendChild(queueRow(t, () => { queueIndex += i + 1; playTrack(queue[queueIndex]); })));
  markPlayingRows();
}

window.openQueue = () => {
  if (!currentTrack) return;
  renderQueueSheet();
  openSheet('queue-modal');
};

// ─── Connect to a device: Cast (Chrome) or AirPlay (Safari) where offered ───
// Bluetooth needs nothing from the page: the phone routes the sound itself.
document.body.appendChild(audio); // remote playback needs the element in the page
audio.hidden = true;
audio.setAttribute('x-webkit-airplay', 'allow');
const remote = audio.remote;
let remoteOffered = !!audio.webkitShowPlaybackTargetPicker;
try {
  remote?.watchAvailability((available) => { remoteOffered = available; })
    .catch(() => { remoteOffered = true; }); // can't watch: a prompt may still find devices
} catch { /* no remote playback */ }

function paintRemote() {
  const connected = remote?.state === 'connected';
  $('fp-devices-btn').classList.toggle('on', connected);
  $('device-this').classList.toggle('current', !connected);
  $('device-this-sub').textContent = connected ? 'الصوت يُشغَّل على جهاز آخر' : 'يتم التشغيل عليه الآن';
  const other = $('device-remote');
  other.style.display = remoteOffered || connected ? 'flex' : 'none';
  other.classList.toggle('current', connected);
  $('device-remote-name').textContent = connected ? 'متصل بجهاز آخر' : 'البحث عن أجهزة قريبة';
  $('device-remote-sub').textContent = connected ? 'اضغط لقطع الاتصال أو اختيار جهاز آخر' : 'تلفاز أو سماعة ذكية على شبكة الـ Wi-Fi نفسها';
}
remote?.addEventListener?.('connect', () => { paintRemote(); toast('تم الاتصال بالجهاز'); });
remote?.addEventListener?.('disconnect', () => { paintRemote(); toast('عاد التشغيل إلى هذا الجهاز'); });

window.openDevices = () => { paintRemote(); openSheet('devices-modal'); };
$('device-remote').onclick = () => {
  if (audio.webkitShowPlaybackTargetPicker) { audio.webkitShowPlaybackTargetPicker(); return; }
  if (!remote) return;
  remote.prompt().catch((e) => {
    if (e.name === 'NotFoundError') toast('لم يُعثر على أجهزة قريبة');
    else if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') toast('لا يمكن الاتصال بجهاز آخر من هذا المتصفح');
  });
};

// ═══ Sleep timer ═════════════════════════════════════════════════════════════
let sleepTimeout = null;
let sleepEndsAt = 0;
let sleepAtEnd = false;
let sleepTicker = null;

function setSleepTimer(value) {
  clearTimeout(sleepTimeout);
  clearInterval(sleepTicker);
  sleepTimeout = null;
  sleepEndsAt = 0;
  sleepAtEnd = false;
  if (value === 'off') {
    // cleared above
  } else if (value === 'end') {
    sleepAtEnd = true;
    toast('سيتوقف التشغيل بنهاية المقطع الحالي');
  } else {
    const minutes = Number(value);
    sleepEndsAt = Date.now() + minutes * 60000;
    sleepTimeout = setTimeout(() => { audio.pause(); setSleepTimer('off'); toast('توقف التشغيل (مؤقت النوم)'); }, minutes * 60000);
    sleepTicker = setInterval(paintSleepTimer, 15000);
    toast(`سيتوقف التشغيل بعد ${minutes === 60 ? 'ساعة' : `${minutes} دقيقة`}`);
  }
  paintSleepTimer();
}

function paintSleepTimer() {
  let label = '';
  if (sleepAtEnd) label = 'نهاية المقطع';
  else if (sleepEndsAt) label = `${Math.max(1, Math.ceil((sleepEndsAt - Date.now()) / 60000))} د`;
  $('sleep-timer-label').textContent = label || 'متوقف';
  const badge = $('fp-sleep-badge');
  badge.style.display = label ? 'flex' : 'none';
  badge.querySelector('span').textContent = label;
}

window.openSleepTimerSheet = () => openSheet('sleep-modal');
document.querySelectorAll('[data-sleep]').forEach((b) => {
  b.onclick = () => closeOverlayThen(() => setSleepTimer(b.dataset.sleep));
});
$('fp-sleep-badge').onclick = () => openSleepTimerSheet();

// ═══ Account ═════════════════════════════════════════════════════════════════
let authMode = 'login';
const displayName = () => profile?.display_name || currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || '';
const avatarUrl = () => profile?.avatar_url || currentUser?.user_metadata?.custom_avatar_url
  || currentUser?.user_metadata?.avatar_url || initialAvatar(displayName());

async function loadProfile() {
  profile = null;
  if (!currentUser || currentUser.is_anonymous) return;
  const { data } = await supabase.from('profiles').select('display_name,avatar_url').eq('id', currentUser.id).maybeSingle();
  profile = data || null;
}

async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user ?? null;
  await loadProfile();
  updateProfileUI();
  if (currentUser) syncFromCloud();
  if (isPasswordRecovery && currentUser) askNewPassword();

  supabase.auth.onAuthStateChange(async (event, s) => {
    const before = currentUser?.id;
    currentUser = s?.user ?? null;
    if (currentUser?.id === before) {
      if (event === 'USER_UPDATED') updateProfileUI(); // name or photo changed
      return;
    }
    await loadProfile();
    updateProfileUI();
    if (currentUser) syncFromCloud();
    else {
      // Signed out: back to this device's guest data
      lib.likes = new Set(store.get('sawt_likes', []).map(String));
      lib.playlists = store.get('sawt_playlists', []);
      lib.follows = new Set(store.get('sawt_artists', []));
      libVersion++;
      refreshLikeButtons();
      refreshOpenViews();
    }
  });

  // Offer sign-in once, on the first visit (checked when it would show: the
  // listener may have signed in or dismissed it in the meantime)
  setTimeout(() => {
    if (!currentUser && !isPasswordRecovery && !store.get('sawt_auth_skipped', false) && $('auth-modal').style.display !== 'flex') openAuthModal();
  }, 1200);
}

function updateProfileUI() {
  const signedIn = !!currentUser && !currentUser.is_anonymous;
  const name = signedIn ? displayName() || 'مستخدم' : 'ضيف';
  $('profile-display-name').textContent = name;
  $('profile-email').textContent = signedIn ? currentUser.email || '—' : 'غير مسجل';
  $('profile-status-badge').innerHTML = signedIn
    ? `${icon('check')} حساب مسجّل`
    : 'سجّل الدخول لحفظ مكتبتك على كل أجهزتك';
  $('profile-guest-section').style.display = signedIn ? 'none' : 'block';
  $('profile-logout-section').style.display = signedIn ? 'block' : 'none';
  $('profile-edit-name').style.display = signedIn ? 'flex' : 'none';
  $('profile-email-row').style.display = signedIn ? 'flex' : 'none';
  $('profile-camera-btn').style.display = signedIn ? 'flex' : 'none';
  $('profile-avatar-img').src = signedIn ? avatarUrl() : `${import.meta.env.BASE_URL}icon-192.png`;
  document.querySelectorAll('.avatar-btn').forEach((b) => {
    b.innerHTML = signedIn ? `<img src="${esc(avatarUrl())}" alt="" />` : icon('user');
  });
  $('stat-listened').textContent = formatCount(lib.history.length);
  $('stat-likes').textContent = formatCount(likesCount());
  $('stat-playlists').textContent = formatCount(lib.playlists.length);
  $('hidden-count').textContent = lib.hidden.size ? formatCount(lib.hidden.size) : '';
  $('excluded-count').textContent = lib.excluded.size ? formatCount(lib.excluded.size) : '';
  paintSleepTimer();
}

window.editDisplayName = () => openPrompt({
  title: 'تعديل الاسم', value: displayName(), placeholder: 'اسمك',
  onSubmit: async (name) => {
    const { error } = await supabase.from('profiles').update({ display_name: name.slice(0, 100) }).eq('id', currentUser.id);
    if (error) { toast('تعذر حفظ الاسم'); return; }
    await supabase.auth.updateUser({ data: { full_name: name } });
    profile = { ...(profile || {}), display_name: name };
    updateProfileUI();
    toast('تم حفظ الاسم');
  },
});

window.openAvatarUpload = () => {
  if (!currentUser) { openAuthModal(); return; }
  $('avatar-file-input').click();
};

// The photo goes to the site's storage (Cloudflare R2) through its upload endpoint
window.handleAvatarUpload = async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || !currentUser) return;
  if (file.size > 10 * 1024 * 1024) { toast('الصورة أكبر من 10 ميغابايت'); return; }
  const img = $('profile-avatar-img');
  img.style.opacity = '0.4';
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const res = await fetch(`${SITE_URL}/api/upload?kind=image&ext=${ext}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type, Authorization: `Bearer ${session.access_token}` },
      body: file,
    });
    if (!res.ok) throw new Error(`upload ${res.status}`);
    const { url } = await res.json();
    const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', currentUser.id);
    if (error) throw error;
    // Also on the account itself: kept even where the profile row doesn't exist.
    // A separate key, since Google sign-in rewrites avatar_url with its own photo
    await supabase.auth.updateUser({ data: { custom_avatar_url: url } });
    profile = { ...(profile || {}), avatar_url: url };
    updateProfileUI();
    toast('تم تحديث الصورة');
  } catch (err) {
    console.error('Avatar upload error:', err);
    toast('تعذر رفع الصورة');
  } finally {
    img.style.opacity = '1';
  }
};

window.openAuthModal = () => {
  resetAuthForm();
  $('auth-modal').style.display = 'flex';
  void $('auth-modal').offsetWidth;
  $('auth-sheet').classList.add('open');
};
function closeAuthModal() {
  $('auth-sheet').classList.remove('open');
  setTimeout(() => { $('auth-modal').style.display = 'none'; }, 400);
}
$('auth-modal').addEventListener('click', (e) => { if (e.target.id === 'auth-modal') skipAuth(); });

window.skipAuth = () => { store.set('sawt_auth_skipped', true); closeAuthModal(); };

function paintAuthMode() {
  const signup = authMode === 'signup';
  $('auth-name-field').style.display = signup ? 'block' : 'none';
  $('auth-btn-text').textContent = signup ? 'إنشاء الحساب' : 'دخول';
  $('auth-toggle-text').textContent = signup ? 'لديك حساب؟' : 'ليس لديك حساب؟';
  $('auth-toggle-btn').textContent = signup ? 'دخول' : 'إنشاء حساب';
  $('auth-title').textContent = signup ? 'إنشاء حساب جديد' : 'أهلاً بك في صوت الأحزان';
  $('auth-password').autocomplete = signup ? 'new-password' : 'current-password';
  $('auth-forgot-btn').style.display = signup ? 'none' : 'inline-block';
}
window.toggleAuthMode = () => { authMode = authMode === 'login' ? 'signup' : 'login'; paintAuthMode(); $('auth-message').style.display = 'none'; };

function resetAuthForm() {
  ['auth-email', 'auth-password', 'auth-name'].forEach((id) => { $(id).value = ''; });
  $('auth-message').style.display = 'none';
  authMode = 'login';
  paintAuthMode();
}

function showAuthMessage(msg, isError = true) {
  const el = $('auth-message');
  el.textContent = msg;
  el.className = isError ? 'auth-msg error' : 'auth-msg ok';
  el.style.display = 'block';
}

function setAuthLoading(loading) {
  $('auth-submit-btn').disabled = loading;
  $('auth-btn-spinner').style.display = loading ? 'inline-flex' : 'none';
}

window.signInWithGoogle = async () => {
  $('auth-message').style.display = 'none';
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: APP_URL } });
  if (error) { showAuthMessage('فشل تسجيل الدخول بواسطة جوجل'); console.error(error); }
};

// Supabase's messages are English: the listener gets the Arabic meaning
function authErrorText(err) {
  const m = (err?.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  if (m.includes('already registered') || m.includes('already been registered')) return 'هذا البريد الإلكتروني مسجل مسبقاً، سجّل الدخول بدلاً من ذلك';
  if (m.includes('not confirmed')) return 'يرجى تأكيد البريد الإلكتروني أولاً من الرسالة التي وصلتك';
  if (err?.status === 429 || m.includes('rate limit') || m.includes('security purposes')) return 'محاولات كثيرة، انتظر قليلاً ثم حاول مجدداً';
  if (m.includes('invalid format') || m.includes('valid email')) return 'صيغة البريد الإلكتروني غير صحيحة';
  if (m.includes('should be different')) return 'اختر كلمة مرور مختلفة عن السابقة';
  if (m.includes('password')) return 'كلمة المرور ضعيفة، اختر كلمة أطول وأقوى';
  if (m.includes('fetch') || m.includes('network')) return 'تعذر الاتصال، تحقق من الإنترنت';
  return 'حدث خطأ، يرجى المحاولة مجدداً';
}

window.forgotPassword = async () => {
  const email = $('auth-email').value.trim();
  if (!email) { showAuthMessage('اكتب بريدك الإلكتروني أولاً، ثم اضغط «نسيت كلمة المرور؟»'); $('auth-email').focus(); return; }
  setAuthLoading(true);
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: APP_URL });
  setAuthLoading(false);
  if (error) showAuthMessage(authErrorText(error));
  else showAuthMessage('أرسلنا إلى بريدك رابطاً لتعيين كلمة مرور جديدة', false);
};

// Opened from the reset e-mail's link: the listener is signed in and picks a new password
function askNewPassword() {
  openPrompt({
    title: 'كلمة مرور جديدة', hint: 'اختر كلمة مرور جديدة لحسابك (6 أحرف على الأقل).', type: 'password', minLength: 6,
    onSubmit: async (password) => {
      const { error } = await supabase.auth.updateUser({ password });
      toast(error ? authErrorText(error) : 'تم تغيير كلمة المرور');
    },
  });
}

window.submitAuth = async () => {
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  const name = $('auth-name').value.trim();
  if (!email || !password) { showAuthMessage('يرجى تعبئة جميع الحقول'); return; }
  if (password.length < 6) { showAuthMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }

  setAuthLoading(true);
  $('auth-message').style.display = 'none';
  try {
    if (authMode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name || email.split('@')[0] } } });
      if (error) throw error;
      // With e-mail confirmation on, Supabase answers an existing address with a
      // user that has no identities instead of an error
      if (data.user && !data.session && data.user.identities?.length === 0) throw new Error('already registered');
      if (data.session) { closeAuthModal(); toast('أهلاً بك! تم إنشاء حسابك'); }
      else showAuthMessage('تم إنشاء الحساب! تفقد بريدك لتفعيله ثم سجّل الدخول.', false);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      closeAuthModal();
      toast('تم تسجيل الدخول');
    }
  } catch (err) {
    showAuthMessage(authErrorText(err));
  }
  setAuthLoading(false);
};

window.doLogout = async () => {
  await supabase.auth.signOut();
  toast('تم تسجيل الخروج');
};

window.toggleAuthPasswordVisibility = () => {
  const input = $('auth-password');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  setIcon($('auth-eye-icon'), show ? 'eye-off' : 'eye');
};

// ═══ Links into the app ══════════════════════════════════════════════════════
// ?track=<id> | ?reciter=<id> | ?q=<search> (the website forwards phones here)
function handleDeepLink() {
  const params = new URLSearchParams(location.search);
  const trackId = params.get('track');
  const reciterId = params.get('reciter');
  const q = params.get('q');
  if (!trackId && !reciterId && !q) return;
  history.replaceState(null, '', location.pathname); // don't reopen on refresh
  if (trackId) {
    const track = trackById.get(trackId);
    if (track) openTrackDetail(track);
    else {
      supabase.from('audio_library').select(TRACK_COLUMNS).eq('id', trackId).maybeSingle()
        .then(({ data }) => { if (data) openTrackDetail(mapTrack(data)); else toast('هذا المقطع غير موجود، ربما حُذف'); });
    }
  } else if (reciterId) {
    const r = reciters.find((x) => x.dbId === reciterId);
    if (r) openArtistDetail(r.name); else toast('هذا الرادود غير موجود');
  } else if (q) {
    openSearchPage(q, true);
  }
}

// ═══ Keyboard ════════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = t.matches?.('input, textarea, select, [contenteditable]');
  if ((e.key === 'Enter' || e.key === ' ') && t.matches?.('[role="button"]:not(button), [role="switch"]')) {
    e.preventDefault();
    t.click();
  } else if (e.key === 'Escape') {
    if ($('auth-modal').style.display === 'flex') skipAuth();
    else if (navStack.at(-1)?.type === 'overlay') history.back();
  } else if (e.key === ' ' && !typing && !t.closest?.('button, a, [role="button"], [role="switch"]') && currentTrack) {
    e.preventDefault(); // Space plays / pauses, as in other players
    togglePlay();
  }
});

// ═══ Boot ════════════════════════════════════════════════════════════════════
// A cover that can't load (missing file, or offline) shows the app icon instead
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName === 'IMG' && img.getAttribute('src') && img.getAttribute('src') !== FALLBACK_COVER) img.src = FALLBACK_COVER;
}, true);

// A reload keeps the old page's history entries behind this one; marking this
// one clean lets the back button step over them (see popstate)
history.replaceState(null, '');
startIcons();
paintAutoplay();
initAuth();
loadData();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn('SW registration failed:', e));
  });
}
