import { supabase } from './supabaseClient.js';
import { icon, setIcon, startIcons } from './icons.js';

// ═══ Constants ═══════════════════════════════════════════════════════════════
const SITE_URL = 'https://web.soutalahzan.com';
const APP_URL = new URL(import.meta.env.BASE_URL, location.origin).href;
const FALLBACK_COVER = `${import.meta.env.BASE_URL}icon-512.png`;
const AUDIO_CACHE = 'sawt-alahzan-audio-cache-v1';
const PAGE_SIZE = 1000; // Supabase returns at most 1000 rows per request
const TRACK_COLUMNS = 'id,title,file_name,reciter_name,reciter_id,image_url,file_url,category,lyrics,duration,listen_count,created_at';

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
const todaySeed = () => Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
const shuffled = (list) => seededShuffle(list, Math.floor(Math.random() * 233280));

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
    lyrics: typeof row.lyrics === 'string' ? row.lyrics.trim() : '',
    duration: formatDuration(row.duration),
    listens: row.listen_count || 0,
  };
  if (existing) { Object.assign(existing, track); return existing; }
  trackById.set(track.id, track);
  return track;
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

async function loadData() {
  showLoading();
  try {
    const [first, popular, recRes] = await Promise.all([
      fetchTrackPage(0),
      supabase.from('audio_library').select(TRACK_COLUMNS).order('listen_count', { ascending: false }).limit(40),
      supabase.from('reciters').select('id,name,image_url').limit(1000),
    ]);
    allTracks = first.rows.map(mapTrack);
    popularTracks = (popular.data || []).map(mapTrack);
    buildReciters(recRes.data || []);
    renderHome();
    resolveDataReady();
    restoreLastTrack();
    handleDeepLink();

    // The rest of the library, in parallel, without holding up the first screen
    const pages = [];
    for (let from = PAGE_SIZE; from < (first.count || 0); from += PAGE_SIZE) pages.push(fetchTrackPage(from));
    const rest = await Promise.all(pages);
    rest.forEach((p) => allTracks.push(...p.rows.map(mapTrack)));
    fullyLoaded = true;
    buildReciters(recRes.data || []);
    const atTop = document.querySelector('.main-container').scrollTop < 40;
    if (navStack.some((e) => e.type === 'page') || currentTab !== 'home' || atTop) refreshOpenViews();
  } catch (err) {
    console.error('Error fetching data:', err);
    $('sections-container').innerHTML = `
      <div class="empty-state">
        <p>تعذّر تحميل المقاطع. تأكد من اتصالك بالإنترنت.</p>
        <button class="primary-btn" style="width: auto; padding: 12px 28px;" onclick="location.reload()">إعادة المحاولة</button>
      </div>`;
  }
}

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
    }
    store.set('sawt_downloads', [...this.downloads]);
    store.set('sawt_history', this.history);
  },
};

// The phone app stores track ids as "cloud_<id>"; both apps share these tables
const cloudId = (id) => `cloud_${id}`;
const fromCloudId = (pid) => String(pid).replace(/^cloud_/, '');

async function syncFromCloud() {
  await dataReady;
  if (!currentUser) return;
  const uid = currentUser.id;
  // A guest's likes and playlists move into the account on first sign-in
  const guestLikes = store.get('sawt_likes', []).map(String);
  const guestPlaylists = store.get('sawt_playlists', []);
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
    lib.follows = new Set(reciters.filter((r) => r.dbId && ids.has(r.dbId)).map((r) => r.name));
  }
  refreshLikeButtons();
  refreshOpenViews();
}

const safePlaylistId = (id) => (/^[A-Za-z0-9_-]{1,100}$/.test(String(id)) ? String(id) : `pl_${Date.now()}`);

