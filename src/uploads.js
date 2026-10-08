// What a track's own file tells about it, for the upload page: its tags (ID3
// in MP3s, the MP4 atoms of M4As), its embedded cover, and the title, reciter
// and category guessed from them the way a person would. The same rules as
// the phone app's TrackGuess (and its tests: tests/uploads.test.mjs).

const normalize = (s) => String(s || '').toLowerCase()
  .replace(/[ً-ْـ]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');

const decoders = {};
const decode = (label, bytes) => {
  try { return (decoders[label] ??= new TextDecoder(label)).decode(bytes); } catch { return ''; }
};

// ─── Tags ─────────────────────────────────────────────────────────────────────

/**
 * Text kept in a single-byte code page: Arabic tags are often written in the
 * Windows Arabic one (and would read as "ÈÇÓã ÇáßÑÈáÇÆí" as Latin); mostly
 * high bytes means Arabic, else the Western page.
 */
function singleByte(bytes) {
  let letters = 0;
  let high = 0;
  for (const b of bytes) {
    if (b <= 0x20 || (b >= 0x30 && b <= 0x39) || '-_.,()[]'.includes(String.fromCharCode(b))) continue;
    letters++;
    if (b >= 0x80) high++;
  }
  return decode(high >= 2 && high * 2 >= letters ? 'windows-1256' : 'windows-1252', bytes);
}

/** A tag's text, trimmed; a Latin-read Arabic one ("ÈÇÓã") made Arabic again. */
export function fixTag(raw) {
  const t = String(raw ?? '').replace(/\u0000/g, '').trim();
  if (!t) return null;
  if ([...t].every((c) => c.charCodeAt(0) < 0x100)) {
    const bytes = Uint8Array.from(t, (c) => c.charCodeAt(0));
    if (bytes.some((b) => b >= 0x80)) return singleByte(bytes).trim() || null;
  }
  return t;
}

// ID3 text: [encoding][text], several values split by nulls (the first kept)
function id3Text(bytes, enc) {
  const strip = (s) => s.split('\u0000').find((x) => x.trim()) ?? '';
  switch (enc) {
    case 0: {
      const end = bytes.indexOf(0);
      return singleByte(end >= 0 ? bytes.subarray(0, end) : bytes);
    }
    case 1: return strip(decode(bytes[0] === 0xFE && bytes[1] === 0xFF ? 'utf-16be' : 'utf-16le', bytes));
    case 2: return strip(decode('utf-16be', bytes));
    default: return strip(decode('utf-8', bytes));
  }
}

// Where a null-terminated string in `enc` ends (two nulls, aligned, in UTF-16)
function textEnd(bytes, from, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = from; i + 1 < bytes.length; i += 2) if (bytes[i] === 0 && bytes[i + 1] === 0) return i + 2;
    return bytes.length;
  }
  const i = bytes.indexOf(0, from);
  return i < 0 ? bytes.length : i + 1;
}

// Taking the 0x00 back out after each 0xFF (the "unsynchronisation" of old taggers)
function resync(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    out.push(bytes[i]);
    if (bytes[i] === 0xFF && bytes[i + 1] === 0x00) i++;
  }
  return Uint8Array.from(out);
}

const syncsafe = (b, i) => (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3];
const be32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

const ID3_FIELDS = {
  TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TPE2: 'albumArtist', TP2: 'albumArtist',
  TALB: 'album', TAL: 'album', TCON: 'genre', TCO: 'genre',
};

