// The texts of the "اقرأ" part, from open sources, as small JSON files the
// apps load one at a time (and keep): out/read/index.json lists them; t/<id>.json
// is a du'a or a ziyara; q/<n>.json a sura.
//
// - Du'as, ziyarat and al-Sahifa al-Sajjadiyya: Arabic Wikisource (CC BY-SA 4.0).
//   Its wiki markup is taken off; Persian letters typed by mistake (ی، ک) are
//   made Arabic; nothing else in the words is changed.
// - More du'as, ziyarat, the fifteen munajat and the ta'qibat: Shaykh Abbas al-Qummi's
//   Mafatih al-Jinan (in the public domain), its proofread pages on Persian
//   Wikisource (CC BY-SA 4.0), the Arabic taken and the Persian notes left out
//   (see mafatih.mjs).
// - Ziyarat Amin Allah and Al Yasin and the Sha'baniyya salawat: Arabic
//   Wikipedia (CC BY-SA 4.0), whose articles give them in full (see wikipedia.mjs).
// - The Quran: Tanzil's Uthmani text (CC BY 3.0), verbatim, with its notice.
//
// Run on GitHub (read-sources.yml), which can reach these sites.
import { mkdirSync, writeFileSync } from 'node:fs'
import vm from 'node:vm'
import { joinPages, mafatihTexts, faNumber, MAFATIH_INDEX } from './mafatih.mjs'
import { WIKIPEDIA_ITEMS, textOfSection, leadOf } from './wikipedia.mjs'

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
const SKIP = /^(مراجع|المراجع|المصادر|مصادر|المصدر|انظر أيضا|انظر أيضاً|وصلات خارجية|هوامش)$/
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
// al-Sahifa's du'as by what each is for (its headings say it at length)
const SAHIFA = [
  'دعاء التحميد لله تعالى', 'دعاء الصلاة على محمد وآله', 'دعاء الصلاة على حملة العرش', 'دعاء الصلاة على مصدّقي الرسل',
  'دعاؤه لنفسه وأهل ولايته', 'دعاء الصباح والمساء', 'دعاء المهمات', 'دعاء الاستعاذة من المكاره', 'دعاء الاشتياق إلى طلب المغفرة',
  'دعاء الالتجاء إلى الله', 'دعاء خواتيم الخير', 'دعاء الاعتراف وطلب التوبة', 'دعاء طلب الحوائج', 'دعاء الظُّلامات',
  'دعاء المرض والكرب', 'دعاء الاستقالة من الذنوب', 'دعاء الاستعاذة من الشيطان', 'دعاء دفع المحذور', 'دعاء الاستسقاء',
  'دعاء مكارم الأخلاق', 'دعاء الحزن', 'دعاء الشدة والجهد', 'دعاء العافية', 'دعاء الوالدين', 'دعاء الأولاد', 'دعاء الجيران والأولياء',
  'دعاء أهل الثغور', 'دعاء التفزّع إلى الله', 'دعاء ضيق الرزق', 'دعاء المعونة على قضاء الدين', 'دعاء التوبة', 'دعاء صلاة الليل',
  'دعاء الاستخارة', 'دعاء من ابتُلي أو رأى مبتلى بفضيحة', 'دعاء الرضا بالقضاء', 'دعاء رؤية السحاب والبرق وسماع الرعد',
  'دعاء الاعتراف بالتقصير عن الشكر', 'دعاء الاعتذار من تبعات العباد', 'دعاء طلب العفو والرحمة', 'دعاء ذكر الموت',
  'دعاء طلب الستر والوقاية', 'دعاء ختم القرآن', 'دعاء رؤية الهلال', 'دعاء دخول شهر رمضان', 'دعاء وداع شهر رمضان',
  'دعاء عيد الفطر', 'دعاء يوم عرفة', 'دعاء عيد الأضحى ويوم الجمعة', 'دعاء دفع كيد الأعداء', 'دعاء الرهبة',
  'دعاء التضرع والاستكانة', 'دعاء الإلحاح على الله', 'دعاء التذلل لله', 'دعاء كشف الهموم',
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
// The texts written, by id: their title and a line on them, for the groups' lists
const known = {}
function save(t, note) {
  writeFileSync(`${out}/t/${t.id}.json`, JSON.stringify(t))
  writeFileSync(`${out}/debug/${t.id}.txt`, [t.title, '-- about', ...t.about, ...t.parts.flatMap(p => ['-- ' + p.head, ...p.text])].join('\n'))
  known[t.id] = { title: t.title, note }
}
async function fetchAll(list) {
  for (const [tid, page, shown, note] of list) {
    try {
      const wt = await wikitext(page)
      const t = textOf(tid, shown, wt, page)
      save(t, note)
      report.push(`${tid}: about ${t.about.length}, parts ${t.parts.map(p => `${p.head || '-'}(${p.text.length})`).join(' ')}, ${JSON.stringify(t).length} bytes`)
    } catch (e) { report.push(`${tid}: ${e}`) }
  }
}
await fetchAll(DUAS)
await fetchAll(ZIYARAT)

// al-Sahifa al-Sajjadiyya: one page on Wikisource, its 54 du'as each under a heading
{
  const wt = await wikitext('الصحيفة السجادية')
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
    // Listed by what it is for, its number under it
    save(t, `الدعاء ${ordinal(n)} من الصحيفة السجادية`)
    known[tid].title = SAHIFA[i]
  })
  if (secs.length !== SAHIFA.length) report.push(`sahifa: ${secs.length} du'as, ${SAHIFA.length} titles`)
  report.push(`sahifa: ${secs.length} du'as`)
}
index.sources.push(WIKISOURCE)

