// What the open sources hold for the "اقرأ" part: for each du'a and ziyara
// wanted, the pages Arabic Wikisource has under that name (and their size),
// WikiShia's pages and licence, and Tanzil's Quran text (its licence header).
// Run on GitHub (read-sources.yml), which can reach these sites; the report
// goes to the "read-sources" branch.
import { mkdirSync, writeFileSync } from 'node:fs'

const out = process.argv[2] || 'out'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }

const wanted = {
  duas: ['دعاء كميل', 'دعاء الصباح', 'دعاء التوسل', 'دعاء الندبة', 'دعاء الافتتاح', 'دعاء العهد', 'دعاء أبي حمزة الثمالي',
    'دعاء عرفة', 'دعاء السمات', 'الجوشن الكبير', 'الجوشن الصغير', 'دعاء المشلول', 'دعاء يستشير', 'دعاء الفرج',
    'المناجاة الخمس عشرة', 'دعاء مكارم الأخلاق', 'حديث الكساء', 'دعاء النور', 'دعاء العشرات', 'دعاء الحزين', 'الصحيفة السجادية',
    'مفاتيح الجنان', 'دعاء يوم الأحد', 'دعاء علقمة', 'دعاء صنمي قريش'],
  ziyarat: ['زيارة عاشوراء', 'زيارة وارث', 'زيارة الأربعين', 'زيارة أمين الله', 'الزيارة الجامعة الكبيرة', 'زيارة آل ياسين',
    'زيارة الناحية المقدسة', 'زيارة العباس', 'زيارة الإمام علي', 'زيارة فاطمة الزهراء', 'زيارة الإمام الرضا', 'الزيارة الرجبية',
    'زيارة الجامعة الصغيرة', 'زيارة الإمام الحسين'],
}

async function json(url) {
  const r = await fetch(url, { headers: UA })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}
async function text(url) {
  const r = await fetch(url, { headers: UA })
  return { status: r.status, body: await r.text() }
}

const report = { wikisource: {}, wikishia: {}, tanzil: {} }
const WS = 'https://ar.wikisource.org/w/api.php'
for (const [kind, names] of Object.entries(wanted)) {
  for (const name of names) {
    try {
      const j = await json(`${WS}?action=query&list=search&srsearch=${encodeURIComponent(name)}&srlimit=8&srnamespace=0&format=json&srprop=size|wordcount`)
      report.wikisource[name] = j.query.search.map(s => ({ title: s.title, size: s.size, words: s.wordcount }))
    } catch (e) { report.wikisource[name] = String(e) }
  }
}
// Wikisource's licence notice, as its pages show it
try {
  const p = await text('https://ar.wikisource.org/wiki/%D9%88%D9%8A%D9%83%D9%8A_%D9%85%D8%B5%D8%AF%D8%B1:%D8%AD%D9%82%D9%88%D9%82_%D8%A7%D9%84%D9%86%D8%B3%D8%AE')
  report.wikisource_license_page = p.status + ' ' + (p.body.match(/creativecommons\.org\/[a-z/.0-9-]+/g) || []).slice(0, 5).join(' ')
} catch (e) { report.wikisource_license_page = String(e) }

// WikiShia: the API, its categories of texts, and the licence in a page's footer
for (const api of ['https://ar.wikishia.net/api.php', 'https://ar.wikishia.net/w/api.php']) {
  try {
    const cats = {}
    for (const cat of ['تصنيف:نصوص أدعية مفاتيح الجنان', 'تصنيف:أدعية مفاتيح الجنان', 'تصنيف:زيارات مفاتيح الجنان', 'تصنيف:نصوص الزيارات', 'تصنيف:نصوص الأدعية']) {
      const j = await json(`${api}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(cat)}&cmlimit=200&format=json`)
      cats[cat] = (j.query?.categorymembers || []).map(m => m.title)
    }
    report.wikishia = { api, cats }
    break
  } catch (e) { report.wikishia[api] = String(e) }
}
try {
  const p = await text('https://ar.wikishia.net/view/%D8%AF%D8%B9%D8%A7%D8%A1_%D9%83%D9%85%D9%8A%D9%84')
  const foot = p.body.match(/<footer[\s\S]*?<\/footer>/)?.[0] || ''
  report.wikishia_footer = p.status + ' ' + foot.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1200)
  report.wikishia_cc = (p.body.match(/creativecommons\.org\/[a-z/.0-9-]+/g) || []).slice(0, 5)
} catch (e) { report.wikishia_footer = String(e) }

// Tanzil: the Uthmani text's header (its licence) and a line count
try {
  const t = await text('https://tanzil.net/pub/download/index.php?marks=true&sajdah=true&rub=false&alif=true&quranType=uthmani&outType=txt-2&agree=true')
  const lines = t.body.split('\n')
  report.tanzil = { status: t.status, verses: lines.filter(l => /^\d+\|\d+\|/.test(l)).length, header: lines.filter(l => l.startsWith('#')).join('\n').slice(0, 2500), first: lines.slice(0, 2) }
  writeFileSync(`${out}/quran-uthmani.txt`, t.body)
} catch (e) { report.tanzil = String(e) }
try {
  const m = await text('https://tanzil.net/res/text/metadata/quran-data.js')
  writeFileSync(`${out}/quran-data.js`, m.body)
  report.tanzil_meta = m.status + ' ' + m.body.length
} catch (e) { report.tanzil_meta = String(e) }

// A few pages as they are, to see how their text is written
for (const title of ['دعاء كميل', 'زيارة عاشوراء', 'الصحيفة السجادية']) {
  try {
    const j = await json(`${WS}?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(title)}&format=json&redirects=1`)
    const page = Object.values(j.query.pages)[0]
    writeFileSync(`${out}/ws-${title}.txt`, page.revisions?.[0]?.slots?.main?.['*'] || JSON.stringify(page))
  } catch (e) { writeFileSync(`${out}/ws-${title}.txt`, String(e)) }
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1).slice(0, 6000))
