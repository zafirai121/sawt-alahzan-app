// The "اقرأ" part, as the phone app's (ui/read/Read.kt): du'as, ziyarat,
// al-Sahifa al-Sajjadiyya, the Quran and the tasbih, a part of the app of its
// own (its own bottom bar), reached from the gold "اقرأ" on the home screen and
// left by "استمع". Its texts are the site's read/ files (tools/read builds them
// from open sources: Arabic and Persian Wikisource, and Tanzil), loaded when opened; the
// service worker keeps them for offline.
import { icon } from './icons.js';

const BASE = `${import.meta.env.BASE_URL}read/`;
const TABS = [
  ['home', 'الرئيسية', 'home'], ['duas', 'الأدعية', 'moon-star'], ['ziyarat', 'الزيارات', 'landmark'],
  ['quran', 'القرآن', 'book-open'], ['tasbih', 'المسبحة', 'circle-dot'],
];
// Tasbih al-Zahra: 34 takbir, 33 tahmid, 33 tasbih
const ZAHRA = [['اللهُ أَكْبَر', 34], ['اَلْحَمْدُ لِلَّه', 33], ['سُبْحَانَ الله', 33]];
const MIN_SIZE = 16, MAX_SIZE = 34;

let ctx; // from main.js: openOverlay, dropOverlays, closeReading, toast, playFromList, tracks, esc, store
let index = null;
let loading = null;
let failed = false;
const texts = new Map();
const suras = new Map();
let tab = 'home';
// Pages over the tab, the top one shown: { kind: 'text' | 'surah' | 'group' | 'sources', id, n, under }
const stack = [];
let saveLine = null; // the open text's: where it is, kept as it scrolls

const app = () => document.getElementById('read-app');
const esc = (v) => ctx.esc(v);