// Mafatih al-Jinan: the pages of its first part (all proofread to 137), each
// text taken only if all its pages are proofread
const FA = 'https://fa.wikisource.org'
const wikiPath = (title) => encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':')
const MAFATIH = {
  name: 'ويكي مصدر الفارسية: مفاتيح الجنان', url: FA, license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/deed.ar',
  note: 'أدعية وزيارات ومناجاة وتعقيبات من كتاب مفاتيح الجنان للشيخ عباس القمي (في الملك العام)، من صفحاته المدققة. النص العربي كما هو، وحُذفت تعليقات المؤلف الفارسية، وكُتب بالعربية ما يحتاجه القارئ منها (عدد المرات، ثم يقول، ثم يسجد، ثم يذكر حاجته)، وصُحّحت الحروف الفارسية (ی، ک) إلى العربية.',
}
try {
  const api = `${FA}/w/api.php`
  const ns = await (await fetch(`${api}?action=query&meta=siteinfo&siprop=namespaces&format=json`, { headers: UA })).json()
  const space = (canonical) => Object.values(ns.query.namespaces).find(n => n.canonical === canonical)['*']
  const pageTitle = (n) => `${space('Page')}:${MAFATIH_INDEX}/${faNumber(n)}`
  MAFATIH.url = `${FA}/wiki/${wikiPath(`${space('Index')}:${MAFATIH_INDEX}`)}`
  const pages = [], revs = {}
  for (let n = 12; n <= 137; n += 10) {
    const titles = Array.from({ length: Math.min(10, 138 - n) }, (_, i) => pageTitle(n + i))
    const j = await (await fetch(`${api}?action=query&prop=revisions&rvprop=content|ids&rvslots=main&titles=${encodeURIComponent(titles.join('|'))}&format=json`, { headers: UA })).json()
    const byTitle = Object.fromEntries(Object.values(j.query.pages).map(p => [p.title, p.revisions?.[0]]))
    titles.forEach((t, i) => {
      const r = byTitle[t]
      if (r) { pages.push([n + i, r.slots.main['*']]); revs[n + i] = r.revid } else report.push(`mafatih: no page ${n + i}`)
    })
  }
  for (const m of mafatihTexts(joinPages(pages))) {
    if (m.error) { report.push(`${m.id}: ${m.error}`); continue }
    if (!m.parts.length) { report.push(`${m.id}: no words found, left out`); continue }
    const unproofread = m.pages.filter((p, i) => m.levels[i] < 3)
    if (unproofread.length) { report.push(`${m.id}: pages ${unproofread.join(',')} not proofread, left out`); continue }
    const first = m.pages[0], last = m.pages[m.pages.length - 1]
    const ar = (n) => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d])
    const pagesShown = first === last ? `ص ${ar(first)}` : `ص ${ar(first)}–${ar(last)}`
    const t = {
      id: m.id, title: m.title, about: [m.note, 'من كتاب مفاتيح الجنان للشيخ عباس القمي'].filter(Boolean), parts: m.parts,
      source: { ...MAFATIH, name: `ويكي مصدر الفارسية: مفاتيح الجنان، ${pagesShown}`, url: `${FA}/wiki/${wikiPath(pageTitle(first))}?oldid=${revs[first]}` },
    }
    save(t, m.note)
    report.push(`${m.id}: pages ${first}-${last}, parts ${m.parts.map(p => `${p.head || '-'}(${p.text.length})`).join(' ')}, ${JSON.stringify(t).length} bytes`)
  }
  index.sources.push(MAFATIH)
} catch (e) { report.push(`mafatih: ${e}`) }