async function readId3v2(file) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  const version = head[3];
  const size = syncsafe(head, 6);
  let tag = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
  if (head[5] & 0x80 && version < 4) tag = resync(tag);
  let pos = 0;
  if (head[5] & 0x40) pos = version === 4 ? syncsafe(tag, 0) : be32(tag, 0) + 4; // extended header
  const tags = {};
  let cover = null;
  const idLen = version === 2 ? 3 : 4;
  const headLen = version === 2 ? 6 : 10;
  while (pos + headLen <= tag.length) {
    const id = String.fromCharCode(...tag.subarray(pos, pos + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break; // the padding
    const frameSize = version === 2 ? (tag[pos + 3] << 16) | (tag[pos + 4] << 8) | tag[pos + 5]
      : version === 4 ? syncsafe(tag, pos + 4) : be32(tag, pos + 4);
    const flags = version === 2 ? 0 : (tag[pos + 8] << 8) | tag[pos + 9];
    let data = tag.subarray(pos + headLen, pos + headLen + frameSize);
    pos += headLen + frameSize;
    if (version === 4) {
      if (flags & 0x0001) data = data.subarray(4); // a data length before it
      if (flags & 0x0002) data = resync(data);
    }
    if (!data.length) continue;
    const field = ID3_FIELDS[id];
    if (field && !tags[field]) tags[field] = id3Text(data.subarray(1), data[0]);
    else if ((id === 'APIC' || id === 'PIC') && (!cover || cover.front === false)) {
      const enc = data[0];
      let i = 1;
      let mime;
      if (id === 'PIC') {
        mime = String.fromCharCode(...data.subarray(1, 4)).toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
        i = 4;
      } else {
        const end = data.indexOf(0, 1);
        mime = String.fromCharCode(...data.subarray(1, end)).toLowerCase() || 'image/jpeg';
        i = end + 1;
      }
      const front = data[i] === 3;
      i = textEnd(data, i + 1, enc);
      if (!mime.includes('/')) mime = `image/${mime === 'png' ? 'png' : 'jpeg'}`;
      cover = { bytes: data.slice(i), mime, front };
    }
  }
  return { ...tags, cover };
}

async function readId3v1(file) {
  if (file.size < 128) return {};
  const b = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
  if (b[0] !== 0x54 || b[1] !== 0x41 || b[2] !== 0x47) return {}; // "TAG"
  const field = (from, len) => {
    const part = b.subarray(from, from + len);
    const end = part.indexOf(0);
    return singleByte(end >= 0 ? part.subarray(0, end) : part).trim();
  };
  return { title: field(3, 30), artist: field(33, 30), album: field(63, 30) };
}

// MP4 (M4A): the ilst atom under moov › udta › meta, which may sit after the audio
const MP4_FIELDS = { '©nam': 'title', '©ART': 'artist', aART: 'albumArtist', '©alb': 'album', '©gen': 'genre' };
async function readMp4(file) {
  const boxType = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
  let at = 0;
  let moov = null;
  while (at + 8 <= file.size) {
    const h = new Uint8Array(await file.slice(at, at + 16).arrayBuffer());
    let size = be32(h, 0);
    const type = boxType(h, 4);
    if (size === 1) size = be32(h, 8) * 2 ** 32 + be32(h, 12);
    else if (size === 0) size = file.size - at;
    if (size < 8) break;
    if (type === 'moov') { moov = new Uint8Array(await file.slice(at, at + size).arrayBuffer()); break; }
    at += size;
  }
  if (!moov) return {};
  // The children of the box at `from` (its header `skip` long)
  const children = (b, from, end) => {
    const out = [];
    for (let i = from; i + 8 <= end;) {
      const size = be32(b, i);
      if (size < 8 || i + size > end) break;
      out.push({ type: boxType(b, i + 4), start: i, end: i + size });
      i += size;
    }
    return out;
  };
  const find = (list, type) => list.find((x) => x.type === type);
  const udta = find(children(moov, 8, moov.length), 'udta');
  const meta = udta && find(children(moov, udta.start + 8, udta.end), 'meta');
  const ilst = meta && find(children(moov, meta.start + 12, meta.end), 'ilst');
  if (!ilst) return {};
  const tags = {};
  for (const item of children(moov, ilst.start + 8, ilst.end)) {
    const data = find(children(moov, item.start + 8, item.end), 'data');
    if (!data) continue;
    const value = moov.subarray(data.start + 16, data.end);
    const kind = be32(moov, data.start + 8) & 0xFFFFFF;
    if (item.type === 'covr' && !tags.cover) tags.cover = { bytes: value.slice(), mime: kind === 14 ? 'image/png' : 'image/jpeg' };
    else if (MP4_FIELDS[item.type] && !tags[MP4_FIELDS[item.type]]) tags[MP4_FIELDS[item.type]] = decode('utf-8', value);
  }
  return tags;
}

/** The file's tags: { title, artist, albumArtist, album, genre, cover: { bytes, mime } }. */
export async function readTags(file) {
  let tags = {};
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) tags = await readId3v2(file); // "ID3"
    else if (String.fromCharCode(...head.subarray(4, 8)) === 'ftyp') tags = await readMp4(file);
    if (!tags.title && !tags.artist) tags = { ...(await readId3v1(file)), ...tags, cover: tags.cover };
  } catch (err) {
    console.warn('Tags not read:', err);
  }
  return tags;
}

