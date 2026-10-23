// Every article in Wikipedia's categories of du'as and ziyarat (Arabic and
// Persian), and whether it gives a text in full: its longest run of vowelled
// words, and the sections the runs are in. The long ones kept whole for a look,
// on the "read-sources" branch.
import { mkdirSync, writeFileSync } from 'node:fs'
const out = (process.argv[2] || 'out') + '/explore9'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }
const get = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json() }
const WIKIS = {
  ar: ['https://ar.wikipedia.org/w/api.php', ['تصنيف:زيارات', 'تصنيف:أدعية شيعية', 'تصنيف:أدعية', 'تصنيف:أدعية إسلامية', 'تصنيف:أذكار']],
  fa: ['https://fa.wikipedia.org/w/api.php', ['رده:زیارت‌نامه‌ها', 'رده:زیارت‌نامه', 'رده:دعاها', 'رده:دعاهای شیعه', 'رده:ادعیه', 'رده:مناجات‌ها']],
}
const HARAKA = /[ً-ْ]/

async function members(api, cat, depth, seen) {
  if (seen.has(cat) || depth > 1) return []
  seen.add(cat)
  const pages = []
  let cont = ''
  do {
    const j = await get(`${api}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(cat)}&cmlimit=500&cmprop=title|type&format=json${cont}`)
    for (const m of j.query.categorymembers) {
      if (m.type === 'page') pages.push(m.title)
      else if (m.type === 'subcat') pages.push(...await members(api, m.title, depth + 1, seen))
    }
    cont = j.continue ? `&cmcontinue=${encodeURIComponent(j.continue.cmcontinue)}` : ''
  } while (cont)
  return pages
}

const report = {}
for (const [wiki, [api, cats]] of Object.entries(WIKIS)) {
  const seen = new Set()
  const titles = new Set()
  for (const c of cats) { try { (await members(api, c, 0, seen)).forEach((t) => titles.add(t)) } catch (e) { report[`${wiki} ${c}`] = String(e) } }
  report[wiki] = {}
  const list = [...titles]
  for (let i = 0; i < list.length; i += 8) {
    const batch = list.slice(i, i + 8)
    try {
      const j = await get(`${api}?action=query&prop=revisions&rvprop=content|ids&rvslots=main&titles=${encodeURIComponent(batch.join('|'))}&format=json`)
      for (const p of Object.values(j.query.pages)) {
        const wt = p.revisions?.[0]?.slots?.main?.['*'] || ''
        let run = 0, best = 0, total = 0, section = '', bestSection = ''
        for (const line of wt.split('\n')) {
          const h = line.match(/^==+\s*(.*?)\s*==+\s*$/)
          if (h) { section = h[1]; continue }
          for (const w of line.split(/\s+/)) {
            if (HARAKA.test(w)) { run++; total++; if (run > best) { best = run; bestSection = section } } else if (w.replace(/[^؀-ۿ]/g, '').length > 1) run = 0
          }
        }
        report[wiki][p.title] = { revid: p.revisions?.[0]?.revid, size: wt.length, vowelled: total, longestRun: best, in: bestSection }
        if (best >= 150) writeFileSync(`${out}/${wiki}-${p.title.replace(/[\/\s:]+/g, '_')}.txt`, wt)
      }
    } catch (e) { report[wiki][batch[0]] = { error: String(e) } }
  }
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
for (const [w, r] of Object.entries(report)) if (typeof r === 'object') {
  const rows = Object.entries(r).sort((a, b) => (b[1].longestRun || 0) - (a[1].longestRun || 0))
  console.log(`${w}: ${rows.length} articles`)
  for (const [t, x] of rows.slice(0, 60)) console.log(`  ${t} | run ${x.longestRun} in «${x.in}» | vowelled ${x.vowelled} | ${x.size}`)
}