// Arabic Wikipedia: the few texts its articles give in full
{
  const WP = 'https://ar.wikipedia.org'
  const WIKIPEDIA = {
    name: 'ويكيبيديا العربية', url: WP, license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/deed.ar',
    note: 'زيارة أمين الله وزيارة آل ياسين والصلوات الشعبانية كما في مقالاتها. حُذفت منها رموز التنسيق، وجُعلت الآيات بين قوسي القرآن ﴿ ﴾، وصُحّح خطآن في الكتابة: ياء كُتبت بعد ألف مقصورة، وياء في آخر الكلمة بعد فتحة هي ألف مقصورة (عَلَي ← عَلَى)، ولم يُغيَّر شيء غير ذلك.',
  }
  let took = 0
  for (const it of WIKIPEDIA_ITEMS) {
    try {
      const j = await (await fetch(`${WP}/w/api.php?action=query&prop=revisions&rvprop=content|ids&rvslots=main&titles=${encodeURIComponent(it.page)}&redirects=1&format=json`, { headers: UA })).json()
      const page = Object.values(j.query.pages)[0]
      const rev = page.revisions?.[0]
      if (!rev) throw new Error(`no page ${it.page}`)
      const wt = rev.slots.main['*']
      const { intro, parts } = textOfSection(wt, it.section)
      const t = {
        id: it.id, title: it.title, about: [leadOf(wt), intro].filter(Boolean), parts,
        source: { ...WIKIPEDIA, name: `ويكيبيديا: ${page.title}`, url: `${WP}/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}?oldid=${rev.revid}` },
      }
      save(t, it.note)
      took++
      report.push(`${it.id}: parts ${parts.map(p => `${p.head || '-'}(${p.text.length})`).join(' ')}, ${JSON.stringify(t).length} bytes`)
    } catch (e) { report.push(`${it.id}: ${e}`) }
  }
  if (took) index.sources.push(WIKIPEDIA)
}

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

