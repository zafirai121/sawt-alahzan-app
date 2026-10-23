// The Wikisource categories that hold du'as and ziyarat (their pages and
// sizes), and WikiShia's copyright page: which texts there are to take.
import { mkdirSync, writeFileSync } from 'node:fs'
const out = process.argv[2] || 'out'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }
const get = async u => (await fetch(u, { headers: UA })).json()
const WS = 'https://ar.wikisource.org/w/api.php'
const report = {}
const seen = new Set()
async function members(cat, depth) {
  if (seen.has(cat) || depth > 2) return
  seen.add(cat)
  let cont = ''
  const list = []
  do {
    const j = await get(`${WS}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(cat)}&cmlimit=500&cmprop=title|type&format=json${cont}`)
    list.push(...j.query.categorymembers)
    cont = j.continue ? `&cmcontinue=${encodeURIComponent(j.continue.cmcontinue)}` : ''
  } while (cont)
  report[cat] = list.filter(m => m.type === 'page').map(m => m.title)
  for (const m of list.filter(m => m.type === 'subcat')) await members(m.title, depth + 1)
}
for (const c of ['تصنيف:أدعية', 'تصنيف:زيارات', 'تصنيف:أدعية شيعية', 'تصنيف:أدعية أهل البيت', 'تصنيف:نصوص شيعية', 'تصنيف:أدعية مأثورة', 'تصنيف:أديان']) {
  try { await members(c, 0) } catch (e) { report[c] = String(e) }
}
// The sizes of the pages found
const titles = [...new Set(Object.values(report).flat().filter(t => typeof t === 'string'))]
const sizes = {}
for (let i = 0; i < titles.length; i += 50) {
  const j = await get(`${WS}?action=query&prop=info&titles=${encodeURIComponent(titles.slice(i, i + 50).join('|'))}&format=json`)
  for (const p of Object.values(j.query.pages)) sizes[p.title] = p.length
}
report.sizes = sizes
for (const u of ['https://ar.wikishia.net/view/%D9%88%D9%8A%D9%83%D9%8A_%D8%B4%D9%8A%D8%B9%D8%A9:%D8%AD%D9%82%D9%88%D9%82_%D8%A7%D9%84%D9%86%D8%B4%D8%B1',
  'https://ar.wikishia.net/view/%D9%88%D9%8A%D9%83%D9%8A_%D8%B4%D9%8A%D8%B9%D8%A9:%D8%AD%D9%82%D9%88%D9%82_%D8%A7%D9%84%D8%AA%D8%A3%D9%84%D9%8A%D9%81',
  'https://en.wikishia.net/view/WikiShia:Copyrights']) {
  try {
    const r = await fetch(u, { headers: UA })
    const h = await r.text()
    const body = (h.match(/<div id="mw-content-text"[\s\S]*?<\/main>/)?.[0] || h).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    report[u] = r.status + ' ' + body.slice(0, 2500)
  } catch (e) { report[u] = String(e) }
}
writeFileSync(`${out}/report2.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1).slice(0, 4000))
