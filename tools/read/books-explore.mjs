// Arabic books in PDF that may be shared and used freely (in the public domain,
// or under CC0, CC BY or CC BY-SA; never NC or ND): how many there are, how
// big, and what about. For a look before choosing, on the "read-sources" branch.
//
// - Wikimedia Commons: its PDF files in Arabic, each with the licence its
//   community checks.
// - The Internet Archive: books in Arabic scanned by libraries and published
//   before 1931 (in the public domain in the United States), and books whose
//   uploader gave them an open licence (said by the uploader only: kept apart).
import { mkdirSync, writeFileSync } from 'node:fs'
const out = (process.argv[2] || 'out') + '/books'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }
const get = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json() }
const report = {}

// Licences that let anyone share and use (CC BY-SA: shared as it is, or alike)
const OPEN = (l) => /^(public domain|pd([- ]|$)|cc0|cc[- ]by(-sa)?([- ]|$))/i.test(String(l).trim()) && !/-nc|-nd|\bnc\b|\bnd\b/i.test(l)
const openUrl = (u) => /creativecommons\.org\/(publicdomain|licenses\/by(-sa)?\/)/.test(u || '') && !/-nc|-nd/.test(u || '')

// ─── Wikimedia Commons ───
const COMMONS = 'https://commons.wikimedia.org/w/api.php'
async function catFiles(cat, depth, seen, files) {
  if (seen.has(cat) || depth > 3) return
  seen.add(cat)
  let cont = ''
  do {
    const j = await get(`${COMMONS}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(cat)}&cmlimit=500&cmprop=title|type&format=json${cont}`)
    for (const m of j.query.categorymembers) {
      if (m.type === 'file' && /\.pdf$/i.test(m.title)) files.add(m.title)
      else if (m.type === 'subcat') await catFiles(m.title, depth + 1, seen, files)
    }
    cont = j.continue ? `&cmcontinue=${encodeURIComponent(j.continue.cmcontinue)}` : ''
  } while (cont && files.size < 20000)
}
try {
  const files = new Set()
  const seen = new Set()
  for (const c of ['Category:PDF files in Arabic', 'Category:Arabic-language books', 'Category:Books in Arabic', 'Category:Arabic Wikisource']) {
    try { await catFiles(c, 0, seen, files) } catch (e) { report[`commons ${c}`] = String(e) }
  }
  const list = [...files]
  const rows = []
  for (let i = 0; i < list.length; i += 40) {
    const batch = list.slice(i, i + 40)
    try {
      const j = await get(`${COMMONS}?action=query&prop=imageinfo&iiprop=size|extmetadata|url&iiextmetadatafilter=LicenseShortName|LicenseUrl|Artist|ObjectName|DateTimeOriginal|ImageDescription&titles=${encodeURIComponent(batch.join('|'))}&format=json`)
      for (const p of Object.values(j.query.pages)) {
        const ii = p.imageinfo?.[0]
        if (!ii) continue
        const m = ii.extmetadata || {}
        const strip = (x) => String(x?.value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)
        rows.push({ title: p.title, size: ii.size, pages: ii.pagecount || null, license: strip(m.LicenseShortName), licenseUrl: strip(m.LicenseUrl), author: strip(m.Artist), date: strip(m.DateTimeOriginal), name: strip(m.ObjectName), url: ii.url })
      }
    } catch (e) { report.commonsError = String(e) }
  }
  const open = rows.filter((r) => OPEN(r.license))
  report.commons = {
    pdfs: rows.length, open: open.length, openGB: +(open.reduce((s, r) => s + r.size, 0) / 1e9).toFixed(2),
    licences: Object.entries(rows.reduce((a, r) => ((a[r.license] = (a[r.license] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 25),
    categories: seen.size,
  }
  writeFileSync(`${out}/commons.json`, JSON.stringify(rows, null, 1))
} catch (e) { report.commons = String(e) }

// ─── The Internet Archive ───
const FIELDS = ['identifier', 'title', 'creator', 'date', 'licenseurl', 'collection', 'item_size', 'downloads', 'subject', 'language']
async function scrape(q, max = 20000) {
  const items = []
  let cursor = ''
  do {
    const j = await get(`https://archive.org/services/search/v1/scrape?q=${encodeURIComponent(q)}&fields=${FIELDS.join(',')}&count=5000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    items.push(...(j.items || []))
    cursor = j.cursor
    report[`ia total: ${q.slice(0, 60)}`] = j.total
  } while (cursor && items.length < max)
  return items
}
const ARABIC = 'language:(ara OR arabic OR Arabic OR "عربي" OR "العربية" OR "Arabic language")'
const summary = (items) => ({
  items: items.length,
  GB: +(items.reduce((s, i) => s + (Number(i.item_size) || 0), 0) / 1e9).toFixed(1),
  collections: Object.entries(items.flatMap((i) => [].concat(i.collection || [])).reduce((a, c) => ((a[c] = (a[c] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 30),
  subjects: Object.entries(items.flatMap((i) => [].concat(i.subject || [])).reduce((a, c) => ((a[c] = (a[c] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 40),
})
try {
  const old = await scrape(`mediatype:texts AND ${ARABIC} AND date:[0001-01-01 TO 1930-12-31]`)
  report.iaBefore1931 = summary(old)
  writeFileSync(`${out}/ia-before-1931.json`, JSON.stringify(old.sort((a, b) => (b.downloads || 0) - (a.downloads || 0)), null, 1))
} catch (e) { report.iaBefore1931 = String(e) }
try {
  const lic = (await scrape(`mediatype:texts AND ${ARABIC} AND licenseurl:*`)).filter((i) => openUrl(i.licenseurl))
  report.iaOpenLicence = summary(lic)
  writeFileSync(`${out}/ia-open-licence.json`, JSON.stringify(lic.sort((a, b) => (b.downloads || 0) - (a.downloads || 0)), null, 1))
} catch (e) { report.iaOpenLicence = String(e) }

writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1).slice(0, 6000))
