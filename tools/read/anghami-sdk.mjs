// Anghami's public SDK: its OpenAPI description, how keys are had and used,
// its limits and its licence and terms, to see whether Saqr may read a
// playlist's or an album's titles through it. For a look, on the "read-sources" branch.
import { mkdirSync, writeFileSync } from 'node:fs'
const out = (process.argv[2] || 'out') + '/anghami-sdk'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' }
const D = 'https://docs.sdk.anghami.com'
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const report = {}
for (const [name, path] of [['openapi', '/api/anghami-sdk.openapi.yaml'], ['llms', '/.well-known/llms.txt'], ['llms-root', '/llms.txt'],
  ['authentication', '/authentication'], ['quickstart', '/quickstart'], ['api-keys', '/api-keys'], ['rate-limits', '/rate-limits'], ['license', '/license'],
  ['catalog', '/music-catalog'], ['search', '/search-and-browse'], ['streaming', '/streaming-and-billing'], ['developer-portal', '/developer-portal']]) {
  try {
    const r = await fetch(D + path, { headers: UA })
    const body = await r.text()
    const t = /yaml|txt/.test(path) ? body : text(body)
    writeFileSync(`${out}/${name}.txt`, t)
    report[name] = { status: r.status, size: t.length }
  } catch (e) { report[name] = String(e) }
}
for (const [name, url] of [['portal', 'https://developers.anghami.com/'], ['terms', 'https://www.anghami.com/legal/terms'], ['github', 'https://github.com/anghami/sdk']]) {
  try {
    const r = await fetch(url, { headers: UA })
    const t = text(await r.text())
    writeFileSync(`${out}/${name}.txt`, t)
    report[name] = { status: r.status, size: t.length }
  } catch (e) { report[name] = String(e) }
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify(report))
