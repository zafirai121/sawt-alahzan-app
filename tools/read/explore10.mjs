// A few Wikipedia articles' wikitext as it is, to see how their texts are written
// before taking them in. For a look, on the "read-sources" branch.
import { mkdirSync, writeFileSync } from 'node:fs'
const out = (process.argv[2] || 'out') + '/explore10'
mkdirSync(out, { recursive: true })
const UA = { 'User-Agent': 'SawtAlAhzanReader/1.0 (https://zafirai121.github.io/sawt-alahzan-app/)' }
const api = 'https://ar.wikipedia.org/w/api.php'
for (const title of ['الصلوات الشعبانية', 'دعاء اللهم كن لولیك', 'زيارة أمين الله', 'زيارة آل ياسين']) {
  const j = await (await fetch(`${api}?action=query&prop=revisions&rvprop=content|ids&rvslots=main&titles=${encodeURIComponent(title)}&format=json`, { headers: UA })).json()
  const p = Object.values(j.query.pages)[0]
  writeFileSync(`${out}/${title.replace(/\s+/g, '_')}.txt`, `${p.revisions?.[0]?.revid}\n${p.revisions?.[0]?.slots?.main?.['*'] || '(none)'}`)
  console.log(title, p.revisions?.[0]?.revid)
}
