import { supabase, isPasswordRecovery } from './supabaseClient.js';
import { icon, setIcon, startIcons } from './icons.js';
import { dominantHsl, playerShades } from './color.js';

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
const SIZE_STEPS = [96, 160, 320, 480, 640, 800, 1080];
function thumb(url, cssWidth) {
  if (!url) return FALLBACK_COVER;
  try {
    if (!IMAGE_HOSTS.has(new URL(url).hostname)) return url;
  } catch { return url; }
  const px = SIZE_STEPS.find((s) => s >= cssWidth * 2) ?? 1080;
  return `https://soutalahzan.com/cdn-cgi/image/width=${px},quality=75,format=auto,fit=scale-down/${url}`;
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

const tracksOf = (name) => allTracks.filter((t) => t.reciterName === name);
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

async function createPlaylist(name) {
  const pl = { id: `pl_${Date.now()}`, name, tracks: [] };
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

async function toggleFollow(reciter) {
  const following = !lib.follows.has(reciter.name);
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
    libraryChanged();
    // Ask the browser not to clear downloads when the device runs low on space
    navigator.storage?.persist?.()?.catch(() => {});
    toast('تم التنزيل، يمكنك الاستماع بدون إنترنت');
    return true;
  } catch (e) {
    console.warn('Download failed:', e);
    toast('تعذر تنزيل المقطع');
    return false;
  }
}

function addToHistory(track) {
  lib.history = [{ id: track.id, t: Date.now() }, ...lib.history.filter((h) => h.id !== track.id)].slice(0, 100);
  lib.saveLocal();
}
const historyTracks = () => lib.history.map((h) => trackById.get(h.id)).filter(Boolean);

// ═══ Navigation ══════════════════════════════════════════════════════════════
// Tabs are the four bottom-bar screens. Pages (reciter, category, track, list)
// and overlays (player, sheets, modals) go on a stack mirrored in browser
// history, so the phone's back button closes / goes back one step.
const TABS = { home: 'home-view', search: 'search-view', library: 'library-view', profile: 'profile-view' };
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
const tabStamp = () => `${dataVersion}|${libVersion}|${lib.history[0]?.id || ''}`;
const pageStamp = (e) => `${dataVersion}|${e.library ? libVersion : ''}`;
const mainEl = () => document.querySelector('.main-container');
const topPage = () => [...navStack].reverse().find((e) => e.type === 'page');

function showView(viewId, scrollTop = 0) {
  document.querySelectorAll('.view').forEach((v) => { v.style.display = v.id === viewId ? 'block' : 'none'; });
  mainEl().scrollTo(0, scrollTop);
}

function drawPage(entry) {
  entry.render();
  entry.drawn = pageStamp(entry);
  viewShows[entry.viewId] = entry;
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
  document.querySelectorAll('.nav-item').forEach((n, i) => n.classList.toggle('active', Object.keys(TABS)[i] === tab));
}

window.goHome = () => { goTab('home'); if (tabDrawnAt.home !== tabStamp()) renderHome(); };
window.goSearch = () => { goTab('search'); renderTab(); };
window.goLibrary = () => { goTab('library'); renderTab(); };
window.goProfile = () => { goTab('profile'); renderTab(); };

function renderTab() {
  if (currentTab === 'home') renderHome();
  else if (currentTab === 'library') renderLibrary();
  else if (currentTab === 'search') { renderSearchHome(); runSearch(); }
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
  else if (!top && (currentTab === 'library' || currentTab === 'profile')) renderTab();
}

// ═══ Shared list rendering ═══════════════════════════════════════════════════
// Track rows: tap plays the list from that row; ⋮ opens the options sheet.
// Long lists render in chunks as you scroll.
function renderTrackList(container, list, { numbered = false, emptyText = 'لا توجد مقاطع هنا بعد', playlist = null } = {}) {
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
      const meta = [esc(track.reciterName), track.duration && `<span dir="ltr">${track.duration}</span>`].filter(Boolean).join(' • ');
      el.innerHTML = `
        ${numbered ? `<div class="track-number">${index + 1}</div>` : ''}
        <img src="${esc(thumb(track.coverImage, 50))}" class="track-img" alt="" loading="lazy" />
        <div class="track-info">
          <div class="track-title">${esc(track.title)}</div>
          <div class="track-artist">${meta}</div>
        </div>
        <button class="icon-btn row-more" aria-label="خيارات">${icon('more')}</button>`;
      clickable(el, () => playFromList(list, index));
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

  const recent = historyTracks();
  const liked = likedTracks();

  // 1. Quick grid: what you played last, otherwise the newest
  const grid = document.createElement('div');
  grid.className = 'recent-grid section animate-in';
  (recent.length >= 4 ? recent : allTracks).slice(0, 6).forEach((t) => {
    const card = document.createElement('div');
    card.className = 'recent-card';
    card.innerHTML = `<img src="${esc(thumb(t.coverImage, 70))}" alt="" class="recent-img" /><div class="recent-title">${esc(t.title)}</div>`;
    clickable(card, () => openTrackDetail(t));
    grid.appendChild(card);
  });
  container.appendChild(grid);

  // 2. Newest uploads
  const newest = allTracks.slice(0, 15);
  container.appendChild(section('مضاف حديثاً', scroller(newest, (t) => {
    const card = document.createElement('div');
    card.className = 'wide-card';
    card.innerHTML = `
      <img src="${esc(thumb(t.coverImage, 320))}" alt="" loading="lazy" />
      <div class="wide-card-text"><div class="ellipsis wide-title">${esc(t.title)}</div><div class="ellipsis muted">${esc(t.reciterName)}</div></div>`;
    return clickable(card, () => openTrackDetail(t));
  }), () => openListPage('مضاف حديثاً', allTracks.slice(0, 100))));

  // 3. Top reciters (with a real photo first)
  const topReciters = reciters.filter((r) => r.count > 0).sort((a, b) => (b.hasPhoto - a.hasPhoto) || (b.count - a.count)).slice(0, 12);
  container.appendChild(section('أشهر الرواديد', scroller(topReciters, reciterCard), () => openAllReciters()));

  // 4. The listener's own history
  if (recent.length) {
    container.appendChild(section('تم الاستماع إليه مؤخراً', columnsScroller(recent.slice(0, 25)), () => openListPage('تم الاستماع إليه مؤخراً', recent)));
  }

  // 5. Made for you: more from the reciters you listen to most
  if (recent.length) {
    const favReciters = [...new Set(recent.map((t) => t.reciterName))].slice(0, 3);
    const played = new Set(recent.map((t) => t.id));
    const picks = seededShuffle(allTracks.filter((t) => favReciters.includes(t.reciterName) && !played.has(t.id)), todaySeed()).slice(0, 15);
    if (picks.length >= 3) container.appendChild(section(`مصمم من أجل ${displayName() || 'الضيف'}`, scroller(picks, (t) => squareCard(t))));
  }

  // 6. Your likes
  if (liked.length) {
    container.appendChild(section('استمع للقصائد التي أحببتها', scroller(liked.slice(0, 15), (t) => squareCard(t)), () => openLikesPage()));
  }

  // 7. Most listened (real listen counts)
  if (popularTracks.length) {
    container.appendChild(section('الأكثر استماعاً', columnsScroller(popularTracks.slice(0, 25)), () => openListPage('الأكثر استماعاً', popularTracks)));
  }

  // 8. Today's picks: stable for the whole day
  const daily = seededShuffle(popularTracks.length > 15 ? popularTracks : allTracks.slice(0, 200), todaySeed()).slice(0, 15);
  container.appendChild(section('توصياتنا لك اليوم', scroller(daily, (t) => squareCard(t))));

  // 9. More from the most listened reciter (or the one you play most)
  const focus = reciterByName.get(recent[0]?.reciterName) || topReciters[0];
  if (focus) {
    const more = [...tracksOf(focus.name)].sort((a, b) => b.listens - a.listens).slice(0, 15);
    if (more.length >= 3) container.appendChild(section(`المزيد من ${focus.name}`, scroller(more, (t) => squareCard(t)), () => openArtistDetail(focus.name)));
  }

  // 10. Duas
  const duas = allTracks.filter((t) => CATEGORIES[1].values.includes(t.category)).slice(0, 15);
  if (duas.length >= 3) container.appendChild(section('أدعية ومناجاة', scroller(duas, (t) => squareCard(t)), () => openCategoryDetail(CATEGORIES[1])));
}

// Several short rows per column, scrolling sideways
function columnsScroller(list) {
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
      clickable(item, () => playFromList(list, c * 5 + i));
      item.querySelector('.row-more').onclick = (e) => { e.stopPropagation(); openTrackOptions(t); };
      col.appendChild(item);
    });
    row.appendChild(col);
  }
  return row;
}

