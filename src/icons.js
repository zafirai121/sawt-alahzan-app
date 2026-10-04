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
  Share2, MonitorSpeaker, Check, CirclePlus, Link, MessageSquareMore, Ellipsis, ImageDown, MessageCircle, Send,
} from 'lucide';

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
  // Spotify's now-playing row, from Lucide's own set as in the phone app
  queue: ListMusic, 'share-nodes': Share2, devices: MonitorSpeaker, cast: Cast, smartphone: Smartphone, bluetooth: Bluetooth,
  tick: Check, 'circle-plus': CirclePlus, link: Link, message: MessageSquareMore, ellipsis: Ellipsis, 'image-down': ImageDown,
  whatsapp: MessageCircle, send: Send,
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
