// How Anghami's public pages give their tracks' names (for Saqr to read a
// playlist's or an album's titles, then fetch each from YouTube): its pages as
// a browser gets them, what data they carry (JSON-LD, the server-rendered
// state, meta tags), and its public SDK's notes. Nothing is downloaded but the
// pages. For a look, on the "read-sources" branch.
import { mkdirSync, writeFileSync } from 'node:fs'
const out = (process.argv[2] || 'out') + '/anghami'
mkdirSync(out, { recursive: true })
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'ar,en;q=0.8',
}
const report = {}
async function page(name, url) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow' })
    const html = await r.text()
    writeFileSync(`${out}/${name}.html`, html)
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1].trim().slice(0, 120), size: m[2].length, start: m[2].trim().slice(0, 200) }))
    report[name] = {
      url, status: r.status, final: r.url, size: html.length,
      title: html.match(/<title[^>]*>([^<]*)/)?.[1],
      og: [...html.matchAll(/<meta[^>]+(?:property|name)="(og:[^"]+|music:[^"]+|twitter:[^"]+)"[^>]+content="([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`).slice(0, 30),
      ldjson: [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1].slice(0, 1500)),
      scripts: scripts.filter((s) => s.size > 0).slice(0, 25),
      links: [...new Set([...html.matchAll(/href="([^"]*\/(?:playlist|album|artist|song)\/\d+[^"]*)"/g)].map((m) => m[1]))].slice(0, 40),
    }
    return html
  } catch (e) { report[name] = { url, error: String(e) }; return '' }
}
async function api(name, url) {
  try {
    const r = await fetch(url, { headers: UA })
    const text = await r.text()
    writeFileSync(`${out}/${name}.json.txt`, text)
    report[name] = { url, status: r.status, size: text.length, start: text.slice(0, 600) }
  } catch (e) { report[name] = { url, error: String(e) } }
}

const home = await page('home', 'https://play.anghami.com/')
await page('search', `https://play.anghami.com/search/${encodeURIComponent('لطميات')}`)
await page('sdk-playlists', 'https://docs.sdk.anghami.com/playlists')
await page('sdk-home', 'https://docs.sdk.anghami.com/')
// A few of each kind of page linked from the home page
const links = [...new Set([...home.matchAll(/\/(playlist|album|artist|song)\/(\d+)/g)].map((m) => `${m[1]}/${m[2]}`))]
report.homeLinks = links.slice(0, 60)
const byKind = {}
for (const l of links) { const [k] = l.split('/'); (byKind[k] ||= []).push(l) }
for (const [kind, list] of Object.entries(byKind)) {
  for (const l of list.slice(0, 2)) {
    const id = l.split('/')[1]
    await page(`${kind}-${id}`, `https://play.anghami.com/${l}`)
    const type = { playlist: 'GETplaylistdata&playlistid', album: 'GETalbumdata&albumid', artist: 'GETartistprofile&artistid', song: 'GETsongdata&songid' }[kind]
    if (type) await api(`api-${kind}-${id}`, `https://api.anghami.com/gateway.php?type=${type}=${id}&output=jsonhp`)
  }
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1).slice(0, 5000))