async function toggleLike(track) {
  const liked = !lib.likes.has(track.id);
  if (liked) lib.likes.add(track.id); else lib.likes.delete(track.id);
  lib.saveLocal();
  refreshLikeButtons();
  toast(liked ? 'أُضيف إلى المفضلة' : 'أُزيل من المفضلة');
  if (currentUser) {
    const q = liked
      ? supabase.from('favorites').upsert({ user_id: currentUser.id, poem_id: cloudId(track.id) }, { onConflict: 'user_id,poem_id', ignoreDuplicates: true })
      : supabase.from('favorites').delete().eq('user_id', currentUser.id).eq('poem_id', cloudId(track.id));
    const { error } = await q;
    if (error) console.warn('Could not save like:', error);
  }
  return liked;
}

async function savePlaylist(pl) {
  lib.saveLocal();
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
  lib.playlists = lib.playlists.filter((p) => p.id !== pl.id);
  lib.saveLocal();
  if (currentUser) await supabase.from('user_playlists').delete().eq('user_id', currentUser.id).eq('id', pl.id);
}

async function toggleFollow(reciter) {
  const following = !lib.follows.has(reciter.name);
  if (following) lib.follows.add(reciter.name); else lib.follows.delete(reciter.name);
  lib.saveLocal();
  if (currentUser && reciter.dbId) {
    const q = following
      ? supabase.from('follows').upsert({ follower_id: currentUser.id, followed_reciter_id: Number(reciter.dbId) }, { onConflict: 'follower_id,followed_reciter_id', ignoreDuplicates: true })
      : supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('followed_reciter_id', Number(reciter.dbId));
    const { error } = await q;
    if (error) console.warn('Could not save follow:', error);
  }
  toast(following ? `تتابع الآن ${reciter.name}` : `ألغيت متابعة ${reciter.name}`);
  return following;
}

// Offline listening: the file goes into the cache the service worker serves from
async function toggleDownload(track) {
  if (lib.downloads.has(track.id)) {
    lib.downloads.delete(track.id);
    lib.saveLocal();
    try { const cache = await caches.open(AUDIO_CACHE); await cache.delete(track.audioUrl); } catch { /* ignore */ }
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
    lib.downloads.add(track.id);
    lib.saveLocal();
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

function showView(viewId) {
  document.querySelectorAll('.view').forEach((v) => { v.style.display = v.id === viewId ? 'block' : 'none'; });
  document.querySelector('.main-container').scrollTo(0, 0);
}

function openPage(viewId, render) {
  if (rewinding) { waiting.push(() => openPage(viewId, render)); return; }
  render();
  showView(viewId);
  navStack.push({ type: 'page', viewId, render });
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
  const top = navStack.pop();
  if (top?.type === 'overlay') {
    top.hide();
  } else if (top?.type === 'page') {
    const prev = [...navStack].reverse().find((e) => e.type === 'page');
    if (prev) { prev.render(); showView(prev.viewId); } else showView(TABS[currentTab]);
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

window.goHome = () => goTab('home');
window.goSearch = () => { goTab('search'); renderSearchHome(); };
window.goLibrary = () => { goTab('library'); renderLibrary(); };
window.goProfile = () => { goTab('profile'); updateProfileUI(); };

function refreshOpenViews() {
  const top = [...navStack].reverse().find((e) => e.type === 'page');
  if (top) top.render();
  else if (currentTab === 'home') renderHome();
  else if (currentTab === 'library') renderLibrary();
  else if (currentTab === 'search') { renderSearchHome(); runSearch(); }
  else if (currentTab === 'profile') updateProfileUI();
}

// ═══ Shared list rendering ═══════════════════════════════════════════════════
// Track rows: tap plays the list from that row; ⋮ opens the options sheet.
// Long lists render in chunks as you scroll.
function renderTrackList(container, list, { numbered = false, emptyText = 'لا توجد مقاطع هنا بعد', playlist = null } = {}) {
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
      el.onclick = () => playFromList(list, index);
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
      }, { root: document.querySelector('.main-container'), rootMargin: '600px' });
      io.observe(sentinel);
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
  card.onclick = onClick || (() => openTrackDetail(track));
  return card;
}

function reciterCard(r) {
  const card = document.createElement('div');
  card.className = 'square-card';
  card.innerHTML = `
    <img src="${esc(thumb(r.image, 160))}" alt="" class="square-cover round" loading="lazy" />
    <div class="square-title" style="text-align: center;">${esc(r.name)}</div>
    <div class="square-subtitle" style="text-align: center;">${formatCount(r.count)} مقطع</div>`;
  card.onclick = () => openArtistDetail(r.name);
  return card;
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
  return h >= 5 && h < 12 ? 'صباح الخير' : h < 18 ? 'مساء الخير' : 'طاب مساؤك';
}

function renderHome() {
  const container = $('sections-container');
  if (!allTracks.length) return;
  container.innerHTML = '';
  $('home-greeting').textContent = greeting();

  const recent = historyTracks();
  const liked = [...lib.likes].map((id) => trackById.get(id)).filter(Boolean).reverse();

  // 1. Quick grid: what you played last, otherwise the newest
  const grid = document.createElement('div');
  grid.className = 'recent-grid section animate-in';
  (recent.length >= 4 ? recent : allTracks).slice(0, 6).forEach((t) => {
    const card = document.createElement('div');
    card.className = 'recent-card';
    card.innerHTML = `<img src="${esc(thumb(t.coverImage, 70))}" alt="" class="recent-img" /><div class="recent-title">${esc(t.title)}</div>`;
    card.onclick = () => openTrackDetail(t);
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
    card.onclick = () => openTrackDetail(t);
    return card;
  }), () => openListPage('مضاف حديثاً', allTracks.slice(0, 100))));

  // 3. Top reciters (with a real photo first)
  const topReciters = [...reciters].sort((a, b) => (b.hasPhoto - a.hasPhoto) || (b.count - a.count)).slice(0, 12);
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
      item.onclick = () => playFromList(list, c * 5 + i);
      item.querySelector('.row-more').onclick = (e) => { e.stopPropagation(); openTrackOptions(t); };
      col.appendChild(item);
    });
    row.appendChild(col);
  }
  return row;
}

