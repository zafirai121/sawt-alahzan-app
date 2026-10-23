// Du'as, ziyarat and munajat from Shaykh Abbas al-Qummi's Mafatih al-Jinan (in
// the public domain), as Persian Wikisource has its first part proofread
// (CC BY-SA 4.0): its pages' wikitext → each wanted text's Arabic words.
//
// The book is in Persian with its du'as in Arabic: the Arabic is taken (fully
// vowelled, so told from the Persian word by word), the author's Persian notes
// left out. Typed on a Persian keyboard, its letters are made Arabic: ک → ك,
// ی → ي (or ى at a word's end after a fatha: عَلَی → عَلَى), Persian digits →
// Arabic ones.

export const MAFATIH_INDEX = 'کتاب مفاتیح الجنان.pdf'
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
export const faNumber = (n) => String(n).replace(/\d/g, (d) => FA_DIGITS[d])

const HARAKA = /[\u064B-\u0652]/
const PERSIAN_LETTER = /[پچژگ‌]/
// Common Persian words, without vowels (the Arabic is vowelled)
const PERSIAN_WORDS = new Set(['که', 'است', 'این', 'آن', 'را', 'از', 'با', 'به', 'در', 'بر', 'تا', 'هر', 'پس', 'بگو', 'بگوید', 'بخوان', 'بخواند',
  'می', 'شود', 'کند', 'کرده', 'نقل', 'فرموده', 'مرتبه', 'مرتبه:', 'یعنی', 'او', 'آنکه', 'چون', 'باشد', 'نیز', 'خود', 'ایشان', 'آن‌ها', 'اول', 'دوم',
  'سوم', 'بعد', 'روایت', 'شده', 'گفته', 'مؤلف', 'گوید', 'حضرت', 'علیه', 'السلام', 'رحمة', 'الله', 'مستحب', 'خواندن', 'دعا', 'دعای', 'زیارت', 'کن'])

/** Persian letters typed for Arabic made Arabic (see the top). */
export function arabicLetters(s) {
  return s
    .replace(/ک/g, 'ك')
    // ی at a word's end, bare (no vowel of its own: حَیُّ and عَلَیَّ are ي), after
    // a fatha (or two) is the alif maqsura (عَلَی → عَلَى); else ي
    .replace(/ی(?![ً-ْٰ])(?![؀-ۿ])/g, (m, i, all) => (/[ًَ]ّ?$|َّ$/.test(all.slice(Math.max(0, i - 3), i)) ? 'ى' : 'ي'))
    .replace(/ی/g, 'ي')
    .replace(/ۀ/g, 'ة').replace(/ھ/g, 'ه')
    .replace(/[۰-۹]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[FA_DIGITS.indexOf(d)])
    .replace(/‌/g, '')
}

/** A page's wikitext → its plain lines (templates opened, bold and notes off). */
function plainPage(wt) {
  let s = wt.replace(/<noinclude>[\s\S]*?<\/noinclude>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<ref[^>]*\/>/g, '')
  let prev
  // {{و|...}}, {{بزرگتر|...}} and the like: their last part is the words shown
  do { prev = s; s = s.replace(/\{\{[^{}|]*\|([^{}]*)\}\}/g, (m, inner) => inner.split('|').pop()) } while (s !== prev)
  s = s.replace(/\{\{[^{}]*\}\}/g, '')
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, '').replace(/&nbsp;|&#32;/g, ' ')
}

/**
 * The book's pages joined (a page's last word runs on into the next), with where
 * each heading is, and where each page starts and how well it is proofread
 * (3 proofread, 4 validated).
 */
export function joinPages(pages) {
  let text = ''
  const heads = [] // { page, title, at }
  const starts = [] // { page, at, level }
  for (const [n, wt] of pages) {
    const level = Number(wt.match(/<pagequality level="(\d)"/)?.[1] ?? 0)
    const body = plainPage(wt)
    if (text && !/\n\s*$/.test(text)) text += ' '
    starts.push({ page: n, at: text.length, level })
    for (const m of body.matchAll(/'''([\s\S]+?)'''/g)) heads.push({ page: n, title: m[1].replace(/‌/g, '').trim(), at: text.length + m.index })
    text += body
  }
  return { text, heads, starts }
}