// ═══ Pages ═══════════════════════════════════════════════════════════════════
let playlistPage = null; // { title, list, playlist? }

function openListPage(title, list, playlist = null, library = false) {
  openPage('playlist-detail-view', () => renderListPage(title, typeof list === 'function' ? list() : list, playlist), { library });
}
const likedTracks = () => [...lib.likes].map((id) => trackById.get(id)).filter(Boolean).reverse();
// Once the whole library is in, likes of deleted tracks no longer count
const likesCount = () => (fullyLoaded ? likedTracks().length : lib.likes.size);
const playlistTracks = (pl) => pl.tracks.map((id) => trackById.get(id)).filter(Boolean);
const openLikesPage = () => openListPage('المقاطع المفضلة', likedTracks, null, true);
const openDownloadsPage = () => openListPage('التنزيلات', downloadedTracks, null, true);
const openPlaylistPage = (pl) => openListPage(pl.name, () => playlistTracks(pl), pl, true);

function renderListPage(title, list, playlist) {
  playlistPage = { title, list, playlist };
  $('playlist-tracks').className = 'track-list';
  $('playlist-search').parentElement.style.display = 'block';
  $('playlist-title').textContent = title;
  $('playlist-subtitle').textContent = `${formatCount(list.length)} مقطع`;
  $('playlist-search').value = '';
  renderTrackList($('playlist-tracks'), list, { numbered: true, playlist });
  $('playlist-play-all').onclick = () => playFromList(list, 0, { shuffleStart: isShuffle });
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
  renderTrackList($('playlist-tracks'), list, { numbered: true, playlist: playlistPage.playlist, emptyText: 'لا توجد نتائج' });
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

let artistShown = null;
window.openArtistDetail = (name) => openPage('artist-view', () => renderArtist(name));

function renderArtist(name) {
  artistShown = name;
  const r = reciterByName.get(name) || { name, image: '', count: 0 };
  const list = [...tracksOf(name)].sort((a, b) => b.listens - a.listens);
  $('artist-detail-name').textContent = name;
  $('artist-detail-stats').textContent = `${formatCount(list.length)} مقطع • ${formatCount(list.reduce((s, t) => s + t.listens, 0))} استماع`;
  $('artist-detail-image').src = thumb(r.image || list[0]?.coverImage, 400);
  renderTrackList($('artist-tracks'), list, { numbered: true });
  $('artist-play-all').onclick = () => playFromList(list, 0, { shuffleStart: isShuffle });
  const follow = $('artist-follow-btn');
  follow.dataset.follow = name;
  follow.dataset.followIcon = '';
  follow.onclick = () => toggleFollow(r);
  paintFollowButtons();
  $('artist-share-btn').onclick = () => share(`${name} | صوت الأحزان`, `استمع إلى قصائد ${name}`, r.dbId ? `${SITE_URL}/reciter?id=${r.dbId}` : APP_URL);
}

window.openCategoryDetail = (cat) => openPage('category-view', () => renderCategory(cat));

function renderCategory(cat) {
  const list = allTracks.filter((t) => cat.values.includes(t.category));
  $('category-detail-name').textContent = cat.title;
  $('category-detail-stats').textContent = `${formatCount(list.length)} مقطع`;
  $('category-detail-image').src = thumb(list[0]?.coverImage, 400);
  $('category-view').querySelector('.hero-image').style.background = cat.color;
  renderTrackList($('category-tracks'), list, { numbered: true, emptyText: 'لا توجد مقاطع في هذا التصنيف بعد' });
  $('category-play-all').onclick = () => playFromList(list, 0, { shuffleStart: isShuffle });
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

  const paintLyrics = () => {
    $('td-lyrics-section').style.display = track.lyrics ? 'block' : 'none';
    $('td-lyrics').textContent = track.lyrics || '';
  };
  paintLyrics();
  loadDetails(track).then(() => { if ($('td-play-btn').dataset.trackId === track.id) paintLyrics(); });

  const playBtn = $('td-play-btn');
  playBtn.dataset.trackId = track.id;
  playBtn.onclick = () => {
    if (currentTrack?.id === track.id) togglePlay();
    else playFromList([track, ...similarTo(track, 30)], 0);
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

  const similar = similarTo(track, 6);
  renderTrackList($('td-similar-list'), similar);

  const trending = tracksOf(track.reciterName).filter((t) => t.id !== track.id).sort((a, b) => b.listens - a.listens).slice(0, 10);
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

// Same reciter first, then the same category (any of its Arabic or English
// values), in a fixed order per track
function similarTo(track, n) {
  const same = tracksOf(track.reciterName).filter((t) => t.id !== track.id);
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

let searchTimer;
$('main-search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 150);
});

function runSearch() {
  const raw = $('main-search-input').value.trim();
  const results = $('search-results');
  const browsing = !raw;
  $('genre-grid').style.display = browsing ? 'grid' : 'none';
  $('search-section-title').style.display = browsing ? 'block' : 'none';
  results.style.display = browsing ? 'none' : 'block';
  if (browsing) return;

  const words = normalize(raw).split(/\s+/).filter(Boolean);
  const has = (n) => words.every((w) => n.includes(w));
  const foundReciters = reciters.filter((r) => has(normalize(r.name))).slice(0, 8);
  const foundTracks = allTracks.filter((t) => has(searchKey(t)));

  results.innerHTML = '';
  if (!foundReciters.length && !foundTracks.length) {
    results.innerHTML = `<div class="empty-state">لم يتم العثور على نتائج${fullyLoaded ? '' : '، ما زالت المكتبة تُحمَّل'}</div>`;
    return;
  }
  if (foundReciters.length) results.appendChild(section('الرواديد', scroller(foundReciters, reciterCard)));
  if (foundTracks.length) {
    const wrap = document.createElement('div');
    wrap.className = 'track-list';
    results.appendChild(section(`المقاطع (${formatCount(foundTracks.length)})`, wrap));
    renderTrackList(wrap, foundTracks);
  }
}

// ═══ Library tab ═════════════════════════════════════════════════════════════
document.querySelectorAll('.filter-chip').forEach((chip) => {
  chip.onclick = () => {
    document.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    renderLibrary();
  };
});

function renderLibrary() {
  const filter = document.querySelector('.filter-chip.active')?.dataset.filter || 'all';
  const container = $('library-content');
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'library-grid animate-in';

  const card = (iconName, title, subtitle, onClick, cover) => {
    const el = document.createElement('div');
    el.className = 'library-card';
    el.innerHTML = `${cover ? `<img src="${esc(thumb(cover, 80))}" alt="" class="library-card-cover" />` : icon(iconName)}
      <div class="library-card-title ellipsis">${esc(title)}</div><div class="library-card-subtitle muted">${esc(subtitle)}</div>`;
    grid.appendChild(clickable(el, onClick));
  };

  if (filter === 'all') card('heart', 'المقاطع المفضلة', `${formatCount(likesCount())} مقطع`, openLikesPage);
  if (filter === 'all' || filter === 'downloads') card('download', 'التنزيلات', `${formatCount(lib.downloads.size)} مقطع على الجهاز`, openDownloadsPage);
  if (filter === 'all' || filter === 'playlists') {
    lib.playlists.forEach((pl) => card('playlist', pl.name, `${formatCount(fullyLoaded ? playlistTracks(pl).length : pl.tracks.length)} مقطع`, () => openPlaylistPage(pl), playlistTracks(pl)[0]?.coverImage));
    if (filter === 'playlists' && !lib.playlists.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.style.gridColumn = '1 / -1';
      empty.innerHTML = 'لم تنشئ أي قائمة بعد.<br/><button class="link-btn">إنشاء قائمة</button>';
      empty.querySelector('button').onclick = () => promptCreatePlaylist();
      grid.appendChild(empty);
    }
  }
  container.appendChild(grid);

  if (filter === 'all' || filter === 'artists') {
    const followed = [...lib.follows].map((n) => reciterByName.get(n)).filter(Boolean);
    if (followed.length) container.appendChild(section('الرواديد الذين تتابعهم', scroller(followed, reciterCard)));
    else if (filter === 'artists') {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = 'لا تتابع أي رادود بعد. افتح صفحة رادود واضغط "متابعة".<br/><button class="link-btn">تصفح الرواديد</button>';
      empty.querySelector('button').onclick = () => openAllReciters();
      container.appendChild(empty);
    }
  }
}

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

function openTrackOptions(track, { playlist = null } = {}) {
  $('track-options-img').src = thumb(track.coverImage, 55);
  $('track-options-title').textContent = track.title;
  $('track-options-artist').textContent = track.reciterName;

  const liked = lib.likes.has(track.id);
  setIcon($('opt-like-icon'), 'heart', { fill: liked });
  $('opt-like-icon').classList.toggle('liked', liked);
  $('opt-like-text').textContent = liked ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة';
  $('opt-like').onclick = () => closeOverlayThen(() => toggleLike(track));

  $('opt-queue').onclick = () => closeOverlayThen(() => playNextInQueue(track));
  $('opt-playlist').onclick = () => closeOverlayThen(() => openPlaylistPicker(track));

  const remove = $('opt-remove');
  remove.style.display = playlist ? 'flex' : 'none';
  remove.onclick = () => closeOverlayThen(async () => {
    playlist.tracks = playlist.tracks.filter((id) => id !== track.id);
    await savePlaylist(playlist);
    toast('أُزيل من القائمة');
  });

  const dl = lib.downloads.has(track.id);
  setIcon($('opt-download-icon'), dl ? 'check' : 'download');
  $('opt-download-text').textContent = dl ? 'حذف التنزيل' : 'تنزيل للاستماع بدون إنترنت';
  $('opt-download').onclick = () => closeOverlayThen(() => toggleDownload(track));

  $('opt-artist').onclick = () => closeOverlayThen(() => {
    if ($('full-player-view').classList.contains('open')) closeOverlayThen(() => openArtistDetail(track.reciterName));
    else openArtistDetail(track.reciterName);
  });
  $('opt-share').onclick = () => closeOverlayThen(() => shareTrack(track));
  openSheet('track-options-modal');
}

window.openCurrentTrackOptions = () => { if (currentTrack) openTrackOptions(currentTrack); };
const shareTrack = (t) => share(t.title, `استمع إلى ${t.title} بصوت ${t.reciterName}`, `${SITE_URL}/track?id=${t.id}`);
window.shareCurrentTrack = () => { if (currentTrack) shareTrack(currentTrack); };

// Shared links point at the website: it shows a preview in chats/search and
// sends phones back into this app on the same track.
async function share(title, text, url) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); } catch { /* cancelled */ }
    return;
  }
  try { await navigator.clipboard.writeText(url); toast('تم نسخ الرابط'); } catch { prompt('انسخ الرابط:', url); }
}

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