/** Its length, from the browser's own reading of the file: "4:05", "1:02:05"; "0:00" when unknown. */
export function readDuration(file) {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    const timer = setTimeout(() => done('0:00'), 8000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => { clearTimeout(timer); done(duration(a.duration * 1000)); };
    a.onerror = () => { clearTimeout(timer); done('0:00'); };
    a.src = url;
  });
}

/** A cover as sent: a JPEG no larger than 1000px across (the file's own can be several megabytes). */
export async function shrinkCover(blob, max = 1000) {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  } catch {
    return null;
  }
}

// ─── Guessing ─────────────────────────────────────────────────────────────────

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|wma|amr|3gp|mp4|webm)$/i;
const SITE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|info|ir|iq|tv|me|co)\b\S*/gi;
const HANDLE = /@[\w.]+/g;
const JUNK_IN_BRACKETS = /[[(【{][^\])】}]*(official|video|audio|lyric|hd|4k|mp3|kbps|clip|حصري|فيديو|كليب|اوديو|أوديو|نسخة|جودة|تصميم)[^\])】}]*[\])】}]/gi;
const JUNK_WORDS = /\b(\d{2,3}\s?kbps|\d{3}k|official\s+(video|audio)|lyrics?\s+video|hq|hd)\b/gi;
const TRACK_NUMBER = /^\s*(track\s*)?\d{1,2}\s*[-._)]+\s*/i;
const EDGES = ' -–—_|.·:،,';
const trimEdges = (s) => {
  let a = 0;
  let b = s.length;
  while (a < b && (/\s/.test(s[a]) || EDGES.includes(s[a]))) a++;
  while (b > a && (/\s/.test(s[b - 1]) || EDGES.includes(s[b - 1]))) b--;
  return s.slice(a, b);
};

/** A file name or a title without its extension, track number, site, "(Official Video)" and such. */
export function cleanTitle(s) {
  let t = String(s || '').replace(AUDIO_EXT, '').replace(/_/g, ' ');
  t = t.replace(JUNK_IN_BRACKETS, ' ').replace(SITE, ' ').replace(HANDLE, ' ').replace(JUNK_WORDS, ' ');
  t = t.replace(TRACK_NUMBER, '');
  t = t.replace(/[[(]\s*[\])]/g, ' ').replace(/\s+/g, ' ');
  return trimEdges(t);
}

// What a phone or a recorder names a file ("AUD-20240101-WA0012", "PTT-20240301", "rec"), and tags that say nothing
const NO_NAME = /^((aud|ptt|rec|voice|audio|track|record|recording|vid|file|untitled|unknown|new recording)([-_ ]*\d[\w\- ]*)?|\d[\d\- ]*|صوت|تسجيل|مقطع|بدون عنوان)$/i;
const NO_ARTIST = /^(unknown( artist)?|<unknown>|various( artists)?|artist|مجهول|غير معروف)$/i;
const meaningful = (s) => {
  if (s == null) return null;
  const t = cleanTitle(s);
  return t.length >= 2 && !NO_NAME.test(t) ? t : null;
};

/** "باسم الكربلائي - يا حسين": its two sides, or null. */
export function split(name) {
  for (const sep of [' - ', ' – ', ' — ', ' | ', ' ـ ']) {
    const i = name.indexOf(sep);
    if (i > 0 && i + sep.length < name.length) {
      const a = trimEdges(name.slice(0, i));
      const b = trimEdges(name.slice(i + sep.length));
      if (a && b) return [a, b];
    }
  }
  return null;
}