// ═══ Pages ═══════════════════════════════════════════════════════════════════
let playlistPage = null; // { title, list, playlist? }

function openListPage(title, list, playlist = null) {
  openPage('playlist-detail-view', () => renderListPage(title, typeof list === 'function' ? list() : list, playlist));
}
const openLikesPage = () => openListPage('المقاطع المفضلة', () => [...lib.likes].map((id) => trackById.get(id)).filter(Boolean).reverse());
const openDownloadsPage = () => openListPage('التنزيلات', () => [...lib.downloads].map((id) => trackById.get(id)).filter(Boolean));
const openPlaylistPage = (pl) => openListPage(pl.name, () => pl.tracks.map((id) => trackById.get(id)).filter(Boolean), pl);

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
  del.onclick = async () => {
    if (!playlist || !confirm(`حذف قائمة "${playlist.name}"؟`)) return;
    await deletePlaylist(playlist);
    toast('حُذفت القائمة');
    history.back();
  };
}

$('playlist-search').addEventListener('input', (e) => {
  if (!playlistPage) return;
  const q = normalize(e.target.value.trim());
  const list = q ? playlistPage.list.filter((t) => normalize(`${t.title} ${t.reciterName}`).includes(q)) : playlistPage.list;
  renderTrackList($('playlist-tracks'), list, { numbered: true, playlist: playlistPage.playlist, emptyText: 'لا توجد نتائج' });
});

