// How many more Shia books, besides the ones asked for, the Bibliotheca
// Alexandrina's scans on the Internet Archive hold in old printings (by 1930),
// and which: by their subjects. Its catalogue dates a printing "1307 [1890]",
// which the search gives as a year alone, so a year is read as Hijri up to
// 1450 (by 1348 is by 1930) and as Gregorian from 1450 (by 1930 is old).
// Then each old one's own record, for its bracketed Gregorian year and its
// PDFs. For a look, on the "read-sources" branch.
import { mkdirSync, writeFileSync } from 'node:fs'
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
const year = (d) => { const m = String(d || '').match(/\d{4}/); return m ? +m[0] : null }
/** Old by the search's year alone: Hijri by 1348, or Gregorian 1450–1930. */
const oldByYear = (y) => y != null && ((y >= 1000 && y <= 1348) || (y >= 1450 && y <= 1930))
/** The record's own date: its bracketed Gregorian years, or one from 1450; "18--" is of the 1800s. */
function gregorian(d) {
  const s = String(d || '')
  if (/18--/.test(s)) return [1899]
  const br = [...s.matchAll(/\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/\b(1[4-9]\d\d)\b/g)].map((x) => +x[1]))
  if (br.length) return br
  const ys = [...s.matchAll(/\b(\d{4})\b/g)].map((x) => +x[1])
  return ys.filter((y) => y >= 1450).length ? ys.filter((y) => y >= 1450) : ys.filter((y) => y >= 1000 && y < 1450).map((y) => Math.round(y * 0.970229 + 621.57))
}

const SUBJECTS = ['الشيعة', 'شيعة', 'الشيعه', 'الامامية', 'الإمامية', 'فقه الشيعة', 'فقه الإمامية', 'الادعية', 'الأدعية', 'الحسين بن علي', 'على بن ابى طالب', 'علي بن أبي طالب', 'الأئمة الاثنا عشر', 'المهدي المنتظر', 'الزيارات']
const q = `identifier:AAlexandrina* AND (${SUBJECTS.map((s) => `subject:"${s}"`).join(' OR ')})`
const docs = new Map()
for (let page = 1; page <= 20; page++) {
  const j = await get(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=subject&fl[]=language&fl[]=item_size&rows=1000&page=${page}&output=json`)
  const list = j.response?.docs || []
  for (const d of list) docs.set(d.identifier, d)
  if (list.length < 1000) break
  await sleep(500)
}
const all = [...docs.values()]
const cand = all.filter((d) => oldByYear(year(d.date)))
const report = { query: q, found: all.length, oldByYear: cand.length, noDate: all.filter((d) => year(d.date) == null).length }
// Each old one's record: its own date and PDFs (a few hundred at most at a time)
const checked = []
for (const d of cand.slice(0, 1500)) {
  try {
    const m = await get(`https://archive.org/metadata/${encodeURIComponent(d.identifier)}`)
    const md = m.metadata || {}
    const g = gregorian(md.date)
    const pdfs = (m.files || []).filter((f) => /\.pdf$/i.test(f.name)).map((f) => ({ name: f.name, MB: +(Number(f.size || 0) / 1e6).toFixed(1), source: f.source }))
    checked.push({
      id: d.identifier, title: [].concat(md.title || d.title).join(' '), creator: [].concat(md.creator || []).join(' | '),
      date: [].concat(md.date || []).join(' '), old: g.length > 0 && Math.max(...g) <= 1930, language: [].concat(md.language || []).join(' '),
      subject: [].concat(md.subject || []).join(' | ').slice(0, 200), licence: md.licenseurl || '',
      originalMB: pdfs.filter((p) => p.source === 'original').reduce((s, p) => s + p.MB, 0),
      textMB: pdfs.filter((p) => p.source !== 'original').reduce((s, p) => s + p.MB, 0),
    })
  } catch (e) { checked.push({ id: d.identifier, error: String(e) }) }
  await sleep(150)
}
const old = checked.filter((c) => c.old)
report.checked = checked.length
report.old = old.length
report.originalGB = +(old.reduce((s, c) => s + c.originalMB, 0) / 1000).toFixed(1)
report.textGB = +(old.reduce((s, c) => s + c.textMB, 0) / 1000).toFixed(1)
report.languages = Object.entries(old.reduce((m, c) => ((m[c.language] = (m[c.language] || 0) + 1), m), {}))
writeFileSync(`${out}/more.json`, JSON.stringify({ report, old, rest: checked.filter((c) => !c.old) }, null, 1))
const lines = old.map((c) => `${c.id} | ${c.title.slice(0, 90)} | ${c.creator.slice(0, 50)} | ${c.date} | ${c.language} | ${c.originalMB.toFixed(0)}/${c.textMB.toFixed(0)} MB`)
writeFileSync(`${out}/more.txt`, lines.join('\n'))
console.log(JSON.stringify(report, null, 1))
console.log(lines.slice(0, 80).join('\n'))