const HONORIFICS = new Set(['الرادود', 'الملا', 'ملا', 'السيد', 'سيد', 'الشيخ', 'شيخ', 'الحاج', 'حاج', 'المنشد', 'القاري', 'الخطيب']);
// What a reciter is, not their name: left out of a name new to the library
const JOB_TITLES = new Set(['الرادود', 'رادود', 'المنشد', 'منشد', 'القاري', 'الخطيب']);

/** A name as compared: no tashkeel, the same alef and yaa, no titles ("الرادود", "الملا"). */
export function nameKey(s) {
  const words = normalize(s).replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !HONORIFICS.has(w));
  return (kept.length ? kept : words).join(' ');
}

/** A reciter's name as written for the library: no "الرادود" before it. */
export function newReciterName(s) {
  const t = cleanTitle(s);
  return t.split(/\s+/).filter((w) => !JOB_TITLES.has(normalize(w))).join(' ') || t;
}

const keys = new Map();
const keyOf = (name) => { if (!keys.has(name)) keys.set(name, nameKey(name)); return keys.get(name); };

/**
 * The library's reciter named `candidate` ("الرادود باسم الكربلائى" → "باسم
 * الكربلائي"), or null. `translate`: English names of older uploads made Arabic.
 */
export function matchReciter(candidate, reciters, translate = (x) => x) {
  const key = nameKey(translate(candidate));
  if (key.length < 3) return null;
  const known = reciters.filter((r) => r.name !== 'مجهول');
  const best = (list) => list.reduce((a, r) => (!a || r.count > a.count ? r : a), null);
  const exact = best(known.filter((r) => keyOf(r.name) === key));
  if (exact) return exact;
  // One within the other ("باسم الكربلائي" in "باسم الكربلائي 2024"); two words at least, so "علي" alone matches nothing
  return best(known.filter((r) => {
    const k = keyOf(r.name);
    return k.length >= 6 && k.includes(' ') && (key.includes(k) || (key.includes(' ') && key.length >= 6 && k.includes(key)));
  }));
}

/**
 * A typed reciter's name against the library, so one reciter never gets a
 * second page under another spelling: { kind, reciters } where kind is
 * 'empty'; 'known' (one of its reciters exactly); 'same' (the same name
 * written otherwise — ال، ى، ة، "الرادود"… — which must then be chosen);
 * 'like' (names a letter or two apart, or one within the other, offered to
 * choose or to keep as a new reciter); or 'new'.
 */
export function checkReciter(typed, reciters, translate = (x) => x) {
  const name = String(typed || '').trim();
  if (!name) return { kind: 'empty', reciters: [] };
  const all = reciters.filter((r) => r.name !== 'مجهول');
  const exact = all.find((r) => r.name === name);
  if (exact) return { kind: 'known', reciters: [exact] };
  const key = nameKey(translate(name));
  if (key.length < 2) return { kind: 'new', reciters: [] };
  const keyed = all.filter((r) => r.count > 0 || r.hasPhoto).map((r) => [r, keyOf(r.name)]);
  const loose = looseKey(key);
  const same = keyed.filter(([, k]) => k === key || looseKey(k) === loose).map(([r]) => r);
  if (same.length) return { kind: 'same', reciters: same.sort((a, b) => b.count - a.count).slice(0, 3) };
  const limit = loose.length >= 10 ? 2 : 1;
  const like = [];
  for (const [r, k] of keyed) {
    let d = null;
    if (k.length >= 6 && k.includes(' ') && (key.includes(k) || (key.includes(' ') && key.length >= 6 && k.includes(key)))) d = 1;
    else if (loose.length >= 5) {
      const n = distance(loose, looseKey(k), limit);
      if (n <= limit) d = n;
    }
    if (d !== null) like.push([r, d]);
  }
  like.sort((a, b) => a[1] - b[1] || b[0].count - a[0].count);
  return like.length ? { kind: 'like', reciters: like.slice(0, 3).map(([r]) => r) } : { kind: 'new', reciters: [] };
}

/** Reciters whose names hold what was typed so far (two letters on), the most heard first: offered while typing. */
export function reciterSuggestions(typed, reciters, n = 3) {
  const t = nameKey(typed);
  const name = String(typed || '').trim();
  if (t.length < 2) return [];
  return reciters
    .filter((r) => r.name !== 'مجهول' && r.count > 0 && r.name !== name && keyOf(r.name).includes(t))
    .sort((a, b) => b.count - a.count).slice(0, n);
}

