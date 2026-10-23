// Which of the wanted du'as, ziyarat, munajat and a'mal the open wikis hold:
// Arabic Wikisource's pages by their first word, and Persian Wikisource's
// Mafatih al-Jinan (Shaykh Abbas al-Qummi's, in the public domain; its du'as in
// Arabic). Left on the "read-sources" branch for a look.
import { mkdirSync, writeFileSync } from 'node:fs'
const out = process.argv[2] || 'out'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }
const get = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json() }
const report = {}

async function allPages(api, prefix, ns = 0) {
  const list = []
  let cont = ''
  do {
    const j = await get(`${api}?action=query&list=allpages&apprefix=${encodeURIComponent(prefix)}&apnamespace=${ns}&aplimit=500&format=json${cont}`)
    list.push(...j.query.allpages.map((p) => p.title))
    cont = j.continue ? `&apcontinue=${encodeURIComponent(j.continue.apcontinue)}` : ''
  } while (cont)
  return list
}
async function sizes(api, titles) {
  const s = {}
  for (let i = 0; i < titles.length; i += 8) {
    try {
      const j = await get(`${api}?action=query&prop=info&titles=${encodeURIComponent(titles.slice(i, i + 8).join('|'))}&format=json`)
      for (const p of Object.values(j.query.pages)) s[p.title] = p.length
    } catch (e) { s[titles[i]] = String(e) }
  }
  return s
}
const AR = 'https://ar.wikisource.org/w/api.php'
const FA = 'https://fa.wikisource.org/w/api.php'
for (const [api, name, prefixes] of [
  [AR, 'ar', ['دعاء', 'الدعاء', 'زيارة', 'الزيارة', 'مناجاة', 'المناجاة', 'أعمال', 'صلاة', 'حديث الكساء', 'الصحيفة', 'مفاتيح']],
  [FA, 'fa', ['مفاتیح', 'مفاتيح', 'دعای', 'دعاء', 'زیارت', 'زيارة', 'مناجات', 'صحیفه', 'اعمال']],
]) {
  for (const p of prefixes) {
    try {
      const titles = await allPages(api, p)
      const sz = await sizes(api, titles.slice(0, 400))
      report[`${name}:${p}`] = titles.map((t) => `${sz[t] ?? '?'} ${t}`)
    } catch (e) { report[`${name}:${p}`] = String(e) }
  }
}
// The Mafatih's own page (its contents), to see how it is laid out
for (const title of ['مفاتیح الجنان', 'مفاتيح الجنان']) {
  try {
    const j = await get(`${FA}?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(title)}&format=json&redirects=1`)
    const page = Object.values(j.query.pages)[0]
    writeFileSync(`${out}/fa-${title}.txt`, page.revisions?.[0]?.slots?.main?.['*'] || JSON.stringify(page))
  } catch (e) { writeFileSync(`${out}/fa-${title}.txt`, String(e)) }
}
writeFileSync(`${out}/report3.json`, JSON.stringify(report, null, 1))
console.log(Object.entries(report).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : v}`).join('\n'))