/** Normalised for comparing names: no harakat or tatweel, one alef, ة as ه, ى as ي. */
const plain = (s) => String(s).replace(/[ً-ْٰـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
const indic = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
/** "8 أدعية", "54 دعاءً": three to ten take the plural, more the singular. */
const count = (n, plural, single) => `${n} ${n >= 3 && n <= 10 ? plural : single}`;

async function getJson(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

function loadIndex() {
  if (index) return Promise.resolve(index);
  if (!loading) {
    failed = false;
    loading = getJson('index.json')
      .then((i) => { index = i; return i; })
      .catch(() => { failed = true; return null; })
      .finally(() => { loading = null; });
  }
  return loading;
}

async function textOf(id) {
  if (!texts.has(id)) texts.set(id, await getJson(`t/${id}.json`));
  return texts.get(id);
}
async function surahOf(n) {
  if (!suras.has(n)) suras.set(n, await getJson(`q/${n}.json`));
  return suras.get(n);
}

const size = () => Math.min(MAX_SIZE, Math.max(MIN_SIZE, ctx.store.get('read_size', 22)));

// ─── Getting about ───

function openReading() {
  ctx.openOverlay(() => {
    document.body.classList.add('reading');
    ctx.store.set('read_seen', true);
    document.querySelectorAll('.read-dot').forEach((d) => d.remove());
    render();
  }, () => {
    stopSaving();
    document.body.classList.remove('reading');
  }, { read: true });
}

function openPage(page) {
  ctx.openOverlay(() => {
    page.under = app().scrollTop;
    stack.push(page);
    render();
  }, () => {
    const page = stack.pop();
    render(page?.under || 0);
  }, { read: true });
}

function switchTab(t) {
  const go = () => { tab = t; render(); };
  if (stack.length) ctx.dropOverlays(stack.length, go); else go();
}

// ─── Drawing ───

function render(scrollTop = 0) {
  stopSaving();
  const el = app();
  el.style.setProperty('--read-size', `${size()}px`);
  document.querySelectorAll('#read-nav .nav-item').forEach((n) => n.classList.toggle('active', n.dataset.tab === tab));
  const page = stack[stack.length - 1];
  if (page?.kind === 'text') return drawText(page.id);
  if (page?.kind === 'surah') return drawSurah(page.n);
  if (!index) {
    el.innerHTML = header('اقرأ', 'الأدعية والزيارات والقرآن الكريم') + waiting();
    loadIndex().then(() => { if (document.body.classList.contains('reading')) render(); });
    return;
  }
  if (page?.kind === 'group') el.innerHTML = groupPage(page.id, true);
  else if (page?.kind === 'sources') el.innerHTML = sourcesPage();
  else if (tab === 'duas' || tab === 'ziyarat') el.innerHTML = groupPage(tab, false);
  else if (tab === 'quran') el.innerHTML = quranPage();
  else if (tab === 'tasbih') el.innerHTML = tasbihPage();
  else el.innerHTML = homePage();
  el.scrollTop = scrollTop;
}

function waiting() {
  return failed
    ? `<div class="empty-state">تعذّر تحميل النصوص، تأكد من اتصالك<br><button class="link-btn" data-read="retry">إعادة المحاولة</button></div>`
    : `<div class="loading">${icon('spinner')}</div>`;
}

/** A tab's header: its title, and "استمع" back to listening; `back` for a page over a tab. */
function header(title, subtitle = '', back = false) {
  return `<header class="rq-head">
    ${back ? `<button class="icon-btn rq-back" data-read="back" aria-label="رجوع">${icon('back')}</button>` : ''}
    <div class="rq-titles"><h1 class="${back ? 'small' : ''}">${esc(title)}</h1>${subtitle ? `<div class="rq-sub">${esc(subtitle)}</div>` : ''}</div>
    <button class="rq-listen" data-read="listen">${icon('headphones')}<span>استمع</span></button>
  </header>`;
}

const group = (id) => index?.groups?.find((g) => g.id === id);
/** How many there are, as the index says it, or counted as du'as or ziyarat. */
const countOf = (g) => g.count || (g.id === 'ziyarat' ? count(g.items.length, 'زيارات', 'زيارة') : count(g.items.length, 'أدعية', 'دعاءً'));
/** The groups that are tiles on a tab (an index from before tiles: the Sahifa, on the du'as'). */
const cardsOn = (t) => (index?.groups || []).filter((g) => g.tab === t || (t === 'duas' && g.id === 'sahifa' && !g.tab));
const GROUP_ICONS = { sahifa: 'scroll-text', munajat: 'moon-star', week: 'calendar-days', needs: 'hand-heart', occasions: 'sparkles', taqibat: 'clock' };
const groupIcon = (g) => GROUP_ICONS[g.id] || (g.tab === 'ziyarat' ? 'landmark' : 'book-open');

function feature(label, title, line, ic, action) {
  return `<button class="rq-feature" data-read="${esc(action)}">
    <span class="rq-feature-ic">${icon(ic)}</span>
    <span class="rq-feature-text"><span class="rq-label">${esc(label)}</span><span class="rq-amiri rq-feature-title">${esc(title)}</span><span class="rq-sub">${esc(line)}</span></span>
    ${icon('chevron-left')}
  </button>`;
}

function homePage() {
  const duas = group('duas'), ziyarat = group('ziyarat');
  const last = ctx.store.get('read_last', null);
  const now = new Date();
  // Today's du'a, of the days' (Saturday's, Sunday's...)
  const today = group('week')?.items?.find((i) => i.id === `week-${['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()]}`);
  // Thursday evening to Friday: the night of Friday, the night of Kumayl
  const friday = (now.getDay() === 4 && now.getHours() >= 16) || now.getDay() === 5;
  const pick = (g, id) => g?.items?.find((i) => i.id === id);
  const picks = [pick(duas, 'kumayl'), pick(ziyarat, 'ashura'), pick(duas, 'tawassul'), pick(ziyarat, 'jamia'), pick(duas, 'jawshan-kabir')].filter(Boolean);
  const tiles = [
    ...(duas ? [['الأدعية', countOf(duas), 'moon-star', 'tab:duas']] : []),
    ...(ziyarat ? [['الزيارات', countOf(ziyarat), 'landmark', 'tab:ziyarat']] : []),
    ...[...cardsOn('duas'), ...cardsOn('ziyarat')].map((g) => [g.title, countOf(g), groupIcon(g), `group:${g.id}`]),
    ['القرآن الكريم', `${index.surahs.length} سورة`, 'book-open', 'tab:quran'],
    ['المسبحة', 'تسبيح الزهراء', 'circle-dot', 'tab:tasbih'],
  ];
  return header('اقرأ', 'الأدعية والزيارات والقرآن الكريم')
    + (last ? feature('تابع القراءة', last.title, last.line > 0 ? 'من حيث توقفت' : 'من البداية', 'bookmark', `open:${last.key}`) : '')
    + (today ? feature('دعاء اليوم', today.title, today.note || 'من أدعية أيام الأسبوع', 'calendar-days', `open:t:${today.id}`) : '')
    + (friday ? feature('ليلة الجمعة', 'دعاء كميل', 'يُستحب قراءته ليلة الجمعة', 'moon-star', 'open:t:kumayl') : '')
    + `<div class="section"><div class="section-title rq-section-title">يُقرأ كثيراً</div>
        <div class="horizontal-scroller rq-picks">${picks.map((p) => `<button class="rq-pick" data-read="open:t:${esc(p.id)}">
          <span class="rq-amiri">${esc(p.title)}</span>${p.note ? `<span class="rq-sub">${esc(p.note)}</span>` : ''}</button>`).join('')}</div></div>
      <div class="section"><div class="section-title rq-section-title">الأقسام</div>
        <div class="rq-tiles">${tilesOf(tiles)}</div></div>
      <div class="rq-sources"><button class="link-btn" data-read="sources">مصادر النصوص وحقوقها</button></div>`;
}

function tilesOf(tiles) {
  return tiles.map(([t, c, ic, a]) => `<button class="rq-tile" data-read="${a}">
    <span class="rq-tile-ic">${icon(ic)}</span><span><b>${esc(t)}</b><span class="rq-sub">${esc(c)}</span></span></button>`).join('');
}

function mark(n) { return `<span class="rq-num">${n}</span>`; }

function groupPage(id, back) {
  const g = group(id);
  if (!g) return header('') + waiting();
  return header(g.title, countOf(g), back)
    // The groups on this tab (the Sahifa, the munajat...), two by two above its list
    + (cardsOn(id).length ? `<div class="rq-tiles rq-group-tiles">${tilesOf(cardsOn(id).map((c) => [c.title, countOf(c), groupIcon(c), `group:${c.id}`]))}</div>` : '')
    + `<div class="rq-list">${g.items.map((it, i) => `<button class="rq-row" data-read="open:t:${esc(it.id)}">
        ${mark(i + 1)}<span class="rq-row-text"><span class="rq-amiri">${esc(it.title)}</span>${it.note ? `<span class="rq-sub">${esc(it.note)}</span>` : ''}</span>${icon('chevron-left')}</button>`).join('')}</div>`;
}

function quranPage() {
  return header('القرآن الكريم', '114 سورة')
    + `<div class="rq-search"><i class="ic" data-icon="search"></i><input id="rq-surah-search" placeholder="ابحث عن سورة" autocomplete="off"></div>
      <div class="rq-list" id="rq-surahs">${surahRows('')}</div>`;
}

function surahRows(query) {
  const q = plain(query);
  return index.surahs.filter((s) => !q || plain(s.name).includes(q) || String(s.n) === q)
    .map((s) => `<button class="rq-row" data-read="open:q:${s.n}">${mark(s.n)}<span class="rq-row-text"><span class="rq-amiri">سورة ${esc(s.name)}</span>
      <span class="rq-sub">${esc(s.place)} · ${s.ayas} ${s.ayas >= 3 && s.ayas <= 10 ? 'آيات' : 'آية'}</span></span></button>`).join('');
}

function sourcesPage() {
  return header('مصادر النصوص', '', true)
    + `<p class="rq-intro">نصوص هذا القسم من مصادر مفتوحة يجوز نشرها بشرط ذكر مصدرها ورخصتها:</p>`
    + index.sources.map((s) => `<div class="rq-source">
        <b>${esc(s.name)}</b>${s.note ? `<p>${esc(s.note)}</p>` : ''}
        <div class="rq-links"><a class="link-btn" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.replace('https://', ''))}</a>
        ${s.license ? `<a class="link-btn" href="${esc(s.licenseUrl || s.url)}" target="_blank" rel="noopener">رخصة ${esc(s.license)}</a>` : ''}</div>
        ${s.notice ? `<pre class="rq-notice" dir="ltr">${esc(s.notice)}</pre>` : ''}</div>`).join('');
}

// ─── The tasbih ───

function tasbihState() {
  const done = Math.min(100, Math.max(0, ctx.store.get('read_tasbih', 0)));
  let start = 0, phase = ZAHRA.length - 1;
  for (let i = 0; i < ZAHRA.length; i++) {
    if (done < start + ZAHRA[i][1]) { phase = i; break; }
    start += ZAHRA[i][1];
  }
  if (done >= 100) start = 100 - ZAHRA[ZAHRA.length - 1][1];
  const target = ZAHRA[phase][1];
  return { done, phase, target, inPhase: Math.min(done - start, target), finished: done >= 100 };
}

function tasbihPage() {
  const s = tasbihState();
  const r = 104, c = 2 * Math.PI * r;
  const fraction = s.finished ? 1 : s.inPhase / s.target;
  return header('المسبحة', 'تسبيح السيدة الزهراء عليها السلام')
    + `<div class="rq-tasbih">
      <div class="rq-zahra">${ZAHRA.map(([w, n], i) => `<div class="${i === s.phase && !s.finished ? 'now' : ''}"><span class="rq-amiri">${w}</span><span class="rq-sub">${n}</span></div>`).join('')}</div>
      <div class="rq-amiri rq-dhikr">${s.finished ? 'تقبّل الله' : ZAHRA[s.phase][0]}</div>
      <button class="rq-bead" data-read="count" ${s.finished ? 'disabled' : ''} aria-label="تسبيحة">
        <svg viewBox="0 0 230 230" aria-hidden="true"><circle cx="115" cy="115" r="${r}" class="rq-ring" />
          <circle cx="115" cy="115" r="${r}" class="rq-ring-fill" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - fraction)}" /></svg>
        <span class="rq-count">${s.finished ? 100 : s.inPhase}</span><span class="rq-sub">${s.finished ? 'اكتمل التسبيح' : `من ${s.target}`}</span>
      </button>
      <button class="rq-reset" data-read="reset">${icon('rotate-ccw')}<span>${s.finished ? 'تسبيح من جديد' : 'البدء من جديد'}</span></button>
      <div class="rq-sub">المجموع: ${s.done} من 100</div>
    </div>`;
}

// ─── Reading a du'a, a ziyara, a sura ───

function readerBar(title) {
  return `<div class="rq-bar">
    <button class="icon-btn" data-read="back" aria-label="رجوع">${icon('back')}</button>
    <span class="rq-bar-title">${esc(title)}</span>
    <button class="icon-btn" data-read="smaller" aria-label="تصغير الخط">${icon('text-smaller')}</button>
    <button class="icon-btn" data-read="larger" aria-label="تكبير الخط">${icon('text-larger')}</button>
  </div>`;
}

function titleFor(id) {
  for (const g of index?.groups || []) { const it = g.items.find((i) => i.id === id); if (it) return it.title; }
  return '';
}

/**
 * Recordings of a du'a or a ziyara in the library, the most listened first: a
 * du'a by what names it ("كميل") with "دعاء" in the title too; one of the
 * Sahifa's by its number with "الصحيفة"; a ziyara by its whole name.
 */
function recordingsOf(t) {
  // "دعاء الفرج «إلهي عظم البلاء»" by "الفرج"; "دعاء «إلهي كيف أدعوك»" by its words
  const full = plain(t.title.split(' (')[0]);
  const quoted = full.match(/«(.+?)»/)?.[1];
  const head = full.split('«')[0].trim();
  const name = head === 'دعاء' && quoted ? quoted.trim() : head;
  // "الدعاء الثاني", not "الدعاء الثاني عشر" or "الدعاء الثاني والعشرون"
  const number = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\s*(عشر|و))`);
  const matches = (title) => {
    if (t.id.startsWith('sahifa-')) return title.includes('الصحيفه') && number.test(title);
    if (t.id === 'arafa') return title.includes('دعاء') && title.includes('عرفه');
    if (name.startsWith('دعاء ')) return title.includes('دعاء') && title.includes(name.slice(5));
    return title.includes(name);
  };
  return ctx.tracks().filter((tr) => matches(plain(tr.title))).sort((a, b) => (b.listen_count || 0) - (a.listen_count || 0)).slice(0, 30);
}

async function drawText(id) {
  const el = app();
  el.innerHTML = readerBar(titleFor(id)) + `<div class="loading">${icon('spinner')}</div>`;
  let t;
  try { t = await textOf(id); } catch { el.innerHTML = readerBar(titleFor(id)) + `<div class="empty-state">تعذّر تحميل النص، تأكد من اتصالك</div>`; return; }
  if (stack[stack.length - 1]?.id !== id) return;
  const rec = recordingsOf(t);
  const lines = t.parts.flatMap((p) => [...(p.head ? [`<h3 class="rq-part">${esc(p.head)}</h3>`] : []), ...p.text.map((l) => `<p class="rq-line">${esc(l)}</p>`)]);
  el.innerHTML = readerBar(t.title)
    + `<div class="rq-text">
      <h2 class="rq-amiri rq-title">${esc(t.title)}</h2>
      ${rec.length ? `<button class="rq-play" data-read="play">${icon('play', { fill: true })}<span>استمع إليه (${rec.length})</span></button>` : ''}
      ${t.about.length ? `<details class="rq-about"><summary>${icon('info')}<span>عنه</span></summary>${t.about.map((a) => `<p>${esc(a)}</p>`).join('')}</details>` : ''}
      ${lines.join('')}
      <a class="rq-source-line" href="${esc(t.source?.url || '#')}" target="_blank" rel="noopener">المصدر: ${esc(t.source?.name || 'ويكي مصدر')}<br><small>رخصة ${esc(t.source?.license || '')}</small></a>
    </div>`;
  el._recordings = rec;
  el._title = t.title;
  keepPlace(`t:${id}`, t.title, '.rq-line, .rq-part');
}

async function drawSurah(n) {
  const el = app();
  const info = index?.surahs?.find((s) => s.n === n);
  el.innerHTML = readerBar(`سورة ${info?.name || ''}`) + `<div class="loading">${icon('spinner')}</div>`;
  let s;
  try { s = await surahOf(n); } catch { el.innerHTML = readerBar(`سورة ${info?.name || ''}`) + `<div class="empty-state">تعذّر تحميل السورة، تأكد من اتصالك</div>`; return; }
  if (stack[stack.length - 1]?.n !== n) return;
  // Tanzil puts the basmala before each sura's first aya (but al-Fatiha's, where it
  // is the first aya, and al-Tawba's): shown on a line of its own above the sura
  let ayas = s.ayas;
  let basmala = null;
  if (n !== 1 && n !== 9) {
    const words = ayas[0].split(' ');
    if (words.slice(0, 4).map(plain).join(' ') === 'بسم الله الرحمن الرحيم') {
      basmala = words.slice(0, 4).join(' ');
      ayas = [words.slice(4).join(' '), ...ayas.slice(1)];
    }
  }
  // A few ayas a block: the page flows as the mushaf's, and is read a block at a time
  const blocks = [];
  for (let i = 0; i < ayas.length; i += 6) {
    blocks.push(`<p class="rq-ayas">${ayas.slice(i, i + 6).map((a, j) => `${esc(a)} <span class="rq-aya">﴿${indic(i + j + 1)}﴾</span> `).join('')}</p>`);
  }
  const ayaWord = s.ayas.length >= 3 && s.ayas.length <= 10 ? 'آيات' : 'آية';
  el.innerHTML = readerBar(`سورة ${s.name}`)
    + `<div class="rq-text rq-quran">
      <div class="rq-surah-head"><span class="rq-amiri">سورة ${esc(s.name)}</span><span class="rq-sub">${esc(s.place)} · ${s.ayas.length} ${ayaWord}</span></div>
      ${basmala ? `<p class="rq-amiri rq-basmala">${esc(basmala)}</p>` : ''}
      ${blocks.join('')}
      <a class="rq-source-line" href="https://tanzil.net" target="_blank" rel="noopener">المصدر: مشروع Tanzil (tanzil.net)<br><small>رخصة CC BY 3.0</small></a>
    </div>`;
  keepPlace(`q:${n}`, `سورة ${s.name}`, '.rq-ayas');
}

/** Opens at the line it was left at, and keeps where it is as it scrolls (the home's "تابع القراءة"). */
function keepPlace(key, title, selector) {
  const el = app();
  const lines = [...el.querySelectorAll(selector)];
  const at = ctx.store.get(`read_line:${key}`, 0);
  if (at > 0 && lines[at]) el.scrollTop = lines[at].offsetTop - 60;
  else el.scrollTop = 0;
  const save = () => {
    const top = el.scrollTop + 60;
    let line = 0;
    for (let i = 0; i < lines.length; i++) { if (lines[i].offsetTop <= top) line = i; else break; }
    ctx.store.set(`read_line:${key}`, line);
    ctx.store.set('read_last', { key, title, line });
  };
  save();
  let frame = 0;
  saveLine = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; save(); }); };
  el.addEventListener('scroll', saveLine, { passive: true });
}

function stopSaving() {
  if (saveLine) app().removeEventListener('scroll', saveLine);
  saveLine = null;
}

// ─── Taps ───

function act(action, target) {
  const [verb, ...rest] = action.split(':');
  const arg = rest.join(':');
  switch (verb) {
    case 'listen': ctx.closeReading(); break;
    case 'back': history.back(); break;
    case 'retry': loadIndex().then(() => render()); render(); break;
    case 'tab': switchTab(arg); break;
    case 'group': openPage({ kind: 'group', id: arg }); break;
    case 'sources': openPage({ kind: 'sources' }); break;
    case 'open':
      if (arg.startsWith('t:')) openPage({ kind: 'text', id: arg.slice(2) });
      else if (arg.startsWith('q:')) openPage({ kind: 'surah', n: Number(arg.slice(2)) });
      break;
    case 'smaller': case 'larger': {
      ctx.store.set('read_size', Math.min(MAX_SIZE, Math.max(MIN_SIZE, size() + (verb === 'larger' ? 2 : -2))));
      app().style.setProperty('--read-size', `${size()}px`);
      break;
    }
    case 'play': {
      const rec = app()._recordings || [];
      if (rec.length) ctx.playFromList(rec, 0);
      break;
    }
    case 'count': {
      const done = tasbihState().done + 1;
      ctx.store.set('read_tasbih', Math.min(100, done));
      // A light tick a count, a longer one at the end of each of the three
      const ends = [34, 67, 100];
      navigator.vibrate?.(ends.includes(done) ? 60 : 12);
      const top = app().scrollTop;
      render(top);
      break;
    }
    case 'reset': ctx.store.set('read_tasbih', 0); render(app().scrollTop); break;
    default: break;
  }
  target?.blur?.();
}

export function setupRead(c) {
  ctx = c;
  window.openReading = openReading;
  const el = app();
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-read]');
    if (b && el.contains(b)) act(b.dataset.read, b);
  });
  el.addEventListener('input', (e) => {
    if (e.target.id === 'rq-surah-search') document.getElementById('rq-surahs').innerHTML = surahRows(e.target.value);
  });
  // The part's own bottom bar
  document.getElementById('read-nav').innerHTML = TABS.map(([id, title, ic]) =>
    `<a href="#" class="nav-item${id === tab ? ' active' : ''}" data-tab="${id}">${icon(ic)}<span>${title}</span></a>`).join('');
  document.getElementById('read-nav').addEventListener('click', (e) => {
    const a = e.target.closest('.nav-item');
    if (!a) return;
    e.preventDefault();
    switchTab(a.dataset.tab);
  });
  // A dot on "اقرأ" until it is first opened
  if (!ctx.store.get('read_seen', false)) document.querySelectorAll('.read-btn').forEach((b) => b.insertAdjacentHTML('beforeend', '<b class="read-dot"></b>'));
}