/**
 * Why a reciter can't go as typed, or null: the library has them written
 * otherwise (to choose), or has one a letter or two apart (to choose, or to
 * say it is someone new: `newReciter` is the name they confirmed).
 */
export function reciterProblem(check, typed, newReciter) {
  if (check.kind === 'same') {
    return check.reciters.length === 1 ? `الرادود موجود في المكتبة باسم «${check.reciters[0].name}»، اختره` : 'الرادود موجود في المكتبة، اختر اسمه';
  }
  if (check.kind === 'like' && newReciter !== String(typed || '').trim()) {
    return `هل تقصد «${check.reciters[0].name}»؟ اختره، أو أكّد أنه رادود جديد`;
  }
  return null;
}

// Without "ال" at the words' starts nor spaces: "حسين الفيصل" and "حسين فيصل" alike
const looseKey = (key) => key.split(' ').map((w) => (w.startsWith('ال') ? w.slice(2) : w)).join('');

/** How many letters apart `a` and `b` are (Levenshtein), counting no further than `limit` + 1. */
function distance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > limit) return limit + 1;
    prev = row;
  }
  return prev[b.length];
}

/** A known reciter written in `title` ("يا حسين - باسم الكربلائي"), and the title without them: [reciter, rest] or null. */
export function reciterInTitle(title, reciters, translate) {
  const sides = split(title);
  if (sides) {
    const a = matchReciter(sides[0], reciters, translate);
    if (a) return [a, sides[1]];
    const b = matchReciter(sides[1], reciters, translate);
    if (b) return [b, sides[0]];
  }
  const norm = normalize(title);
  if (norm.length !== title.length) return null; // the letters must line up one to one, to cut the name out
  let found = null;
  for (const r of reciters) {
    if (r.name === 'مجهول' || r.count < 3 || !r.name.includes(' ')) continue;
    const n = normalize(r.name);
    if (n.length >= 6 && norm.includes(n) && (!found || n.length > found[1].length)) found = [r, n];
  }
  if (!found) return null;
  const at = norm.indexOf(found[1]);
  const rest = trimEdges((title.slice(0, at) + ' ' + title.slice(at + found[1].length))
    .split(/\s+/).filter((w) => !HONORIFICS.has(normalize(w))).join(' '));
  return rest.length >= 2 ? [found[0], rest] : null;
}

const CATEGORY_WORDS = [
  ['ziyarat', ['زياره', 'زيارات']],
  ['dua', ['دعاء', 'مناجاه', 'ادعيه', 'كميل', 'الجوشن', 'الافتتاح', 'الندبه', 'السمات', 'التوسل', 'الصحيفه', 'dua', 'duaa', 'supplication']],
  ['quran', ['سوره', 'القران', 'قران', 'تلاوه', 'ترتيل', 'quran', 'koran']],
  // Not "عرس" nor "زفاف": the wedding of al-Qasim is a Muharram poem
  ['muwalid', ['مولد', 'ميلاد', 'مواليد', 'مولود', 'افراح', 'عيد', 'تهنئه', 'ولاده', 'الغدير', 'مبارك', 'مبروك']],
  ['nasheed', ['نشيد', 'انشوده', 'اناشيد', 'nasheed', 'anasheed']],
  ['naei', ['نعي']],
  ['variety', ['محاضره', 'محاضرات', 'خطبه', 'lecture']],
];
const PREFIXES = new Set(['و', 'ف', 'ب', 'ل', 'وال', 'فال', 'بال', 'لل']);

/** The category its words point to (a birth, a supplication, a visit...); a Hussaini poem otherwise. */
export function category(...texts) {
  const words = new Set(texts.filter(Boolean).flatMap((t) => normalize(t).split(/[^\p{L}]+/u)).filter(Boolean));
  const has = (w) => [...words].some((x) => x === w || x === `ال${w}` || (x.length > w.length && x.endsWith(w) && PREFIXES.has(x.slice(0, x.length - w.length))));
  return CATEGORY_WORDS.find(([, list]) => list.some(has))?.[0] ?? 'hussainiya';
}