// ─── The lists ───
// Each group: its texts in order ([id] or [id, a title for this list, a line]),
// by id from what was written above (one left out above is left out here).
// The du'as' and the ziyarat's tabs list their own group, under a tile for each
// group whose `tab` is theirs (`count`: how many, said as Arabic says it).
const S = (n, title) => [`sahifa-${n}`, title]
const GROUPS = [
  {
    id: 'duas', title: 'الأدعية', items: [
      ['kumayl'], ['sabah'], ['tawassul'], ['simat'], ['ashara'], ['faraj'], ['jawshan-kabir'], ['jawshan-saghir'], ['mujir'],
      ['mashlul'], ['yastashir'], ['adila'], ['saifi'], ['abu-hamza'], ['baha'], ['arafa'],
      ['sahifa-47', 'دعاء الإمام زين العابدين يوم عرفة', 'الدعاء السابع والأربعون من الصحيفة السجادية'],
      S(20, 'دعاء مكارم الأخلاق'), S(31, 'دعاء التوبة'), ['istighatha'], ['tawfiq'], ['bihaqqi'], ['kazim'], ['ilahi-kayf'], ['tara'],
      ['karb'], ['khalas'], ['nur'], ['hirz-sajjad'], ['shabaniyya'],
    ],
  },
  {
    id: 'ziyarat', title: 'الزيارات', items: [
      ['z-nabi'], ['z-zahra'], ['z-zahra-2'], ['z-amir'], ['amin-allah'], ['z-hasan'], ['z-husain'], ['ashura'], ['z-tue'], ['z-wed'], ['z-askari'], ['z-mahdi'],
      ['al-yasin'], ['jamia'], ['masuma'],
    ],
  },
  { id: 'sahifa', title: 'الصحيفة السجادية', tab: 'duas', unit: ['أدعية', 'دعاءً'], items: SAHIFA.map((_, i) => [`sahifa-${i + 1}`, '', `الدعاء ${ordinal(i + 1)}`]) },
  { id: 'munajat', title: 'المناجاة الخمس عشرة', tab: 'duas', unit: ['مناجيات', 'مناجاة'], items: Array.from({ length: 15 }, (_, i) => [`munajat-${i + 1}`]) },
  { id: 'week', title: 'أدعية أيام الأسبوع', tab: 'duas', unit: ['أدعية', 'دعاءً'], items: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'].map(d => [`week-${d}`]) },
  {
    id: 'needs', title: 'أدعية الحاجات', tab: 'duas', unit: ['أدعية', 'دعاءً'], items: [
      S(13, 'دعاء قضاء الحوائج'), S(29, 'دعاء الرزق وسعة المعيشة'), S(30, 'دعاء قضاء الدين'), S(54, 'دعاء كشف الهموم'), ['karb'],
      S(22, 'دعاء الكرب والشدة'), ['khalas'], S(15, 'دعاء المرض'), S(23, 'دعاء طلب العافية'), ['nur'], ['hirz-sajjad'],
      S(8, 'دعاء الاستعاذة من المكاره'), S(9, 'دعاء طلب المغفرة'), S(31, 'دعاء التوبة والاستغفار'), S(12, 'دعاء الاعتراف وطلب التوبة'),
      S(24, 'دعاء الوالدين'), S(25, 'دعاء الأولاد والذرية'), ['tawfiq', 'دعاء التوفيق للطاعة'], S(33, 'دعاء الاستخارة'),
      S(7, 'دعاء المهمات ودفع البلاء'), S(14, 'دعاء المظلوم'), S(41, 'دعاء طلب الستر والوقاية'), S(10, 'دعاء الالتجاء إلى الله'),
      S(11, 'دعاء خواتيم الخير'), S(21, 'دعاء الحزن'), S(35, 'دعاء الرضا بالقضاء'), S(37, 'دعاء الشكر لله'), S(40, 'دعاء ذكر الموت'),
      S(49, 'دعاء دفع كيد الأعداء'), S(51, 'دعاء التضرع والاستكانة'), S(53, 'دعاء التذلل لله'), S(20, 'دعاء مكارم الأخلاق'),
    ],
  },
  {
    id: 'occasions', title: 'أدعية المناسبات', tab: 'duas', unit: ['أدعية', 'دعاءً'], items: [
      ['kumayl'], ['simat'], S(43, 'دعاء رؤية الهلال'), ['shabaniyya'], S(44, 'دعاء دخول شهر رمضان'), ['abu-hamza'], ['baha'],
      ['jawshan-kabir', 'دعاء الجوشن الكبير (ليالي القدر)'], ['mujir'], S(45, 'دعاء وداع شهر رمضان'), S(46, 'دعاء عيد الفطر'),
      ['arafa'], ['sahifa-47', 'دعاء الإمام زين العابدين يوم عرفة'], S(48, 'دعاء عيد الأضحى ويوم الجمعة'), S(42, 'دعاء ختم القرآن'),
    ],
  },
  { id: 'taqibat', title: 'تعقيبات الصلوات', tab: 'duas', unit: ['تعقيبات', 'تعقيباً'], items: ['subh', 'zuhr', 'asr', 'maghrib', 'isha'].map(p => [`taqib-${p}`]) },
]
// "٣ أدعية", "١٥ دعاءً": the plural from three to ten
const count = (n, [few, many]) => `${n} ${n >= 3 && n <= 10 ? few : many}`
for (const g of GROUPS) {
  const items = []
  for (const [id, title, note] of g.items) {
    if (!known[id]) { report.push(`${g.id}: ${id} missing`); continue }
    items.push({ id, title: title || known[id].title, note: note ?? known[id].note })
  }
  if (!items.length) continue
  const { unit, ...rest } = g
  index.groups.push({ ...rest, items, ...(unit ? { count: count(items.length, unit) } : {}) })
  report.push(`${g.id}: ${items.length} items`)
}

writeFileSync(`${out}/index.json`, JSON.stringify(index))
writeFileSync(`${out}/debug/report.txt`, report.join('\n'))
console.log(report.join('\n'))
