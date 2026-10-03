// The colour the now-playing screen is tinted with, taken from the cover the
// way Spotify does it: the main hue of the artwork (its colourful part, not the
// black or white around it), toned down to a dark, muted shade that white
// text reads well on.

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

// Dominant colour of an image (or canvas) as [h, s, l]
export function dominantHsl(source) {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;

  // Colourful pixels vote for their hue (24 bins of 15°): the more saturated
  // and the better lit, the stronger the vote. Near-black, near-white and grey pixels sit out. Muted
  // warm tones (skin, brown, beige) count for little: most covers are a
  // reciter's portrait, and they make a muddy background, so the colour comes
  // from the artwork around the face when it has one (as Spotify does).
  const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let n = 0, sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    n++; sr += r; sg += g; sb += b;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 0.07 || l > 0.9 || s < 0.12) continue;
    const muddy = h >= 0.02 && h <= 0.14 && s < 0.6;
    const visible = l < 0.2 ? 0.8 * (l / 0.2) ** 2 : 1 - Math.abs(l - 0.42); // deep shadows hardly count
    const w = s * visible * (muddy ? 0.2 : 1);
    const bin = bins[Math.floor(h * 24) % 24];
    bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
  }
  if (!n) return null;
  // The winning hue family is a ±30° window, so a colour spread over
  // neighbouring shades (dark green to olive) counts as one
  const WINDOW = [0.5, 0.8, 1, 0.8, 0.5];
  let best = -1, bestW = 0;
  for (let i = 0; i < 24; i++) {
    const w = WINDOW.reduce((sum, k, j) => sum + k * bins[(i + j - 2 + 24) % 24].w, 0);
    if (w > bestW) { bestW = w; best = i; }
  }
  if (best >= 0 && bestW > n * 0.002) {
    let w = 0, r = 0, g = 0, b = 0;
    WINDOW.forEach((k, j) => { const bin = bins[(best + j - 2 + 24) % 24]; w += k * bin.w; r += k * bin.r; g += k * bin.g; b += k * bin.b; });
    return rgbToHsl(r / w, g / w, b / w);
  }
  return rgbToHsl(sr / n, sg / n, sb / n); // black-and-white artwork: its grey
}

// The shades the player uses: the top of the screen, the mini player, the lyrics card
export function playerShades([h, s, l]) {
  const sat = Math.min(s, 0.5);
  return {
    top: hslToHex(h, sat, Math.min(Math.max(l, 0.24), 0.3)),
    mini: hslToHex(h, Math.min(sat, 0.4), 0.19),
    card: hslToHex(h, Math.min(sat + 0.08, 0.55), 0.36),
  };
}
