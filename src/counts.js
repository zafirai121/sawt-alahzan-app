// Counts as both platforms write them (the website's src/utils/plural.ts): the
// number in Western digits with thousands apart ("13,550"), and the noun after
// it as Arabic counts it: مقطع واحد، مقطعان، ثلاثة مقاطع، أحد عشر مقطعاً، مئة مقطع.
// Which form a number takes comes from the language's plural rules. (tests: tests/counts.test.mjs)

const rules = new Intl.PluralRules('ar');
const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
// Listens above a thousand are shortened ("12 ألف استماع"), as on the website
const compact = new Intl.NumberFormat('ar-u-nu-latn', { notation: 'compact', maximumFractionDigits: 1 });

export const TRACKS = { one: 'مقطع واحد', two: 'مقطعان', few: 'مقاطع', many: 'مقطعاً', other: 'مقطع' };
export const RECITERS = { one: 'رادود واحد', two: 'رادودان', few: 'رواديد', many: 'رادوداً', other: 'رادود' };
export const LISTENS = { one: 'استماع واحد', two: 'استماعان', few: 'استماعات', many: 'استماعاً', other: 'استماع' };

/** A number as shown: "13,550" */
export const formatNumber = (n) => grouped.format(Number(n) || 0);

/** "1,206 مقاطع", "412 مقطعاً", "مقطعان", "0 مقطع" ... */
export function countOf(n, forms) {
  const value = Number(n) || 0;
  const kind = rules.select(value);
  if (kind === 'one' || kind === 'two') return forms[kind];
  return `${formatNumber(value)} ${kind === 'few' || kind === 'many' ? forms[kind] : forms.other}`;
}

/** A number of tracks, on its own (a subtitle, a label): "مقطعان", "13,550 مقطعاً" */
export const tracksCount = (n) => countOf(n, TRACKS);

/** A number of listens: "377 استماعاً", "12 ألف استماع" */
export const listensCount = (n) => ((Number(n) || 0) >= 1000 ? `${compact.format(Number(n))} ${LISTENS.other}` : countOf(n, LISTENS));
