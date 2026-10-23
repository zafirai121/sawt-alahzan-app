// The texts of the "اقرأ" part, from open sources, as small JSON files the
// apps load one at a time (and keep): out/read/index.json lists them; t/<id>.json
// is a du'a or a ziyara; q/<n>.json a sura.
//
// - Du'as, ziyarat and al-Sahifa al-Sajjadiyya: Arabic Wikisource (CC BY-SA 4.0).
//   Its wiki markup is taken off; Persian letters typed by mistake (ی، ک) are
//   made Arabic; nothing else in the words is changed.
// - The Quran: Tanzil's Uthmani text (CC BY 3.0), verbatim, with its notice.
//
// Run on GitHub (read-sources.yml), which can reach these sites.
import { mkdirSync, writeFileSync } from 'node:fs'
import vm from 'node:vm'

const out = (process.argv[2] || 'out') + '/read'
for (const d of ['', '/t', '/q', '/debug']) mkdirSync(out + d, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }
const WS = 'https://ar.wikisource.org'
const WIKISOURCE = {
  name: 'ويكي مصدر', url: WS, license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/deed.ar',
  note: 'نصوص الأدعية والزيارات والصحيفة السجادية. حُذفت منها رموز التنسيق، وصُحّحت حروف فارسية كُتبت سهواً (ی، ک)، ولم يُغيَّر شيء غير ذلك.',
}

async function wikitext(title) {
  const r = await fetch(`${WS}/w/api.php?action=query&prop=revisions&rvprop=content|ids&rvslots=main&titles=${encodeURIComponent(title)}&format=json&redirects=1`, { headers: UA })
  const j = await r.json()
  const page = Object.values(j.query.pages)[0]
  const rev = page.revisions?.[0]
  if (!rev) throw new Error(`no page: ${title}`)
  return { text: rev.slots.main['*'], revid: rev.revid, title: page.title }
}

// Wiki markup off: notes, templates, categories, links (their words stay), bold
function clean(wt) {
  let s = wt.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
  let prev
  do { prev = s; s = s.replace(/\{\{[^{}]*\}\}/g, '') } while (s !== prev)
  s = s.replace(/\[\[(?:تصنيف|Category|ملف|File|صورة|Image):[^\]]*\]\]/gi, '')
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]*)\]\]/g, '$1')
  s = s.replace(/\[https?:\/\/\S+ ([^\]]*)\]/g, '$1').replace(/\[https?:\/\/\S+\]/g, '')
  s = s.replace(/'{2,}/g, '')
  s = s.replace(/__[^_\s]+__/g, '')
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, '')
  s = s.replace(/&nbsp;/g, ' ').replace(/‏|‎/g, '')
  return arabic(s)
}
const arabic = s => s.replace(/ی/g, 'ي').replace(/ک/g, 'ك')