const tokenKind = (w) => {
  const bare = w.replace(/[^؀-ۿ‌]/g, '')
  if (!bare) return 'x'
  if (HARAKA.test(w)) return 'a'
  if (PERSIAN_LETTER.test(w) || PERSIAN_WORDS.has(bare)) return 'p'
  return 'n'
}

// The author's Persian notes the reader needs, said in Arabic: how many times a
// saying is said, and what is done between the sayings
const TIMES = { 'یک': 1, 'یکی': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10, 'یازده': 11, 'دوازده': 12, 'سی': 30, 'چهل': 40, 'پنجاه': 50, 'شصت': 60, 'هفتاد': 70, 'صد': 100 }
const TIMES_AR = ['', 'مرة واحدة', 'مرتين', 'ثلاث مرات', 'أربع مرات', 'خمس مرات', 'ست مرات', 'سبع مرات', 'ثماني مرات', 'تسع مرات', 'عشر مرات']
const TIMES_TENS = { 30: 'ثلاثين مرة', 40: 'أربعين مرة', 50: 'خمسين مرة', 60: 'ستين مرة', 70: 'سبعين مرة', 100: 'مئة مرة' }
const NOTES = [
  [/به سجده (برود|رود|رو|بگذار|بنه)|سر به سجده/, 'ثم يسجد ويقول'],
  [/حاجات? خود را (ذکر|بطلب|بخواه|بخواهد|بطلبد)|حاجت داری ذکر کن|حاجت خود را/, 'ثم يذكر حاجته'],
]

const timesOf = (n) => TIMES_AR[n] || TIMES_TENS[n] || `${String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d])} مرة`

