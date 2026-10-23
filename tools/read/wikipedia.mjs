// A few texts Arabic Wikipedia (CC BY-SA 4.0) gives in full, in its articles on
// them: the words are those in bold (or between « ») in the article's section
// of the text, and what is said between them ("ثم تقول:") heads what follows.
// Its markup is taken off, a ziyara's Quranic words in { } given the Quran's
// brackets ﴿ ﴾, and two slips of typing mended: a ي typed after an ى (عَلىي),
// and a bare ي ending a word after a fatha (or its tanwin), which is the alif
// maqsura (عَلَي → عَلَى, رِضًي → رِضًى); a space after a comma. Nothing else in the words is changed.
import { paragraphs } from './mafatih.mjs'

export const WIKIPEDIA_ITEMS = [
  { id: 'amin-allah', page: 'زيارة أمين الله', section: 'نص الزيارة', title: 'زيارة أمين الله', note: 'زيارة جامعة للأئمة عليهم السلام، عن قرب وعن بعد' },
  { id: 'al-yasin', page: 'زيارة آل ياسين', section: 'متن الزيارة', title: 'زيارة آل ياسين', note: 'زيارة الإمام المهدي عجّل الله فرجه، والدعاء بعدها' },
  { id: 'shabaniyya', page: 'الصلوات الشعبانية', section: 'نص الصلوات', title: 'الصلوات الشعبانية', note: 'للإمام زين العابدين عليه السلام، تُقرأ كل يوم من شعبان عند الزوال' },
]

/** Wiki markup off a piece of text: notes, links (their words stay), templates' names. */
function unwiki(s) {
  return s.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/<\/?[a-z][^>]*>/gi, '')
}

const mend = (s) => s.replace(/ىي/g, 'ى').replace(/([ًَ])ي(?![ً-ْٰ])(?=[\s،.؛:»]|$)/g, '$1ى').replace(/،(?=[ء-ي])/g, '، ')
  .replace(/\{\s*([^{}]+?)\s*\}/g, '﴿$1﴾').replace(/\s+/g, ' ').replace(/\s+([،.؛:])/g, '$1').replace(/،\s*،/g, '،').trim()

/** The article's opening paragraph, without its markup. */
export function leadOf(wt) {
  const body = unwiki(wt).replace(/\{\{[^{}]*\}\}/g, '').split(/\n==/)[0]
  return body.split('\n').map((l) => l.replace(/'''/g, '').trim()).find((l) => l.length > 60) || ''
}

/**
 * The text in the section whose heading starts with `section`: its bold (or
 * « »-quoted) runs in parts, the words between them heading the next part; what
 * comes before the first run (how it was narrated) given back as `intro`.
 */
export function textOfSection(wt, section) {
  const lines = wt.split('\n')
  const at = lines.findIndex((l) => new RegExp(`^==\\s*${section}`).test(l))
  if (at < 0) throw new Error(`no section ${section}`)
  const end = lines.findIndex((l, i) => i > at && /^==[^=]/.test(l))
  let body = unwiki(lines.slice(at + 1, end < 0 ? undefined : end).join('\n'))
  // A sub-heading inside it heads what follows it
  body = body.replace(/^===+\s*(.*?)\s*===+\s*$/gm, '\n@@$1@@\n')
  // A quote box's own fields are not words
  body = body.replace(/^\s*\|\s*(class|title|source|align|width|border|fontsize|bgcolor|style|title_bg|title_fnt|tstyle|qalign|qstyle|quoted|salign|sstyle)\s*=.*$/gm, '')
    .replace(/\{\{\s*مربع اقتباس/g, '').replace(/^\s*\|\s*quote\s*=/m, '').replace(/^\}\}\s*$/gm, '')
  const runs = /'''/.test(body) ? [...body.matchAll(/'''([\s\S]+?)'''/g)] : [...body.matchAll(/«([\s\S]+?)»/g)]
  if (!runs.length) throw new Error(`no words in ${section}`)
  const parts = []
  const intro = body.slice(0, runs[0].index).replace(/@@.*?@@/g, '').replace(/[«»]/g, '').replace(/\s+/g, ' ').trim()
  let last = runs[0].index
  for (const m of runs) {
    const between = body.slice(last, m.index)
    const sub = between.match(/@@(.*?)@@/)?.[1]
    const said = between.replace(/@@.*?@@/g, '').replace(/[«»]/g, '').replace(/^[\s.،:]+|[\s.،:]+$/g, '').trim()
    const head = sub || (said && said.length < 80 ? said.replace(/\s+/g, ' ') : '')
    const text = paragraphs(mend(m[1]))
    if (!parts.length || head) parts.push({ head: parts.length ? head : '', text })
    else parts[parts.length - 1].text.push(...text)
    last = m.index + m[0].length
  }
  return { intro, parts }
}
