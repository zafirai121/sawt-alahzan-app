// The colour the now-playing screen is tinted with, taken from the cover the
// way Spotify does it: the main hue of the artwork (its colourful part, not the
// black or white around it), as deep as the cover is dark and strong enough
// never to turn dull, with white text reading well on it.

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// The cover's colour as [h, s, l, depth]: the artwork's largest coloured area,
// not the black or white around it, nor the skin of the reciter's portrait
// most covers are; depth is how much of the cover is deep shadow (0 to 1).
// The same method as the phone app's (CoverColor.kt).
export function dominantHsl(source) {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;

  const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let n = 0, dark = 0, sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    n++; sr += r; sg += g; sb += b;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 0.2) dark++;
    if (l < 0.1 || l > 0.92 || s < 0.15) continue;
    // The reciter's face and hair, in nearly every cover, hardly count, however strong their tone
    const skin = h >= 0.02 && h <= 0.11 && l >= 0.15 && l <= 0.8 && s <= 0.85;
    const visible = Math.max(1 - Math.abs(l - 0.45) * 1.2, 0.1);
    const w = s * visible * (skin ? 0.15 : 1);
    const bin = bins[Math.floor(h * 24) % 24];
    bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
  }
  if (!n) return null;
  const depth = dark / n;
  // The winning hue family is a ±15° window: the gold and the red of a cover don't blend into orange
  const WINDOW = [0.6, 1, 0.6];
  let best = -1, bestW = 0;
  for (let i = 0; i < 24; i++) {
    const w = WINDOW.reduce((sum, k, j) => sum + k * bins[(i + j - 1 + 24) % 24].w, 0);
    if (w > bestW) { bestW = w; best = i; }
  }
  if (best >= 0 && bestW > n * 0.003) {
    let w = 0, r = 0, g = 0, b = 0;
    WINDOW.forEach((k, j) => { const bin = bins[(best + j - 1 + 24) % 24]; w += k * bin.w; r += k * bin.r; g += k * bin.g; b += k * bin.b; });
    return [...rgbToHsl(r / w, g / w, b / w), depth];
  }
  const [h, s, l] = rgbToHsl(sr / n, sg / n, sb / n); // black-and-white artwork: its grey
  return [h, Math.min(s, 0.16), l, depth];
}

// The shades the player uses: the top of the screen, the mini player, the
// lyrics card, a radio's light colour, and the bright one the pages and the
// full player glow with (the same ones as the phone app). That one is as deep
// as the cover is dark, and the deeper the stronger, so a dark cover gives a
// deep, rich tone, not a dull brown; a cover with hardly any colour, a grey.
export function playerShades([h, s, l, depth = 0.5]) {
  const sat = Math.min(s, 0.5);
  const grey = s < 0.17;
  const rich = grey ? s : Math.min(Math.max(s + 0.1, 0.58), 0.78);
  const deep = grey ? 0.34 - 0.06 * depth : 0.42 - 0.14 * depth;
  return {
    top: hslToHex(h, sat, Math.min(Math.max(l, 0.24), 0.3)),
    mini: hslToHex(h, Math.min(sat, 0.4), 0.19),
    card: hslToHex(h, Math.min(sat + 0.08, 0.55), 0.36),
    // A radio's page: the cover's hue, light (Spotify's pastel radio colours)
    pastel: hslToHex(h, Math.min(sat + 0.2, 0.6), 0.62),
    vivid: hslToHex(h, rich, deep),
  };
}

// The colour shown before the cover's is known (or when it can't be read): a
// quiet dark grey, which the cover's colour then fades in over
export const NEUTRAL_SHADES = playerShades([0, 0, 0.3, 0.5]);

// h in degrees, s and v 0 to 1 → "#rrggbb"
function hsvHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

// A playlist card's band (from its left to its right) and its name's colour,
// from the cover's colour ("#rrggbb"); greys for a grey one (as the phone app's)
export function bandColors(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!max || d / max < 0.15) return ['#5e5e5e', '#8c8c8c', '#111111'];
  const h = 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return [hsvHex((h + 330) % 360, 0.62, 0.78), hsvHex((h + 15) % 360, 0.6, 0.92), hsvHex(h, 0.7, 0.16)];
}

// a mixed into b by t (0 → a, 1 → b), both "#rrggbb"
export function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
