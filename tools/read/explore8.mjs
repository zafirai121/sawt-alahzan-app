// Wikipedia (CC BY-SA 4.0, as Wikisource): its Arabic and Persian articles on
// the du'as and ziyarat still missing, and whether each gives the text in full
// (how many fully vowelled words it holds, and where). For a look, on the
// "read-sources" branch.
import { mkdirSync, writeFileSync } from 'node:fs'
const out = (process.argv[2] || 'out') + '/explore8'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }
const get = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json() }
const WIKIS = { ar: 'https://ar.wikipedia.org/w/api.php', fa: 'https://fa.wikipedia.org/w/api.php' }
const NAMES = {
  ar: ['دعاء الندبة', 'دعاء العهد', 'دعاء الافتتاح', 'دعاء الحجب', 'دعاء الاحتجاب', 'دعاء أم داود', 'دعاء علقمة', 'حديث الكساء', 'دعاء الفرج', 'دعاء يستشير', 'دعاء السمات', 'دعاء الصباح', 'دعاء المشلول',
    'زيارة وارث', 'زيارة الأربعين', 'زيارة أمين الله', 'زيارة آل ياسين', 'زيارة الناحية المقدسة', 'الزيارة الرجبية', 'الزيارة الجامعة الصغيرة', 'زيارة العباس بن علي', 'المناجاة الشعبانية', 'زيارة عاشوراء', 'الزيارة الجامعة الكبيرة', 'دعاء التوسل', 'صلاة جعفر الطيار', 'صلاة الغفيلة', 'صلاة الوحشة', 'زيارة الغدير', 'دعاء عرفة'],
  fa: ['دعای ندبه', 'دعای عهد', 'دعای افتتاح', 'دعای حجاب', 'دعای ام داوود', 'دعای علقمه', 'حدیث کسا', 'دعای فرج', 'زیارت وارث', 'زیارت اربعین', 'زیارت امین‌الله', 'زیارت آل یاسین', 'زیارت ناحیه مقدسه', 'زیارت رجبیه', 'زیارت جامعه صغیره', 'زیارت عباس بن علی', 'مناجات شعبانیه', 'زیارت عاشورا', 'زیارت جامعه کبیره', 'نماز جعفر طیار', 'نماز غفیله', 'نماز وحشت', 'زیارت غدیریه', 'دعای عرفه'],
}
const HARAKA = /[ً-ْ]/
const report = {}
for (const [wiki, api] of Object.entries(WIKIS)) {
  report[wiki] = {}
  for (const name of NAMES[wiki]) {
    try {
      const j = await get(`${api}?action=query&prop=revisions|info&rvprop=content|ids&rvslots=main&titles=${encodeURIComponent(name)}&redirects=1&format=json`)
      const p = Object.values(j.query.pages)[0]
      const wt = p.revisions?.[0]?.slots?.main?.['*']
      if (!wt) { report[wiki][name] = { missing: true }; continue }
      // Runs of vowelled words: the longest, and all of them together
      const words = wt.split(/\s+/)
      let run = 0, best = 0, total = 0
      for (const w of words) { if (HARAKA.test(w)) { run++; total++; best = Math.max(best, run) } else if (w.length > 1) run = 0 }
      const sections = [...wt.matchAll(/^==+\s*(.*?)\s*==+\s*$/gm)].map((m) => m[1])
      report[wiki][name] = { title: p.title, revid: p.revisions[0].revid, size: wt.length, vowelledWords: total, longestRun: best, sections }
      if (best >= 80) writeFileSync(`${out}/${wiki}-${p.title.replace(/[\/\s]+/g, '_')}.txt`, wt)
    } catch (e) { report[wiki][name] = { error: String(e) } }
  }
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
for (const [w, r] of Object.entries(report)) for (const [n, x] of Object.entries(r)) console.log(`${w} ${n}: ${x.missing ? 'missing' : x.error || `${x.title} size ${x.size} vowelled ${x.vowelledWords} longest ${x.longestRun}`}`)
