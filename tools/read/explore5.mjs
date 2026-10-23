// The Mafatih's first part as Persian Wikisource has it, page by page (the
// Page: namespace's wikitext, proofread), to see how its headings and du'as
// are written before taking them in.
import { mkdirSync, writeFileSync } from 'node:fs'
const out = process.argv[2] || 'out'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }
const get = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json() }
const FA = 'https://fa.wikisource.org/w/api.php'
const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])
const parts = []
for (let n = 12; n <= 160; n += 10) {
  const titles = Array.from({ length: 10 }, (_, i) => `برگه:کتاب مفاتیح الجنان.pdf/${fa(n + i)}`)
  const j = await get(`${FA}?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(titles.join('|'))}&format=json`)
  const byTitle = Object.fromEntries(Object.values(j.query.pages).map((p) => [p.title, p.revisions?.[0]?.slots?.main?.['*'] ?? '(none)']))
  for (const t of titles) parts.push(`\n@@@@ ${t}\n${byTitle[t] ?? '(missing)'}`)
}
writeFileSync(`${out}/mafatih-pages.txt`, parts.join('\n'))
console.log(parts.length, parts.join('').length)
