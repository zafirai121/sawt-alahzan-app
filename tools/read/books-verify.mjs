// The copies books-match.mjs found printed long ago (or perhaps so: a year that
// may be lunar or solar Hijri, or "1900" for a date not known), each with what
// its page says of it (publisher, place, year, notes, rights) and its PDFs, to
// be judged one by one. For a look, on the "read-sources" branch.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const out = (process.argv[2] || 'out') + '/books'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ids = JSON.parse(readFileSync(new URL('./books-verify-ids.json', import.meta.url), 'utf8'))
const KEEP = ['title', 'creator', 'date', 'year', 'publisher', 'place', 'imprint', 'description', 'notes', 'subject', 'language', 'collection', 'licenseurl', 'rights', 'possible-copyright-status', 'contributor', 'sponsor', 'scanningcenter', 'volume', 'call_number', 'identifier-bib']
const rows = []
for (const [n, id] of ids) {
  try {
    const r = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, { headers: UA })
    const j = await r.json()
    const m = Object.fromEntries(KEEP.filter((k) => j.metadata?.[k] != null).map((k) => [k, [].concat(j.metadata[k]).join(' | ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400)]))
    const pdfs = (j.files || []).filter((f) => /\.pdf$/i.test(f.name)).map((f) => `${f.name} ${(Number(f.size || 0) / 1e6).toFixed(1)}MB ${f.source}`)
    rows.push({ n, id, ...m, pdfs })
  } catch (e) { rows.push({ n, id, error: String(e) }) }
  await sleep(300)
}
writeFileSync(`${out}/verify.json`, JSON.stringify(rows, null, 1))
writeFileSync(`${out}/verify.txt`, rows.map((r) => [`## ${r.n} ${r.id}`, ...Object.entries(r).filter(([k]) => !['n', 'id'].includes(k)).map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(' ; ') : v}`)].join('\n')).join('\n'))
console.log(rows.length)