/** The value the database keeps for a category (the website's id for the Hussaini poems). */
export const dbCategory = (id) => (id === 'hussainiya' ? 'hussainiya_poems' : id);

/** A length as the database keeps it: "4:05", "1:02:05"; "0:00" when unknown. */
export function duration(ms) {
  const total = Math.floor((Number(ms) || 0) / 1000);
  if (!Number.isFinite(total) || total <= 0) return '0:00';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Everything at once, from the file's name and its tags (already through
 * fixTag): the tags first, the name when they say nothing; a reciter written
 * in the title or the name is taken out of it, and spelled as the library
 * spells them. → { title, reciter, category, fromTags }
 */
export function guess(fileName, tagTitle, tagArtist, tagAlbum, tagGenre, reciters, translate = (x) => x) {
  const fromName = meaningful(fileName);
  let title = meaningful(tagTitle);
  const fromTags = title != null || tagArtist != null;
  let reciter = null;

  // The artist tag, in the library's spelling (or as written, for a reciter new to it)
  if (tagArtist && !NO_ARTIST.test(tagArtist.trim())) {
    const name = matchReciter(tagArtist, reciters, translate)?.name ?? newReciterName(translate(tagArtist));
    reciter = name.length >= 2 ? name : null;
  }
  // A reciter in the title ("يا حسين - باسم الكربلائي")
  if (title) {
    const inTitle = reciterInTitle(title, reciters, translate);
    if (inTitle && (reciter == null || reciter === inTitle[0].name)) { reciter = inTitle[0].name; title = inTitle[1]; }
  }
  if (title == null && fromName != null) {
    const inName = reciterInTitle(fromName, reciters, translate);
    if (inName && (reciter == null || reciter === inName[0].name)) {
      reciter = inName[0].name;
      title = inName[1];
    } else {
      // Not a known reciter: "name - title" when a side carries a reciter's title (الرادود، الملا)
      const sides = split(fromName);
      const titled = (s) => normalize(s).split(/\s+/).some((w) => HONORIFICS.has(w));
      if (!sides) title = fromName;
      else if (reciter != null) title = nameKey(sides[0]) === nameKey(reciter) ? sides[1] : nameKey(sides[1]) === nameKey(reciter) ? sides[0] : fromName;
      else if (titled(sides[0]) && !titled(sides[1])) { reciter = newReciterName(sides[0]); title = sides[1]; }
      else if (titled(sides[1]) && !titled(sides[0])) { reciter = newReciterName(sides[1]); title = sides[0]; }
      else title = fromName;
    }
  } else if (reciter == null && fromName != null) {
    // The title from the tags; the reciter maybe in the file's name
    const inName = reciterInTitle(fromName, reciters, translate);
    if (inName) reciter = inName[0].name;
  }
  // The album's artist written as the album ("باسم الكربلائي 2024")
  if (reciter == null && tagAlbum) reciter = matchReciter(tagAlbum, reciters, translate)?.name ?? null;

  const finalTitle = title ?? '';
  return { title: finalTitle, reciter: reciter ?? '', category: category(finalTitle, tagAlbum, tagGenre), fromTags };
}

/** The extension the site's storage takes for a file (functions/api/upload.js). */
const EXTS = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac']);
export function extFor(fileName, mime) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (fileName.includes('.') && EXTS.has(ext)) return ext;
  const m = (mime || '').toLowerCase();
  if (/mp4|m4a/.test(m)) return 'm4a';
  if (/aac/.test(m)) return 'aac';
  if (/wav/.test(m)) return 'wav';
  if (/ogg/.test(m)) return 'ogg';
  if (/opus/.test(m)) return 'opus';
  if (/flac/.test(m)) return 'flac';
  return 'mp3';
}

/** "مقطع واحد"، "مقطعين"، "3 مقاطع"، "11 مقطعاً" */
export const countWord = (n) => (n === 1 ? 'مقطع واحد' : n === 2 ? 'مقطعين' : n <= 10 ? `${n} مقاطع` : `${n} مقطعاً`);
