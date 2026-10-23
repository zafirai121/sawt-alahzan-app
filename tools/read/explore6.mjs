// What else the open wikis hold of the list still missing: Persian Wikisource's
// own pages of du'as and ziyarat (each its Arabic, often with a Persian
// translation), its Mafatih al-Jinan's chapters, and Arabic Wikisource's pages
// by title and by search. For each page: its size, how it is written
// (transcluded from the scanned book's pages or typed in), its categories and
// its first words. Left on the "read-sources" branch for a look.
import { mkdirSync, writeFileSync } from 'node:fs'
const out = (process.argv[2] || 'out') + '/explore6'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }
const get = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json() }
const WIKIS = { fa: 'https://fa.wikisource.org/w/api.php', ar: 'https://ar.wikisource.org/w/api.php' }

async function allPages(api, prefix, ns = 0) {
  const list = []
  let cont = ''
  do {
    const j = await get(`${api}?action=query&list=allpages&apprefix=${encodeURIComponent(prefix)}&apnamespace=${ns}&aplimit=500&apfilterredir=nonredirects&format=json${cont}`)
    list.push(...j.query.allpages.map((p) => p.title))
    cont = j.continue ? `&apcontinue=${encodeURIComponent(j.continue.apcontinue)}` : ''
  } while (cont && list.length < 3000)
  return list
}
async function search(api, q, what = 'title') {
  const j = await get(`${api}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srwhat=${what}&srlimit=20&srnamespace=0&format=json`)
  return j.query.search.map((s) => s.title)
}
// Size, categories, and the first words, a few pages a request
async function details(api, titles) {
  const d = {}
  for (let i = 0; i < titles.length; i += 8) {
    const batch = titles.slice(i, i + 8)
    try {
      const j = await get(`${api}?action=query&prop=revisions|categories&rvprop=content|size&rvslots=main&cllimit=50&titles=${encodeURIComponent(batch.join('|'))}&format=json&redirects=1`)
      for (const p of Object.values(j.query.pages)) {
        const wt = p.revisions?.[0]?.slots?.main?.['*'] || ''
        d[p.title] = {
          size: p.revisions?.[0]?.size || 0,
          pages: /<pages\s/.test(wt) ? 'transcluded' : 'typed',
          cats: (p.categories || []).map((c) => c.title.replace(/^[^:]*:/, '')),
          start: wt.replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240),
        }
      }
    } catch (e) { d[batch[0]] = { error: String(e) } }
  }
  return d
}

const report = {}
const wanted = {
  fa: ['دعای ندبه', 'دعای عهد', 'دعای افتتاح', 'دعای فرج', 'دعای حجب', 'دعای احتجاب', 'دعای ام داود', 'دعای علقمه', 'دعای مکارم الاخلاق', 'دعای ابوحمزه', 'دعای سحر', 'دعای جوشن', 'حدیث کسا', 'دعای کمیل', 'دعای توسل',
    'زیارت عاشورا', 'زیارت وارث', 'زیارت اربعین', 'زیارت امین الله', 'زیارت آل یاسین', 'زیارت ناحیه مقدسه', 'زیارت رجبیه', 'زیارت جامعه کبیره', 'زیارت جامعه صغیره', 'زیارت حضرت عباس', 'زیارت غدیریه', 'زیارت عرفه', 'زیارت وداع', 'زیارت قبور مؤمنین', 'زیارت حضرت معصومه', 'زیارت حضرت زینب', 'زیارت امام رضا', 'زیارت حضرت حمزه',
    'مناجات شعبانیه', 'مناجات خمس عشر', 'صحیفه سجادیه', 'تعقیبات', 'نماز جعفر طیار', 'نماز غفیله', 'نماز وحشت', 'اعمال ماه رجب', 'اعمال شب قدر', 'دعای روز عرفه'],
  ar: ['دعاء الندبة', 'دعاء العهد', 'دعاء الافتتاح', 'دعاء الفرج', 'دعاء الحجب', 'دعاء الاحتجاب', 'دعاء أم داود', 'دعاء علقمة', 'دعاء السمات', 'حديث الكساء', 'دعاء الصباح', 'دعاء العشرات',
    'زيارة وارث', 'زيارة الأربعين', 'زيارة أمين الله', 'زيارة آل ياسين', 'زيارة الناحية', 'الزيارة الرجبية', 'الزيارة الجامعة الصغيرة', 'زيارة العباس', 'زيارة الغدير', 'زيارة عرفة', 'زيارة القبور', 'المناجاة الشعبانية', 'مناجاة', 'مفاتيح الجنان', 'أعمال', 'صلاة جعفر', 'صلاة الغفيلة', 'صلاة الوحشة', 'أدعية'],
}
const prefixes = {
  fa: ['دعای', 'دعا ', 'زیارت', 'زیارتنامه', 'مناجات', 'نماز', 'اعمال', 'مفاتیح الجنان', 'ادعیه', 'تعقیب'],
  ar: ['دعاء', 'الدعاء', 'زيارة', 'الزيارة', 'مناجاة', 'المناجاة', 'أعمال', 'صلاة', 'مفاتيح'],
}
for (const [wiki, api] of Object.entries(WIKIS)) {
  const found = new Set()
  report[wiki] = { prefixes: {}, searches: {}, textSearches: {} }
  for (const p of prefixes[wiki]) {
    try { const l = await allPages(api, p); report[wiki].prefixes[p] = l.length; l.forEach((t) => found.add(t)) } catch (e) { report[wiki].prefixes[p] = String(e) }
  }
  for (const q of wanted[wiki]) {
    try { const l = await search(api, q, 'title'); report[wiki].searches[q] = l; l.forEach((t) => found.add(t)) } catch (e) { report[wiki].searches[q] = String(e) }
    try { const l = await search(api, q, 'text'); report[wiki].textSearches[q] = l.slice(0, 10) } catch (e) { report[wiki].textSearches[q] = String(e) }
  }
  // The Mafatih's chapters as pages of their own
  try { const l = await allPages(api, wiki === 'fa' ? 'مفاتیح الجنان' : 'مفاتيح الجنان'); l.forEach((t) => found.add(t)) } catch {}
  const titles = [...found].slice(0, 1500)
  report[wiki].found = titles.length
  const d = await details(api, titles)
  writeFileSync(`${out}/${wiki}-pages.json`, JSON.stringify(d, null, 1))
  writeFileSync(`${out}/${wiki}-pages.txt`, Object.entries(d).sort((a, b) => a[0].localeCompare(b[0], 'fa'))
    .map(([t, x]) => `${t} | ${x.size ?? ''} | ${x.pages ?? ''} | ${(x.cats || []).join('، ')}\n    ${x.start ?? x.error ?? ''}`).join('\n'))
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([w, r]) => [w, { found: r.found, prefixes: r.prefixes }]))))
