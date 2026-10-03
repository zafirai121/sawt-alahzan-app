// Lucide icons — the same set the website (web.soutalahzan.com) uses.
// Markup uses <i class="ic" data-icon="play"></i>; the icon is drawn inside the
// <i> at 1em, so the element's font-size and color size and tint it.
// Filled glyphs (play/pause, a liked heart) add data-fill.
import {
  House, Search, Library, User, Plus, ArrowRight, ChevronRight, ChevronLeft, ChevronDown,
  EllipsisVertical, Heart, CircleArrowDown, CircleCheck, Shuffle, Repeat, Repeat1, Play, Pause,
  SkipBack, SkipForward, Settings, Camera, Music, ListMusic, List, ListPlus, Mic, Mail, SquarePen,
  LogOut, Maximize2, LoaderCircle, Eye, EyeOff, Share, Radio, Clock3, UserPlus, UserCheck, X,
  Download, Trash2, Timer, Disc3, WifiOff, Cast, Smartphone, Bluetooth,
} from 'lucide';

// Drawn to match Spotify's now-playing row: the queue (a "now playing" pill
// over two lines), share (three linked dots) and connect to a device (a
// screen outline and a speaker)
const Queue = [
  ['rect', { x: '4.5', y: '3.5', width: '15.5', height: '5', rx: '2.5' }],
  ['path', { d: 'M3.5 14h16.5' }],
  ['path', { d: 'M3.5 19.5h16.5' }],
];
const ShareNodes = [
  ['circle', { cx: '18', cy: '5', r: '2.6' }],
  ['circle', { cx: '6', cy: '12', r: '2.6' }],
  ['circle', { cx: '18', cy: '19', r: '2.6' }],
  ['path', { d: 'M8.3 13.3l7.4 4.4' }],
  ['path', { d: 'M15.7 6.3l-7.4 4.4' }],
];
const Devices = [
  ['path', { d: 'M9 4.5H4.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2' }],
  ['path', { d: 'M9 19.5h.01' }],
  ['rect', { x: '11.5', y: '3', width: '9.5', height: '18', rx: '2' }],
  ['circle', { cx: '16.25', cy: '14.5', r: '2.5' }],
  ['path', { d: 'M16.25 7.5h.01' }],
];

const ICONS = {
  home: House, search: Search, library: Library, user: User, plus: Plus,
  back: ArrowRight, 'chevron-right': ChevronRight, 'chevron-left': ChevronLeft, 'chevron-down': ChevronDown,
  more: EllipsisVertical, heart: Heart, download: CircleArrowDown, 'download-plain': Download,
  check: CircleCheck, shuffle: Shuffle, repeat: Repeat, 'repeat-one': Repeat1, play: Play, pause: Pause,
  prev: SkipBack, next: SkipForward, settings: Settings, camera: Camera, music: Music,
  playlist: ListMusic, list: List, 'list-plus': ListPlus, mic: Mic, mail: Mail, edit: SquarePen,
  logout: LogOut, expand: Maximize2, spinner: LoaderCircle, eye: Eye, 'eye-off': EyeOff,
  share: Share, radio: Radio, clock: Clock3, follow: UserPlus, following: UserCheck, close: X,
  trash: Trash2, timer: Timer, disc: Disc3, 'wifi-off': WifiOff,
  queue: Queue, 'share-nodes': ShareNodes, devices: Devices, cast: Cast, smartphone: Smartphone, bluetooth: Bluetooth,
};

const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// SVG markup for an icon; `fill` paints the shape (play, pause, liked heart).
// The outline stays: some glyphs have parts that are lines only (the bar of
// skip back / forward).
export function iconSvg(name, { fill = false, strokeWidth = 2 } = {}) {
  const node = ICONS[name];
  if (!node) return '';
  const children = node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escAttr(v)}"`).join(' ')}/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" ` +
    `fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${strokeWidth}" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${name === 'spinner' ? ' class="ic-spin"' : ''}>${children}</svg>`;
}

// Inline markup for templates: icon('play', { fill: true })
export function icon(name, opts = {}) {
  return `<i class="ic" data-icon="${name}"${opts.fill ? ' data-fill' : ''} data-drawn>${iconSvg(name, opts)}</i>`;
}

// Change an existing icon element (e.g. play ⇄ pause, heart ⇄ filled heart)
export function setIcon(el, name, { fill = false } = {}) {
  if (!el) return;
  el.dataset.icon = name;
  if (fill) el.dataset.fill = ''; else delete el.dataset.fill;
  el.innerHTML = iconSvg(name, { fill });
  el.dataset.drawn = '';
}

function draw(el) {
  el.innerHTML = iconSvg(el.dataset.icon, { fill: el.hasAttribute('data-fill') });
  el.dataset.drawn = '';
}

// Draw every placeholder now, and any that later appear in the page
export function startIcons(root = document.body) {
  root.querySelectorAll('[data-icon]:not([data-drawn])').forEach(draw);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches('[data-icon]:not([data-drawn])')) draw(n);
        n.querySelectorAll?.('[data-icon]:not([data-drawn])').forEach(draw);
      }
    }
  }).observe(root, { childList: true, subtree: true });
}