/** What a Persian note between two sayings tells the reader, in Arabic ('' for nothing needed). */
export function noteOf(persian) {
  const said = NOTES.filter(([re]) => re.test(persian)).map(([, ar]) => ar)
  // How many times: said just before the saying (not in a story told before it)
  const counts = [...persian.split(/\s+/).slice(-6).join(' ').matchAll(/(?:^|[\s(])([؀-ۿ]+|[۰-۹]+)\s*(?:مرتبه|بار|دفعه)/g)]
    .map((m) => (/^[۰-۹]+$/.test(m[1]) ? Number(m[1].replace(/[۰-۹]/g, (d) => FA_DIGITS.indexOf(d))) : TIMES[m[1]]))
    .filter(Boolean)
  if (counts.length) said.push(timesOf(counts[counts.length - 1]))
  // "پس بگو" and nothing more: another saying begins
  if (!said.length && /(^|\s)(پس|و) (می‌?گویی|بگو|بگوید|می‌?گوید)\s*:?$/.test(persian.trim())) said.push('ثم يقول')
  return said.join('، ')
}

// A Persian word typed with no space before the Arabic (بگویداللَّهُمَّ): two words
const GLUED = /^(مرتبه|بگوید|بگو|دعایی|جمعه|روز|حقه|است|دریابد)(?=[آ-ی]+[ً-ْ])/
const unglue = (w) => { const m = w.match(GLUED); return m && /[ً-ْ]/.test(w.slice(m[1].length)) ? [m[1], w.slice(m[1].length)] : [w] }

const bareOf = (w) => w.replace(/[^؀-ۿ]/g, '')

// Unvowelled words that start an Arabic saying (لا إِلَهَ...), when vowelled words follow
const BARE_ARABIC = new Set(['لا', 'إلا', 'الا', 'ألا'])

/**
 * The Arabic of a passage, in parts: its runs of vowelled words (a word or two
 * unvowelled between them kept, as "لا"), three words or more, one line each;
 * the Persian notes between them left out, but for what the reader needs (how
 * many times, what to do), which heads the part it begins. An Arabic saying
 * quoted in brackets inside a Persian note is left out with it.
 */
export function arabicOf(passage) {
  const parts = [{ head: '', text: [] }]
  let between = [] // the words since the last saying taken
  let counted = false // the part's head is for its one saying
  const say = (run, persian) => {
    while (run.length && tokenKind(run[run.length - 1]) !== 'a') run.pop()
    const words = run.join(' ')
    const note = noteOf(between.slice(-12).join(' '))
    const quoted = /^\(.*\)$/.test(words.trim()) && persian
    if (run.filter((w) => tokenKind(w) === 'a').length < (note ? 2 : 3) || quoted) { between.push(...run); return }
    const line = arabicLetters(words.replace(/^[«(:\s]+/, '').trim())
    const notes = between.some((w) => tokenKind(w) === 'p')
    if (note) parts.push({ head: note, text: [line] })
    else if (counted && notes) parts.push({ head: '', text: [line] })
    else parts[parts.length - 1].text.push(line)
    counted = Boolean(note)
    between = []
  }
  for (const para of passage.replace(/'''/g, '').split(/\n\s*\n|\n/)) {
    const words = para.split(/\s+/).filter(Boolean).flatMap(unglue)
    if (!words.length) continue
    const kinds = words.map(tokenKind)
    const persian = kinds.some((k) => k === 'p')
    let run = []
    for (let i = 0; i < words.length; i++) {
      const k = kinds[i]
      if (k === 'a' || (k === 'x' && run.length)) { run.push(words[i]); continue }
      if (k === 'n') {
        const bare = bareOf(words[i])
        // up to two unvowelled words inside Arabic (لا, إلا...): kept when Arabic follows
        const next = kinds.slice(i + 1, i + 3)
        const arabicNext = next[0] === 'a' || (next[0] === 'n' && next[1] === 'a')
        if (run.length ? arabicNext : BARE_ARABIC.has(bare) && arabicNext) { run.push(words[i]); continue }
      }
      // A sura's or a saying's name in a Persian note ("إِنَّا أَنْزَلْنَاهُ را بخواند"): the note's
      if (run.length && bareOf(words[i]) === 'را') { between.push(...run); run = [] }
      if (run.length) { say(run, persian); run = [] }
      between.push(words[i])
    }
    if (run.length) say(run, persian)
  }
  return parts.filter((p) => p.text.length).map((p) => ({ head: p.head, text: paragraphs(p.text.join(' ')) }))
}

// The book's lines are its pages': a part is said again in paragraphs, each
// begun where a saying begins (اللَّهُمَّ, إِلَهِي, السَّلامُ...), of 30 words or more
const OPENS = new Set(['اللهم', 'الهي', 'السلام', 'سبحان', 'اشهد', 'الحمد'])
const plainWord = (w) => w.replace(/[ً-ْٰـ]/g, '').replace(/[أإآ]/g, 'ا')
function paragraphs(text) {
  const words = text.split(/\s+/).filter(Boolean)
  const out = []
  let cur = []
  for (let i = 0; i < words.length; i++) {
    const w = plainWord(words[i])
    const opens = OPENS.has(w) || (w === 'يا' && plainWord(words[i + 1] || '') === 'من')
    // A long one is broken where a clause begins, and a very long one anywhere
    if (cur.length >= 30 && (opens || (cur.length >= 90 && (w === 'و' || w === 'يا')) || cur.length >= 160)) { out.push(cur.join(' ')); cur = [] }
    cur.push(words[i])
  }
  if (cur.length) out.push(cur.join(' '))
  return out
}

/**
 * Where a text is: from the heading `from` on page `page` (or, for a RegExp, from
 * where it is found) to the next of `to`'s headings (to the start of its line)
 * or of `to`'s RegExps (where found).
 */
export function passageAt({ text, heads }, from, page, to) {
  let begin
  if (from instanceof RegExp) {
    const m = from.exec(text)
    if (!m) throw new Error(`not found: ${from}`)
    begin = m.index + m[0].length
  } else {
    const start = heads.find((h) => h.page === page && h.title.startsWith(from))
    if (!start) throw new Error(`heading not found: ${from} (page ${page})`)
    // From the end of the heading's line
    const lineEnd = text.indexOf('\n', start.at)
    begin = lineEnd < 0 ? start.at : lineEnd
  }
  const ends = to.map((t) => {
    if (t instanceof RegExp) { const m = t.exec(text.slice(begin)); return m ? begin + m.index : -1 }
    const head = heads.find((h) => h.at > begin && h.title.startsWith(t))
    if (!head) return -1
    // A page's first line runs on from the last page's: back only over what heads the line
    const line = text.lastIndexOf('\n', head.at)
    return line > begin && head.at - line < 40 ? line : head.at
  }).filter((at) => at > begin)
  if (!ends.length) throw new Error(`no end after: ${from}`)
  return { start: begin, end: Math.min(...ends) }
}
export const passage = (joined, from, page, to) => {
  const { start, end } = passageAt(joined, from, page, to)
  return joined.text.slice(start, end)
}

// ─── What is taken ───
// Each text: where it starts and ends (see passageAt), its title and a line on it
// (when and why it is read, from the author's note), and its group in the index.
const SAHIFA_SUPPLEMENT = 'من ملحقات الصحيفة السجادية'
export const MAFATIH_ITEMS = [
  // Chapter 6: well-known du'as
  { id: 'sabah', from: 'دعای صباح', page: 60, to: ['دعای کمیل'], title: 'دعاء الصباح', note: 'لأمير المؤمنين عليه السلام، يُقرأ بعد صلاة الصبح' },
  { id: 'ashara', from: 'دعای عشرات', page: 67, to: ['دعای سمات'], title: 'دعاء العشرات', note: 'يُستحب كل صباح ومساء، وأفضل أوقاته بعد عصر الجمعة' },
  { id: 'simat', from: 'دعای سمات', page: 70, to: ['دعای مشلول', /مؤلف گوید که در بعض نسخ/], title: 'دعاء السمات', note: 'يُستحب في آخر ساعة من نهار الجمعة' },
  { id: 'mashlul', from: 'دعای مشلول', page: 74, to: ['دعای معروف به یستشیر'], title: 'دعاء المشلول', note: 'علّمه أمير المؤمنين عليه السلام شاباً أُخذ بذنبه' },
  { id: 'yastashir', from: 'دعای معروف به یستشیر', page: 78, to: ['دعای مجیر'], title: 'دعاء يستشير', note: 'علّمه النبي صلى الله عليه وآله أمير المؤمنين عليه السلام' },
  { id: 'adila', from: 'دعای عدیله', page: 84, to: ['مؤلف گوید'], title: 'دعاء العديلة', note: 'في الإقرار بأصول العقيدة' },
  { id: 'saifi', from: 'دعای سیفی صغیر', page: 106, to: ['فصل هفتم'], title: 'دعاء السيفي الصغير (دعاء القاموس)', note: '' },
  // Chapter 7: short du'as of use (the 2nd, al-Tawassul, is Wikisource's; the 10th is the Sahifa's 7th)
  { id: 'karb', from: /\nسوم‌?\s+شیخ کفعمی در بلد الامین دعایی/, to: [/\nچهارم دعای خلاص/], title: 'دعاء المكروب والمحزون', note: 'عن أمير المؤمنين عليه السلام: لكل ملهوف ومكروب ومحزون وخائف' },
  { id: 'khalas', from: /\nچهارم دعای خلاص/, to: [/\nپنجم/], title: 'دعاء الخلاص من الشدة', note: 'علّمته السيدة الزهراء عليها السلام في المنام رجلاً طال حبسه' },
  { id: 'nur', from: /\nپنجم‌?\s+سید بن طاوس در مهج الدعوات روایتی از سلمان/, to: ['ششم'], title: 'دعاء النور', note: 'علّمته السيدة الزهراء عليها السلام سلمانَ، يُقرأ صباحاً ومساءً للعافية من الحمّى' },
  { id: 'hirz-sajjad', from: 'ششم', page: 113, to: ['هفتم'], title: 'حرز الإمام زين العابدين عليه السلام', note: 'للحفظ والأمان' },
  { id: 'ilahi-kayf', from: 'هفتم', page: 113, to: ['هشتم'], title: 'دعاء «إلهي كيف أدعوك وأنا أنا»', note: 'للإمام زين العابدين عليه السلام' },
  { id: 'tara', from: 'هشتم', page: 114, to: ['نهم'], title: 'دعاء «اللهم إنك ترى ولا تُرى»', note: 'علّمه جبرئيل النبيَّ صلى الله عليه وآله، يُكثر منه' },
  { id: 'kazim', from: 'نهم', page: 114, to: ['دهم'], title: 'دعاء الإمام الكاظم عليه السلام', note: 'عظيم الشأن سريع الإجابة' },
  { id: 'faraj', from: 'یازدهم', page: 115, to: ['دوازدهم'], title: 'دعاء الفرج «إلهي عظم البلاء»', note: 'دعاء صاحب الأمر عجّل الله فرجه، علّمه رجلاً محبوساً فخُلّص' },
  { id: 'tawfiq', from: 'دوازدهم', page: 116, to: ['سیزدهم'], title: 'دعاء «اللهم ارزقنا توفيق الطاعة»', note: 'دعاء الإمام المهدي عجّل الله فرجه' },
  { id: 'bihaqqi', from: 'سیزدهم', page: 116, to: ['چهاردهم'], title: 'دعاء «إلهي بحق من ناجاك»', note: 'دعاء الإمام المهدي عجّل الله فرجه' },
  { id: 'istighatha', from: 'چهاردهم', page: 117, to: ['فصل هشتم'], title: 'الاستغاثة بالإمام المهدي عجّل الله فرجه', note: 'يصلّي ركعتين بالحمد وما شاء من السور، ثم يقف تحت السماء مستقبل القبلة ويقول' },
  // The prayers' own ta'qibat, from al-Shaykh al-Tusi's Misbah al-Mutahajjid (the
  // Maghrib's to its nafila, the Fajr's to its hundred Tawhid: what follows needs the Persian)
  { id: 'taqib-zuhr', from: 'فصل دوم در تعقیبات', page: 16, to: ['تعقیب نماز عصر'], title: 'تعقيب صلاة الظهر', note: 'من مصباح المتهجد' },
  { id: 'taqib-asr', from: 'تعقیب نماز عصر', page: 17, to: ['تعقیب نماز مغرب'], title: 'تعقيب صلاة العصر', note: 'من مصباح المتهجد' },
  { id: 'taqib-maghrib', from: 'تعقیب نماز مغرب', page: 17, to: ['تعقیب نماز عشا', /پس نافله مغرب را/], title: 'تعقيب صلاة المغرب', note: 'بعد تسبيح الزهراء عليها السلام، من مصباح المتهجد' },
  { id: 'taqib-isha', from: 'تعقیب نماز عشا', page: 19, to: ['مؤلف گوید'], title: 'تعقيب صلاة العشاء', note: 'من مصباح المتهجد' },
  { id: 'taqib-subh', from: 'تعقیب نماز صبح', page: 19, to: ['مؤلف گوید', /و صد مرتبه توحید/], title: 'تعقيب صلاة الصبح', note: 'من مصباح المتهجد' },
  // The days' du'as
  { id: 'week-sat', from: 'دعای روز شنبه', page: 27, to: ['فصل چهارم'], title: 'دعاء يوم السبت', note: SAHIFA_SUPPLEMENT },
  { id: 'week-sun', from: 'دعای روز یکشنبه', page: 23, to: ['دعای روز دوشنبه'], title: 'دعاء يوم الأحد', note: SAHIFA_SUPPLEMENT },
  { id: 'week-mon', from: 'دعای روز دوشنبه', page: 24, to: ['دعای روز سه'], title: 'دعاء يوم الاثنين', note: SAHIFA_SUPPLEMENT },
  { id: 'week-tue', from: 'دعای روز سه', page: 25, to: ['دعای روز چهارشنبه'], title: 'دعاء يوم الثلاثاء', note: SAHIFA_SUPPLEMENT },
  { id: 'week-wed', from: 'دعای روز چهارشنبه', page: 25, to: ['دعای روز پنجشنبه'], title: 'دعاء يوم الأربعاء', note: SAHIFA_SUPPLEMENT },
  { id: 'week-thu', from: 'دعای روز پنجشنبه', page: 26, to: ['دعای روز جمعه'], title: 'دعاء يوم الخميس', note: SAHIFA_SUPPLEMENT },
  { id: 'week-fri', from: 'دعای روز جمعه', page: 27, to: ['دعای روز شنبه'], title: 'دعاء يوم الجمعة', note: SAHIFA_SUPPLEMENT },
  // The ziyarat of the days of the week: each day's own (Saturday the Prophet's...)
  // (its Saturday ziyara's first page is not proofread yet: the salam Imam al-Rida taught, which follows it)
  { id: 'z-nabi', from: /ابن ابی نصر خدمت امام رضا/, to: ['زیارت امیر المؤمنین'], title: 'زيارة النبي صلى الله عليه وآله', note: 'السلام عليه كما علّمه الإمام الرضا عليه السلام ابنَ أبي نصر البزنطي' },
  { id: 'z-amir', from: 'زیارت امیر المؤمنین', page: 56, to: ['زیارت حضرت فاطمه'], title: 'زيارة أمير المؤمنين عليه السلام', note: 'في يوم الأحد' },
  { id: 'z-zahra', from: 'زیارت حضرت فاطمه', page: 56, to: ['ایضاً زیارت'], title: 'زيارة السيدة فاطمة الزهراء عليها السلام', note: 'في يوم الأحد' },
  { id: 'z-zahra-2', from: 'ایضاً زیارت', page: 56, to: ['روز دوشنبه'], title: 'زيارة السيدة الزهراء عليها السلام (رواية أخرى)', note: 'زيارتها: يا ممتحنة' },
  { id: 'z-hasan', from: 'روز دوشنبه', page: 57, to: ['زیارت حضرت امام حسین'], title: 'زيارة الإمام الحسن المجتبى عليه السلام', note: 'في يوم الاثنين' },
  { id: 'z-husain', from: 'زیارت حضرت امام حسین', page: 57, to: ['روز سه'], title: 'زيارة الإمام الحسين عليه السلام', note: 'في يوم الاثنين' },
  { id: 'z-tue', from: 'روز سه', page: 58, to: ['روز چهارشنبه'], title: 'زيارة الأئمة السجاد والباقر والصادق عليهم السلام', note: 'في يوم الثلاثاء' },
  { id: 'z-wed', from: 'روز چهارشنبه', page: 58, to: ['روز پنجشنبه'], title: 'زيارة الأئمة الكاظم والرضا والجواد والهادي عليهم السلام', note: 'في يوم الأربعاء' },
  { id: 'z-askari', from: 'روز پنجشنبه', page: 59, to: ['روز جمعه'], title: 'زيارة الإمام الحسن العسكري عليه السلام', note: 'في يوم الخميس' },
  { id: 'z-mahdi', from: 'روز جمعه', page: 59, to: ['فصل ششم', /سید بن طاوس گفته که من بعد از این زیارت/], title: 'زيارة الإمام المهدي عجّل الله فرجه', note: 'في يوم الجمعة' },
  // The fifteen munajat of Imam Zayn al-Abidin, found by their headings' last word
  ...[
    ['تائبین', 'التائبين'], ['شاکین', 'الشاكين'], ['خائفین', 'الخائفين'], ['راجین', 'الراجين'], ['راغبین', 'الراغبين'], ['شاکرین', 'الشاكرين'],
    ['مطیعین', 'المطيعين لله'], ['مریدین', 'المريدين'], ['محبین', 'المحبين'], ['متوسلین', 'المتوسلين'], ['مفتقرین', 'المفتقرين'], ['عارفین', 'العارفين'],
    ['ذاکرین', 'الذاكرين'], ['معتصمین', 'المعتصمين'], ['زاهدین', 'الزاهدين'],
  ].map(([fa, ar], i) => ({
    id: `munajat-${i + 1}`, munajat: fa, title: `مناجاة ${ar}`,
    note: `المناجاة ${['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة', 'الحادية عشرة', 'الثانية عشرة', 'الثالثة عشرة', 'الرابعة عشرة', 'الخامسة عشرة'][i]} من الخمس عشرة`,
  })),
]

/** Where a munajat is: its heading ("المناجات الاولی مناجات التائبین"...) to the next one's. */
function munajatAt(joined, fa) {
  const heads = joined.heads.filter((h) => h.page >= 118 && h.page <= 129 && /مناجا[تة] /.test(h.title) && !/خمس عشرة|منظومه/.test(h.title))
  const i = heads.findIndex((h) => h.title.includes(fa))
  if (i < 0) throw new Error(`munajat not found: ${fa}`)
  const start = joined.text.indexOf('\n', heads[i].at)
  const end = heads[i + 1] ? heads[i + 1].at : joined.text.indexOf('مناجات منظومه', start)
  return { start, end }
}

/**
 * Each text taken: its words in parts, and the book's pages it is on (to name
 * them, and to take only proofread ones).
 */
export function mafatihTexts(joined) {
  return MAFATIH_ITEMS.map((it) => {
    try {
      const { start, end } = it.munajat ? munajatAt(joined, it.munajat) : passageAt(joined, it.from, it.page, it.to)
      const on = joined.starts.filter((p, i) => p.at < end && (joined.starts[i + 1]?.at ?? Infinity) > start)
      return { ...it, parts: arabicOf(joined.text.slice(start, end)), pages: on.map((p) => p.page), levels: on.map((p) => p.level) }
    } catch (e) {
      return { ...it, error: String(e) }
    }
  })
}
