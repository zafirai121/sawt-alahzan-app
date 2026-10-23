// Where else the missing du'as and ziyarat may be written out on the open wikis:
// a search of the scanned books' pages (Page:) and indexes (Index:) as well as
// the main pages, on Persian, Arabic and Urdu Wikisource, by name and by first
// words; and the books (Index: pages) that hold du'as. For a look, on the
// "read-sources" branch.
import { mkdirSync, writeFileSync } from 'node:fs'
const out = (process.argv[2] || 'out') + '/explore7'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }
const get = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json() }
const WIKIS = {
  fa: 'https://fa.wikisource.org/w/api.php',
  ar: 'https://ar.wikisource.org/w/api.php',
  ur: 'https://ur.wikisource.org/w/api.php',
}

const nsCache = {}
async function namespaces(api) {
  if (!nsCache[api]) {
    const j = await get(`${api}?action=query&meta=siteinfo&siprop=namespaces&format=json`)
    nsCache[api] = Object.values(j.query.namespaces)
  }
  return nsCache[api]
}
async function search(api, q, ns) {
  const j = await get(`${api}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=15&srnamespace=${ns}&srprop=snippet|size&format=json`)
  return (j.query?.search || []).map((s) => ({ title: s.title, size: s.size, snippet: s.snippet.replace(/<[^>]+>/g, '').slice(0, 160) }))
}

// By name, and by first words (only to find a page: the words are taken from the page found)
const QUERIES = [
  'دعاء الندبة', 'دعای ندبه', 'دعاء العهد', 'دعای عهد', 'دعاء الافتتاح', 'دعای افتتاح', 'دعاء الحجب', 'دعاء الاحتجاب', 'دعاء أم داود', 'دعاء علقمة',
  'زيارة وارث', 'زیارت وارث', 'زيارة الأربعين', 'زیارت اربعین', 'زيارة أمين الله', 'زیارت امین الله', 'زيارة آل يس', 'زیارت آل یس',
  'زيارة الناحية', 'زیارت ناحیه', 'الزيارة الرجبية', 'زیارت رجبیه', 'الزيارة الجامعة الصغيرة', 'زيارة العباس', 'زیارت حضرت عباس',
  'المناجاة الشعبانية', 'مناجات شعبانیه', 'حديث الكساء', 'زيارة أهل القبور', 'دعاء يوم عرفة', 'صلاة جعفر', 'صلاة الليل',
  'مصباح المتهجد', 'زاد المعاد', 'إقبال الأعمال', 'البلد الأمين', 'مصباح الكفعمي', 'كامل الزيارات', 'المزار', 'تحفة الزائر', 'مفاتیح الجنان', 'مفاتيح الجنان', 'ضیاء الصالحین',
  'السلام عليك يا وارث آدم', 'السلام علیک یا وارث آدم', 'الحمد لله رب العالمين وصلى الله على سيدنا محمد نبيه وآله وسلم تسليما اللهم لك الحمد على ما جرى به قضاؤك',
  'اللهم رب النور العظيم ورب الكرسي الرفيع', 'سلام على آل يس', 'السلام عليك يا أمين الله في أرضه', 'اللهم إني أفتتح الثناء بحمدك',
  'السلام على ولي الله وحبيبه السلام على خليل الله ونجيبه', 'اللهم صل على محمد وآل محمد واسمع دعائي إذا دعوتك',
]
const report = {}
for (const [wiki, api] of Object.entries(WIKIS)) {
  report[wiki] = { namespaces: {}, results: {} }
  let ns
  try { ns = await namespaces(api) } catch (e) { report[wiki].error = String(e); continue }
  const want = ns.filter((n) => [0, 104, 106].includes(n.id) || ['Page', 'Index'].includes(n.canonical))
  report[wiki].namespaces = Object.fromEntries(want.map((n) => [n.id, `${n['*']} (${n.canonical || ''})`]))
  const ids = want.map((n) => n.id).join('|')
  for (const q of QUERIES) {
    try { report[wiki].results[q] = await search(api, q, ids) } catch (e) { report[wiki].results[q] = String(e) }
  }
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
writeFileSync(`${out}/report.txt`, Object.entries(report).map(([w, r]) => `##### ${w} ${JSON.stringify(r.namespaces)} ${r.error || ''}\n`
  + Object.entries(r.results || {}).map(([q, l]) => `== ${q}\n` + (Array.isArray(l) ? l.map((x) => `  ${x.title} | ${x.size} | ${x.snippet}`).join('\n') : `  ${l}`)).join('\n')).join('\n\n'))
console.log(Object.entries(report).map(([w, r]) => `${w}: ${Object.values(r.results || {}).filter((l) => Array.isArray(l) && l.length).length} queries with results`).join('\n'))