function openAllReciters() {
  openPage('playlist-detail-view', () => {
    playlistPage = null;
    $('playlist-title').textContent = 'كل الرواديد';
    $('playlist-subtitle').textContent = `${formatCount(reciters.length)} رادود`;
    $('playlist-delete-btn').style.display = 'none';
    $('playlist-search').parentElement.style.display = 'none';
    const grid = $('playlist-tracks');
    grid.className = 'reciter-grid';
    grid.innerHTML = '';
    reciters.forEach((r) => grid.appendChild(reciterCard(r)));
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
  const paintFollow = () => {
    const on = lib.follows.has(name);
    follow.classList.toggle('on', on);
    follow.innerHTML = `${icon(on ? 'following' : 'follow')} <span>${on ? 'تتابعه' : 'متابعة'}</span>`;
  };
  paintFollow();
  follow.onclick = async () => { await toggleFollow(r); paintFollow(); };
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
  if (track) openPage('track-detail-view', () => renderTrackDetail(track));
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

  const lyrics = $('td-lyrics-section');
  lyrics.style.display = track.lyrics ? 'block' : 'none';
  $('td-lyrics').textContent = track.lyrics;

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

// Same reciter first (most listened), then same category
function similarTo(track, n) {
  const same = tracksOf(track.reciterName).filter((t) => t.id !== track.id);
  const sameCat = track.category ? allTracks.filter((t) => t.category === track.category && t.reciterName !== track.reciterName) : [];
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
    card.onclick = () => openCategoryDetail(cat);
    grid.appendChild(card);
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
  const matches = (text) => { const n = normalize(text); return words.every((w) => n.includes(w)); };
  const foundReciters = reciters.filter((r) => matches(r.name)).slice(0, 8);
  const foundTracks = allTracks.filter((t) => matches(`${t.title} ${t.reciterName}`));

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
    el.onclick = onClick;
    grid.appendChild(el);
  };

  if (filter === 'all') card('heart', 'المقاطع المفضلة', `${formatCount(lib.likes.size)} مقطع`, openLikesPage);
  if (filter === 'all' || filter === 'downloads') card('download', 'التنزيلات', `${formatCount(lib.downloads.size)} مقطع على الجهاز`, openDownloadsPage);
  if (filter === 'all' || filter === 'playlists') {
    lib.playlists.forEach((pl) => card('playlist', pl.name, `${formatCount(pl.tracks.length)} مقطع`, () => openPlaylistPage(pl), trackById.get(pl.tracks[0])?.coverImage));
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
function openPrompt({ title, hint = '', value = '', placeholder = '', onSubmit }) {
  const modal = $('prompt-modal');
  $('prompt-title').textContent = title;
  $('prompt-hint').textContent = hint;
  const input = $('prompt-input');
  input.value = value;
  input.placeholder = placeholder;
  const submit = async () => {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    closeOverlayThen(() => onSubmit(v));
  };
  $('prompt-submit').onclick = submit;
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  openOverlay(() => { modal.style.display = 'flex'; setTimeout(() => input.focus(), 50); }, () => { modal.style.display = 'none'; });
}

window.promptCreatePlaylist = (thenAddTrack = null) => {
  const run = () => openPrompt({
    title: 'إنشاء قائمة تشغيل', hint: 'أدخل اسماً لقائمة التشغيل الجديدة.', placeholder: 'مثال: قصائد للسيارة',
    onSubmit: async (name) => {
      const pl = await createPlaylist(name);
      if (thenAddTrack) { pl.tracks.push(thenAddTrack.id); await savePlaylist(pl); toast(`أُضيف إلى "${name}"`); }
      else toast('أُنشئت القائمة');
      if (currentTab === 'library') renderLibrary();
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
    refreshOpenViews();
  });

  const dl = lib.downloads.has(track.id);
  setIcon($('opt-download-icon'), dl ? 'check' : 'download');
  $('opt-download-text').textContent = dl ? 'حذف التنزيل' : 'تنزيل للاستماع بدون إنترنت';
  $('opt-download').onclick = () => closeOverlayThen(() => toggleDownload(track).then(refreshOpenViews));

  $('opt-artist').onclick = () => closeOverlayThen(() => {
    if ($('full-player-view').classList.contains('open')) closeOverlayThen(() => openArtistDetail(track.reciterName));
    else openArtistDetail(track.reciterName);
  });
  $('opt-share').onclick = () => closeOverlayThen(() => share(track.title, `استمع إلى ${track.title} بصوت ${track.reciterName}`, `${SITE_URL}/track?id=${track.id}`));
  openSheet('track-options-modal');
}

window.openCurrentTrackOptions = () => { if (currentTrack) openTrackOptions(currentTrack); };

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

async function loadSource(url) {
  if (hls) { hls.destroy(); hls = null; }
  if (/\.m3u8(\?|$)/i.test(url) && !audio.canPlayType('application/vnd.apple.mpegurl')) {
    const { default: Hls } = await import('hls.js'); // only for the rare streamed track
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
  await loadSource(track.audioUrl);
  if (startAt) audio.addEventListener('loadedmetadata', () => { audio.currentTime = startAt; }, { once: true });
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
    if (!audio.currentSrc) playTrack(currentTrack);
    else audio.play().catch(() => {});
  } else audio.pause();
};
const togglePlay = window.togglePlay;

// Next track: from the queue; at its end repeat-all wraps, autoplay continues
// with similar tracks, otherwise playback stops.
window.playNext = (fromEnded = false) => {
  if (queueIndex < queue.length - 1) {
    queueIndex++;
  } else if (repeatMode === 'all' && queue.length) {
    queueIndex = 0;
  } else if (isAutoplay && currentTrack) {
    const played = new Set(queue.map((t) => t.id));
    const more = similarTo(currentTrack, 40).filter((t) => !played.has(t.id));
    if (!more.length) return;
    queue.push(...more.slice(0, 10));
    queueIndex++;
  } else {
    if (!fromEnded && queue.length) queueIndex = 0; else return;
  }
  playTrack(queue[queueIndex]);
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
  document.querySelectorAll('.shuffle-toggle').forEach((b) => b.classList.toggle('on', isShuffle));
  toast(isShuffle ? 'التشغيل العشوائي مفعّل' : 'التشغيل العشوائي متوقف');
};

window.toggleRepeat = () => {
  repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
  const btn = $('fp-repeat-btn');
  btn.classList.toggle('on', repeatMode !== 'off');
  setIcon(btn.querySelector('.ic'), repeatMode === 'one' ? 'repeat-one' : 'repeat');
  toast({ off: 'التكرار متوقف', all: 'تكرار القائمة', one: 'تكرار المقطع الحالي' }[repeatMode]);
};

window.toggleAutoplay = () => {
  isAutoplay = !isAutoplay;
  store.set('sawt_autoplay', isAutoplay);
  $('fp-autoplay-switch').classList.toggle('on', isAutoplay);
};

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
audio.addEventListener('play', paintPlayButtons);
audio.addEventListener('pause', () => { paintPlayButtons(); saveLastPosition(); });
audio.addEventListener('playing', () => {
  // One listen per play (same counter as the website and the phone app)
  if (currentTrack && countedListen !== currentTrack.id) {
    countedListen = currentTrack.id;
    currentTrack.listens++;
    supabase.rpc('increment_listens', { row_id: Number(currentTrack.id) }).then(({ error }) => {
      if (error) console.warn('increment_listens failed:', error.message);
    });
  }
});
audio.addEventListener('error', () => {
  if (currentTrack && audio.error) toast('تعذر تشغيل هذا المقطع');
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
  $('fp-bg').style.backgroundImage = `url("${thumb(t.coverImage, 160).replace(/["\\]/g, encodeURIComponent)}")`;
  $('fp-title').textContent = t.title;
  $('fp-artist').textContent = t.reciterName;
  $('fp-artist').onclick = () => closeOverlayThen(() => openArtistDetail(t.reciterName));
  $('fp-lyrics-preview').textContent = t.lyrics || 'الكلمات غير متوفرة لهذا المقطع';
  $('lyrics-content').textContent = t.lyrics || 'الكلمات غير متوفرة لهذا المقطع';
  $('ly-title').textContent = t.title;
  $('ly-artist').textContent = t.reciterName;
  $('mp-like-btn').dataset.trackId = t.id;
  $('fp-like-btn').dataset.trackId = t.id;
  $('fp-current-time').textContent = '0:00';
  $('fp-total-time').textContent = t.duration || '0:00';

  const similar = $('fp-similar-list');
  similar.innerHTML = '';
  similarTo(t, 8).forEach((s) => similar.appendChild(squareCard(s, () => playFromList([s, ...similarTo(s, 20)], 0))));
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

function updateQueueUI() {
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
    row.onclick = () => { queueIndex += i + 1; playTrack(queue[queueIndex]); };
    box.appendChild(row);
  });
}

function refreshLikeButtons() {
  document.querySelectorAll('#mp-like-btn, #fp-like-btn, #td-like-btn').forEach((btn) => {
    const liked = !!btn.dataset.trackId && lib.likes.has(btn.dataset.trackId);
    btn.classList.toggle('liked', liked);
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
  openOverlay(() => { fp.classList.add('open'); $('mini-player').classList.remove('active'); },
    () => { fp.classList.remove('open'); if (currentTrack) $('mini-player').classList.add('active'); });
}
$('mini-player').addEventListener('click', (e) => { if (!e.target.closest('button')) openFullPlayer(); });

window.openLyricsView = () => {
  const view = $('lyrics-view');
  openOverlay(() => { view.style.display = 'block'; void view.offsetWidth; view.classList.add('open'); },
    () => { view.classList.remove('open'); setTimeout(() => { view.style.display = 'none'; }, 350); });
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
const avatarUrl = () => profile?.avatar_url || currentUser?.user_metadata?.avatar_url || initialAvatar(displayName());

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

  supabase.auth.onAuthStateChange(async (event, s) => {
    const before = currentUser?.id;
    currentUser = s?.user ?? null;
    if (currentUser?.id === before && event !== 'USER_UPDATED') return;
    await loadProfile();
    updateProfileUI();
    if (currentUser) syncFromCloud();
    else {
      // Signed out: back to this device's guest data
      lib.likes = new Set(store.get('sawt_likes', []).map(String));
      lib.playlists = store.get('sawt_playlists', []);
      lib.follows = new Set(store.get('sawt_artists', []));
      refreshLikeButtons();
      refreshOpenViews();
    }
  });

  // Offer sign-in once, on the first visit
  if (!currentUser && !store.get('sawt_auth_skipped', false)) setTimeout(() => openAuthModal(), 1200);
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
  $('stat-likes').textContent = formatCount(lib.likes.size);
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
      if (data.session) { closeAuthModal(); toast('أهلاً بك! تم إنشاء حسابك'); }
      else showAuthMessage('تم إنشاء الحساب! تفقد بريدك لتفعيله ثم سجّل الدخول.', false);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      closeAuthModal();
      toast('تم تسجيل الدخول');
    }
  } catch (err) {
    const m = err.message || '';
    showAuthMessage(
      m.includes('Invalid login') ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
        : m.includes('already registered') ? 'هذا البريد الإلكتروني مسجل مسبقاً'
          : m.includes('Email not confirmed') ? 'يرجى تأكيد البريد الإلكتروني أولاً'
            : 'حدث خطأ، يرجى المحاولة مجدداً');
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
        .then(({ data }) => { if (data) openTrackDetail(mapTrack(data)); });
    }
  } else if (reciterId) {
    const r = reciters.find((x) => x.dbId === reciterId);
    if (r) openArtistDetail(r.name);
  } else if (q) {
    goSearch();
    $('main-search-input').value = q;
    runSearch();
  }
}

// ═══ Boot ════════════════════════════════════════════════════════════════════
startIcons();
$('fp-autoplay-switch').classList.toggle('on', isAutoplay);
initAuth();
loadData();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn('SW registration failed:', e));
  });
}