// Lines of the text; a long one (a whole du'a is often one line) cut at a pause
// (، or .) every few hundred letters, to read and to come back to more easily
const lines = s => s.split('\n').map(l => l.replace(/^[:*#;]+\s*/, '').replace(/\s+/g, ' ').trim())
  .filter(l => l && !/^[\s.،,:؛-]+$/.test(l)).flatMap(cut)
function cut(line) {
  const parts = []
  let rest = line
  while (rest.length > 700) {
    const at = [...rest.slice(350, 650).matchAll(/[.،؟!:]\s/g)].map(m => m.index + 350 + 1).pop()
    if (!at) break
    parts.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  return [...parts, rest]
}

// The page in sections: what is said about the text (its source, its merit)
// and the text itself; references and the like left out
const SKIP = /^(مراجع|المراجع|المصادر|مصادر|انظر أيضا|انظر أيضاً|وصلات خارجية|هوامش)$/
const BODY = /(كلمات|نص|متن)\s+(الدعاء|الزيارة|المناجاة)|^الدعاء$|^الزيارة$/
function sections(wt) {
  const parts = []
  let cur = { head: '', lines: [] }
  for (const raw of clean(wt).split('\n')) {
    const h = raw.match(/^(=+)\s*(.*?)\s*\1\s*$/)
    if (h) { parts.push(cur); cur = { head: h[2].trim(), lines: [] }; continue }
    cur.lines.push(raw)
  }
  parts.push(cur)
  return parts.map(p => ({ head: p.head, text: lines(p.lines.join('\n')) })).filter(p => p.text.length && !SKIP.test(p.head))
}

function textOf(id, title, wt, page) {
  const secs = sections(wt.text)
  const bodyAt = secs.findIndex(s => BODY.test(s.head))
  let about = [], parts
  if (bodyAt >= 0) {
    for (const s of secs.slice(0, bodyAt)) about.push(...(s.head ? [s.head + ':'] : []), ...s.text)
    parts = secs.slice(bodyAt).map((s, i) => ({ head: i === 0 ? '' : s.head, text: s.text }))
  } else {
    parts = secs
  }
  return { id, title, about, parts, source: { ...WIKISOURCE, name: `ويكي مصدر: ${page}`, url: `${WS}/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}?oldid=${wt.revid}` } }
}

const DUAS = [
  ['kumayl', 'دعاء كميل', 'دعاء كميل', 'يُقرأ ليلة الجمعة وليلة النصف من شعبان'],
  ['tawassul', 'دعاء التوسل', 'دعاء التوسل', ''],
  ['abu-hamza', 'دعاء أبي حمزة الثمالي', 'دعاء أبي حمزة الثمالي', 'في أسحار شهر رمضان'],
  ['baha', 'دعاء البهاء', 'دعاء البهاء (دعاء السحر)', 'في أسحار شهر رمضان'],
  ['arafa', 'دعاء عرفة', 'دعاء الإمام الحسين يوم عرفة', 'يوم عرفة'],
  ['jawshan-kabir', 'دعاء الجوشن الكبير', 'دعاء الجوشن الكبير', 'في ليالي القدر'],
  ['jawshan-saghir', 'دعاء الجوشن الصغير', 'دعاء الجوشن الصغير', ''],
  ['mujir', 'دعاء المجير', 'دعاء المجير', 'في الأيام البيض من شهر رمضان'],
]
const ZIYARAT = [
  ['ashura', 'زيارة عاشوراء', 'زيارة عاشوراء', 'زيارة الإمام الحسين يوم عاشوراء وفي كل يوم'],
  ['jamia', 'الزيارة الجامعة الكبيرة', 'الزيارة الجامعة الكبيرة', 'زيارة الأئمة جميعاً'],
  ['masuma', 'زيارة السيدة فاطمة المعصومة', 'زيارة السيدة فاطمة المعصومة', 'في قم المقدسة'],
]
const ORDINALS = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر']
const TENS = ['', 'عشر', 'العشرون', 'الثلاثون', 'الأربعون', 'الخمسون']
function ordinal(n) {
  if (n <= 10) return ORDINALS[n - 1]
  const one = n % 10, ten = Math.floor(n / 10)
  if (ten === 1) return n === 11 ? 'الحادي عشر' : `${ORDINALS[one - 1]} عشر`
  if (one === 0) return TENS[ten]
  return `${one === 1 ? 'الحادي' : ORDINALS[one - 1]} و${TENS[ten]}`
}

const index = { v: 1, groups: [], surahs: [], sources: [] }
const report = []
async function group(id, title, list) {
  const items = []
  for (const [tid, page, shown, note] of list) {
    try {
      const wt = await wikitext(page)
      const t = textOf(tid, shown, wt, page)
      writeFileSync(`${out}/t/${tid}.json`, JSON.stringify(t))
      writeFileSync(`${out}/debug/${tid}.txt`, [t.title, '-- about', ...t.about, ...t.parts.flatMap(p => ['-- ' + p.head, ...p.text])].join('\n'))
      items.push({ id: tid, title: shown, note })
      report.push(`${tid}: about ${t.about.length}, parts ${t.parts.map(p => `${p.head || '-'}(${p.text.length})`).join(' ')}, ${JSON.stringify(t).length} bytes`)
    } catch (e) { report.push(`${tid}: ${e}`) }
  }
  index.groups.push({ id, title, items })
}
await group('duas', 'الأدعية', DUAS)
await group('ziyarat', 'الزيارات', ZIYARAT)

// al-Sahifa al-Sajjadiyya: one page on Wikisource, its 54 du'as each under a heading
{
  const wt = await wikitext('الصحيفة السجادية')
  const items = []
  const secs = sections(wt.text).filter(s => s.head)
  // Each heading: "الدعاء الاول: '''what it is for'''" (the number written several ways)
  const heads = [...wt.text.matchAll(/^==(.*)==\s*$/gm)].map(m => arabic(m[1].match(/'''([\s\S]*?)'''/)?.[1] || '').trim())
  if (heads.length !== secs.length) throw new Error(`sahifa: ${heads.length} headings, ${secs.length} sections`)
  secs.forEach((s, i) => {
    const n = i + 1
    const about = heads[i]
    const tid = `sahifa-${n}`
    const t = {
      id: tid, title: `الدعاء ${ordinal(n)}`, about: about ? [about] : [], parts: [{ head: '', text: s.text }],
      source: { ...WIKISOURCE, name: 'ويكي مصدر: الصحيفة السجادية', url: `${WS}/wiki/${encodeURIComponent('الصحيفة_السجادية')}?oldid=${wt.revid}` },
    }
    writeFileSync(`${out}/t/${tid}.json`, JSON.stringify(t))
    items.push({ id: tid, title: t.title, note: about })
  })
  index.groups.push({ id: 'sahifa', title: 'الصحيفة السجادية', items })
  report.push(`sahifa: ${secs.length} du'as`)
}
index.sources.push(WIKISOURCE)

// The Quran: Tanzil's Uthmani text, a file a sura, its notice kept with it
{
  const r = await fetch('https://tanzil.net/pub/download/index.php?marks=true&sajdah=true&rub=false&alif=true&quranType=uthmani&outType=txt-2&agree=true', { headers: UA })
  const body = await r.text()
  const notice = body.split('\n').filter(l => l.startsWith('#')).map(l => l.replace(/^#\s?/, '')).join('\n').trim()
  const meta = await (await fetch('https://tanzil.net/res/text/metadata/quran-data.js', { headers: UA })).text()
  const ctx = {}
  vm.runInNewContext(meta + ';this.QuranData = QuranData', ctx)
  const suras = ctx.QuranData.Sura
  const ayas = {}
  for (const l of body.split('\n')) {
    const m = l.match(/^(\d+)\|(\d+)\|(.*)$/)
    if (m) (ayas[m[1]] ||= []).push(m[3])
  }
  for (let n = 1; n <= 114; n++) {
    const [, count, , , name, , , type] = suras[n]
    if (ayas[n].length !== count) throw new Error(`sura ${n}: ${ayas[n].length} ayas, not ${count}`)
    const place = type === 'Meccan' ? 'مكية' : 'مدنية'
    writeFileSync(`${out}/q/${n}.json`, JSON.stringify({ n, name, place, ayas: ayas[n], source: 'Tanzil Project — https://tanzil.net', notice }))
    index.surahs.push({ n, name, ayas: count, place })
  }
  index.sources.push({
    name: 'مشروع Tanzil', url: 'https://tanzil.net', license: 'CC BY 3.0', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    note: 'نص القرآن الكريم بالرسم العثماني، كما هو دون أي تغيير.', notice,
  })
  report.push(`quran: ${Object.values(ayas).flat().length} ayas`)
}

writeFileSync(`${out}/index.json`, JSON.stringify(index))
writeFileSync(`${out}/debug/report.txt`, report.join('\n'))
console.log(report.join('\n'))
