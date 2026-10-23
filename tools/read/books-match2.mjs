// A second look for the books with no copy old enough yet, in the Bibliotheca
// Alexandrina's scans on the Internet Archive (lithographs and old prints, each
// dated "1307 [1890]": the Hijri year and the Gregorian): by the title's most
// telling word and the author, as their titles are written the old way
// ("كتاب الاستبصار فيما اختلف من الاخبار"). A copy is old when its Gregorian
// year (in brackets, or a year from 1450) is by 1930; "[19--]" is not known.
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
const plain = (s) => String(s || '').replace(/[ً-ْٰـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىی]/g, 'ي').replace(/ک/g, 'ك').toLowerCase()
const STOP = new Set(['في', 'و', 'على', 'الى', 'من', 'عن', 'بن', 'ابن', 'الشيخ', 'السيد', 'الامام', 'منسوب', 'محمد', 'علي', 'احمد', 'عبد', 'الله', 'حسن', 'حسين', 'جعفر', 'ابراهيم', 'ابو', 'ابي', 'كتاب', 'تفسير'])
const ALIASES = {
  'الشيخ الصدوق': ['الصدوق', 'بابويه'], 'الشيخ المفيد': ['المفيد', 'النعمان'], 'الشريف المرتضى': ['المرتضى', 'علم الهدي'],
  'العلامة الحلي': ['العلامه', 'الحلي', 'المطهر'], 'الشيخ الطوسي': ['الطوسي'], 'السيد ابن طاووس': ['طاووس', 'طاوس'],
  'الشهيد الأول': ['الشهيد', 'مكي'], 'الشهيد الثاني': ['الشهيد', 'زين الدين'], 'المحقق الحلي': ['المحقق', 'الحلي'],
  'الإمام زين العابدين': ['زين العابدين', 'السجاد'], 'الشريف الرضي': ['الرضي'],
}
const authorKeys = (a) => (ALIASES[a] || plain(a).split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))).map(plain)
/** The printing's Gregorian year(s): bracketed ones, else years from 1450; none for "[19--]". */
function gregorian(d) {
  const s = String(d || '')
  const br = [...s.matchAll(/\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/\b(1[4-9]\d\d)\b/g)].map((x) => +x[1]))
  if (br.length) return br
  const yrs = [...s.matchAll(/\b(\d{4})\b/g)].map((x) => +x[1]).filter((y) => y >= 1450)
  return yrs
}
const old = (d) => { const g = gregorian(d); return g.length > 0 && Math.max(...g) <= 1930 }

const books = readFileSync(new URL('./books-list.txt', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('|'))
  .map((l, i) => { const [title, author] = l.split('|').map((s) => s.trim()); return { n: i + 1, title, author } })
const results = []
for (const b of books) {
  const tw = plain(b.title).split(/\s+/).filter((w) => !STOP.has(w))
  // The most telling word: the longest of the first three, without its "ال"
  const key = tw.slice(0, 3).sort((a, c) => c.length - a.length)[0].replace(/^ال/, '')
  const keys = authorKeys(b.author)
  const forms = [...new Set([key, key.replace(/ي$/, 'ى'), key.replace(/ه$/, 'ة')])]
  // Their titles are often one word ("162599_كتاب_الاستبصار_فيما..."): the word inside it, and the word alone
  const qs = [
    `identifier:(AAlexandrina* OR BBib-Alex*) AND title:(${forms.map((f) => `*${f}*`).join(' OR ')})`,
    `identifier:(AAlexandrina* OR BBib-Alex*) AND title:(${forms.flatMap((f) => [f, `ال${f}`]).join(' OR ')})`,
  ]
  const q = qs.join(' || ')
  const byId = new Map()
  const errors = []
  for (const one of qs) {
    try {
      const j = await get(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(one)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=publisher&rows=300&output=json`)
      for (const d of j.response?.docs || []) byId.set(d.identifier, d)
    } catch (e) { errors.push(String(e)) }
    await sleep(300)
  }
  const docs = [...byId.values()]
  if (!docs.length && errors.length) { results.push({ ...b, error: errors.join(' ; ') }); continue }
  const want = tw.slice(0, 2).map((w) => w.replace(/^ال/, ''))
  const found = docs.map((d) => ({ id: d.identifier, title: [].concat(d.title).join(' '), creator: [].concat(d.creator || []).join('، '), date: [].concat(d.date || []).join(' '), publisher: [].concat(d.publisher || []).join(' ') }))
    .filter((d) => {
      const t = plain(d.title), all = plain(`${d.title} ${d.creator}`)
      return want.every((w) => t.includes(w)) && keys.some((k) => all.includes(k))
    })
    .map((d) => ({ ...d, old: old(d.date) }))
  results.push({ ...b, q, hits: docs.length, old: found.filter((d) => d.old).length, other: found.filter((d) => !d.old).length, found: found.slice(0, 40) })
  await sleep(500)
}
writeFileSync(`${out}/match2.json`, JSON.stringify(results, null, 1))
const lines = results.map((r) => `${String(r.n).padStart(3)} ${r.title} — ${r.author} | old ${r.old ?? '-'} other ${r.other ?? '-'} | ${(r.found || []).filter((d) => d.old).slice(0, 2).map((d) => `${d.id} ${d.date}`).join(' ; ') || r.error || ''}`)
writeFileSync(`${out}/match2.txt`, lines.join('\n'))
console.log(lines.join('\n'))
