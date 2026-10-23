// Persian Wikisource's Mafatih al-Jinan: its chapters take their words from the
// scanned book's pages (the Page: namespace, proofread one by one). How many of
// the book's pages are written out, how well (proofread or not), and a few
// chapters as the site shows them.
import { mkdirSync, writeFileSync } from 'node:fs'
const out = process.argv[2] || 'out'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }
const get = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json() }
const FA = 'https://fa.wikisource.org/w/api.php'
const report = {}
// The namespaces (the Page: one's number)
const ns = await get(`${FA}?action=query&meta=siteinfo&siprop=namespaces&format=json`)
report.namespaces = Object.values(ns.query.namespaces).map((n) => `${n.id} ${n['*']} ${n.canonical || ''}`)
const pageNs = Object.values(ns.query.namespaces).find((n) => n.canonical === 'Page')?.id
report.pageNs = pageNs
// The book's pages written out
const pages = []
let cont = ''
do {
  const j = await get(`${FA}?action=query&list=allpages&apnamespace=${pageNs}&apprefix=${encodeURIComponent('کتاب مفاتیح الجنان.pdf/')}&aplimit=500&format=json${cont}`)
  pages.push(...j.query.allpages.map((p) => p.title))
  cont = j.continue ? `&apcontinue=${encodeURIComponent(j.continue.apcontinue)}` : ''
} while (cont)
report.pagesWritten = pages.length
// Their proofreading quality (0 empty .. 4 validated), a sample
const quality = {}
for (let i = 0; i < Math.min(pages.length, 400); i += 40) {
  const batch = pages.slice(i, i + 40)
  for (let k = 0; k < batch.length; k += 8) {
    try {
      const j = await get(`${FA}?action=query&prop=proofread&titles=${encodeURIComponent(batch.slice(k, k + 8).join('|'))}&format=json`)
      for (const p of Object.values(j.query.pages)) quality[p.title] = p.proofread?.quality ?? '?'
    } catch (e) { quality[batch[k]] = String(e) }
  }
}
report.quality = quality
report.pageList = pages.slice(0, 50)
// A few chapters as shown (their pages put together)
for (const title of ['مفاتیح الجنان/فصل اول در تعقیبات مشترکه', 'مفاتیح الجنان/فصل ششم در ذکر بعضی از ادعیه مشهور', 'مفاتیح الجنان/فصل هشتم در مناجات']) {
  try {
    const j = await get(`${FA}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext|text&format=json`)
    const html = j.parse.text['*']
    const text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n')
    writeFileSync(`${out}/fa-chapter-${title.split('/')[1].slice(0, 20)}.txt`, j.parse.wikitext['*'] + '\n\n======\n\n' + text)
  } catch (e) { writeFileSync(`${out}/fa-chapter-err.txt`, String(e)) }
}
// The Persian Sahifa's headings (has it the fifteen munajat?)
try {
  const j = await get(`${FA}?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent('صحیفه سجادیه')}&format=json`)
  const wt = Object.values(j.query.pages)[0].revisions[0].slots.main['*']
  report.faSahifaHeads = [...wt.matchAll(/^=+([^=].*?)=+\s*$/gm)].map((m) => m[1].trim()).slice(0, 120)
  writeFileSync(`${out}/fa-sahifa-head.txt`, wt.slice(0, 6000))
} catch (e) { report.faSahifaHeads = String(e) }
writeFileSync(`${out}/report4.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify({ pageNs, pagesWritten: pages.length }, null, 1))