// Play `list` starting at `index`; the list becomes the queue
function playFromList(list, index, { shuffleStart = false } = {}) {
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
  if (queueIndex < queue.length - 1) {
    queueIndex++;
  } else if (repeatMode === 'all' && queue.length) {
    queueIndex = 0;
  } else if (isAutoplay && currentTrack) {
    const played = new Set(queue.map((t) => t.id));
    const more = similarTo(currentTrack, 40).filter((t) => !played.has(t.id));
    if (!more.length) return false;
    queue.push(...more.slice(0, 10));
    queueIndex++;
  } else {
    if (!fromEnded && queue.length) queueIndex = 0; else return false;
  }
  playTrack(queue[queueIndex]);
  return true;
};

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

// Radio: shuffle of the current reciter's work, then similar tracks
window.startRadio = () => {
  if (!currentTrack) return;
  const own = shuffled(tracksOf(currentTrack.reciterName).filter((t) => t.id !== currentTrack.id));
  queue = [currentTrack, ...own, ...similarTo(currentTrack, 20).filter((t) => t.reciterName !== currentTrack.reciterName)];
  queueOriginal = null;
  queueIndex = 0;
  updateQueueUI();
  toast(`راديو ${currentTrack.reciterName}`);
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
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

let isDragging = false;
function updateProgressUI() {
  const d = audio.duration;
  if (!d || !isFinite(d)) return;
  const pct = (audio.currentTime / d) * 100;
  $('mp-progress-fill').style.width = `${pct}%`;
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
  $('mp-title').textContent = t.title;
  $('mp-reciter').textContent = t.reciterName;
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
  const follow = $('fp-about-follow');
  follow.dataset.follow = r.name;
  follow.onclick = (e) => { e.stopPropagation(); toggleFollow(r); };

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
  if (reciter) {
    const b = document.createElement('button');
    b.className = 'pill-btn small';
    b.dataset.follow = reciter.name;
    b.onclick = (e) => { e.stopPropagation(); toggleFollow(reciter); };
    row.appendChild(b);
  }
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
  document.querySelectorAll('[data-follow]').forEach((b) => {
    const on = lib.follows.has(b.dataset.follow);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    const label = on ? 'تتابعه' : 'متابعة';
    b.innerHTML = 'followIcon' in b.dataset ? `${icon(on ? 'following' : 'follow')} <span>${label}</span>` : label;
  });
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
  openOverlay(() => { fp.classList.add('open'); $('mini-player').classList.remove('active'); setThemeColor(nowShades?.top); },
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
const coverShades = new Map(); // cover url → shades
let nowShades = null;
let shadesFor = null;          // the track the colour is being worked out for

// When the cover can't be read (no permission from its server, offline): a calm
// colour of its own for each reciter, so the player is never plain
const FALLBACK_HUES = [0.02, 0.08, 0.3, 0.45, 0.55, 0.62, 0.75, 0.9];
function fallbackShades(t) {
  let h = 0;
  for (const ch of t.reciterName) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return playerShades([FALLBACK_HUES[h % FALLBACK_HUES.length], 0.35, 0.28]);
}

// A small copy of the cover, at a size no <img> on the page uses (so it isn't
// served from the cache without the cross-origin permission reading pixels needs)
function colorSampleUrl(url) {
  try {
    if (IMAGE_HOSTS.has(new URL(url).hostname)) return `https://soutalahzan.com/cdn-cgi/image/width=48,quality=70,format=auto,fit=scale-down/${url}`;
  } catch { /* not a full URL */ }
  return url;
}

function coverShadesFor(t) {
  const url = t.coverImage;
  if (!url) return Promise.resolve(fallbackShades(t));
  if (coverShades.has(url)) return Promise.resolve(coverShades.get(url));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let shades = null;
      try { const hsl = dominantHsl(img); if (hsl) shades = playerShades(hsl); } catch { /* pixels not readable */ }
      if (shades) coverShades.set(url, shades);
      resolve(shades || fallbackShades(t));
    };
    img.onerror = () => resolve(fallbackShades(t));
    img.src = colorSampleUrl(url);
  });
}

function paintPlayerColor(t) {
  shadesFor = t;
  coverShadesFor(t).then((sh) => {
    if (shadesFor !== t) return;
    nowShades = sh;
    const root = document.documentElement.style;
    root.setProperty('--np-top', sh.top);
    root.setProperty('--np-mini', sh.mini);
    root.setProperty('--np-card', sh.card);
    if ($('full-player-view').classList.contains('open')) setThemeColor(sh.top);
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
    goSearch();
    $('main-search-input').value = q;
    runSearch();
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
