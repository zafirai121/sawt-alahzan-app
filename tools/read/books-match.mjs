// The books asked for (books-list.txt: "title | author" a line), looked for in
// the Internet Archive: the copies found, each judged by what may be shared —
//  - "old": printed by 1930 (a year to 1930, or a Hijri year to 1309, which is
//    by 1892 in the lunar calendar and by 1930 in the solar one): the edition
//    itself is in the public domain;
//  - "declared": its uploader gave it an open licence (CC0, CC BY, CC BY-SA, the
//    Public Domain Mark), not checked by anyone else;
//  - anything else: rights unknown, not to be shared.
// For the old ones, their PDF files and sizes. For a look, on the "read-sources" branch.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const out = (process.argv[2] || 'out') + '/books'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function get(u, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(u, { headers: UA })
    if (r.ok) return r.json()
    if (i >= tries || ![429, 500, 502, 503, 504].includes(r.status)) throw new Error(`${r.status} ${u}`)
    await sleep(3000 * (i + 1))
  }
}

const books = readFileSync(new URL('./books-list.txt', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('|'))
  .map((l, i) => { const [title, author] = l.split('|').map((s) => s.trim()); return { n: i + 1, title, author } })

/** For comparing: no harakat or tatweel, one alef, ة as ه, ى as ي, Persian ی ک as Arabic. */
const plain = (s) => String(s || '').replace(/[ً-ْٰـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىی]/g, 'ي').replace(/ک/g, 'ك').toLowerCase()
const STOP = new Set(['في', 'و', 'على', 'الى', 'من', 'عن', 'بن', 'ابن', 'الشيخ', 'السيد', 'الامام', 'منسوب', 'محمد', 'علي', 'احمد', 'عبد', 'الله', 'حسن', 'حسين', 'جعفر', 'ابراهيم', 'ابو', 'ابي'])
const words = (s) => plain(s).split(/[\s،,()\-]+/).filter((w) => w && !STOP.has(w))
// Names an author goes by in a book's details
const ALIASES = {
  'الشيخ الصدوق': ['الصدوق', 'بابويه'], 'الشيخ المفيد': ['المفيد', 'النعمان'], 'الشريف المرتضى': ['المرتضى', 'علم الهدي'],
  'العلامة الحلي': ['العلامه', 'الحلي', 'المطهر'], 'الشيخ الطوسي': ['الطوسي'], 'السيد ابن طاووس': ['طاووس', 'طاوس'],
  'الشهيد الأول': ['الشهيد', 'مكي'], 'الشهيد الثاني': ['الشهيد', 'زين الدين'], 'المحقق الحلي': ['المحقق', 'الحلي'],
  'الإمام زين العابدين': ['زين العابدين', 'السجاد', 'سجاديه'], 'الشريف الرضي': ['الرضي'],
}
const authorKeys = (a) => (ALIASES[a] || words(a).filter((w) => w.length > 2)).map(plain)

const year = (d) => { const m = String(d || '').match(/\d{4}/); return m ? Number(m[0]) : null }
const isOld = (d) => { const y = year(d); return y != null && ((y >= 1000 && y <= 1309) || (y >= 1450 && y <= 1930)) }
const openUrl = (u) => /creativecommons\.org\/(publicdomain|licenses\/by(-sa)?\/)/.test(u || '') && !/-nc|-nd/.test(u || '')

const FIELDS = ['identifier', 'title', 'creator', 'date', 'licenseurl', 'collection', 'item_size', 'downloads', 'subject', 'description', 'language']
async function search(q) {
  const j = await get(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&${FIELDS.map((f) => `fl[]=${f}`).join('&')}&rows=200&output=json`)
  return j.response?.docs || []
}
async function pdfsOf(id) {
  const j = await get(`https://archive.org/metadata/${encodeURIComponent(id)}`)
  return (j.files || []).filter((f) => /\.pdf$/i.test(f.name)).map((f) => ({ name: f.name, MB: +(Number(f.size || 0) / 1e6).toFixed(1), source: f.source, format: f.format }))
}

const results = []
for (const b of books) {
  const tw = words(b.title).slice(0, 2)
  const keys = authorKeys(b.author)
  // The title's words in the title field; then each copy kept if it names the author too
  // Each word as written, without its hamza and the like, and with a final ى (as many titles are typed)
  // (the first two of a long title: many copies give it short, "كشف المراد")
  const raw = b.title.split(/\s+/).filter((w) => !STOP.has(plain(w))).slice(0, 2)
  const forms = (w) => [...new Set([w, plain(w), plain(w).replace(/ي$/, 'ى'), plain(w).replace(/ه$/, 'ة')])].map((f) => `"${f}"`).join(' OR ')
  const q = `mediatype:texts AND ${raw.map((w) => `title:(${forms(w)})`).join(' AND ')}`
  let docs = []
  try { docs = await search(q) } catch (e) { results.push({ ...b, error: String(e) }); continue }
  // The title's own words written with "ال" too ("كافي" in "الكافي")
  const found = docs.map((d) => {
    const t = plain([].concat(d.title).join(' '))
    const all = plain([d.title, d.creator, d.description, d.subject].flat().join(' '))
    const titleOk = tw.every((w) => t.includes(w))
    const authorOk = keys.some((k) => all.includes(k))
    return { id: d.identifier, title: [].concat(d.title).join(' ').slice(0, 120), creator: [].concat(d.creator || []).join('، ').slice(0, 80), date: d.date || '', licence: d.licenseurl || '', downloads: d.downloads || 0, sizeMB: Math.round((d.item_size || 0) / 1e6), collection: [].concat(d.collection || []).slice(0, 3).join(','), titleOk, authorOk }
  }).filter((d) => d.titleOk && d.authorOk)
  for (const d of found) d.kind = isOld(d.date) ? 'old' : openUrl(d.licence) ? 'declared' : 'unknown'
  found.sort((a, b) => ({ old: 0, declared: 1, unknown: 2 }[a.kind] - { old: 0, declared: 1, unknown: 2 }[b.kind]) || b.downloads - a.downloads)
  // The PDFs of the best old copies
  for (const d of found.filter((x) => x.kind === 'old').slice(0, 4)) {
    try { d.pdfs = await pdfsOf(d.id) } catch (e) { d.pdfs = String(e) }
    await sleep(300)
  }
  results.push({ ...b, query: q, hits: docs.length, found: found.slice(0, 15), old: found.filter((x) => x.kind === 'old').length, declared: found.filter((x) => x.kind === 'declared').length, unknown: found.filter((x) => x.kind === 'unknown').length })
  await sleep(400)
}
writeFileSync(`${out}/match.json`, JSON.stringify(results, null, 1))
const line = (r) => {
  const best = r.found?.[0]
  const pdf = Array.isArray(best?.pdfs) ? best.pdfs.reduce((s, p) => s + p.MB, 0).toFixed(0) + ' MB' : ''
  return `${String(r.n).padStart(3)} ${r.title} — ${r.author} | old ${r.old ?? '-'} declared ${r.declared ?? '-'} unknown ${r.unknown ?? '-'} | ${best ? `${best.kind} ${best.id} (${best.date}) ${pdf}` : r.error || 'none'}`
}
writeFileSync(`${out}/match.txt`, results.map(line).join('\n'))
console.log(results.map(line).join('\n'))
