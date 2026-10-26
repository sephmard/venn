// "It's set": a picture of the picked date to post in the group chat or an Instagram story. Finn the dog
// in front of the Venn circles, the poll's emoji and title, the date, and (when the poll shows who
// answered) the initials of who can make it. Drawn on a <canvas>, so it needs nothing from anyone else.
// The poll page loads this only when someone presses "Share as a picture".

import { rankTimes } from './core.js';
import { hue, initials, toast, track } from './ui.js';

/**
 * The sizes it can draw: a 9:16 story (the default) and a square. `pad` is the side margin; `top` and
 * `footer` keep the story's words clear of Instagram's own buttons at the top and bottom (it moves up
 * to `topMin` only when a long title needs the room).
 */
export const SIZES = {
  story: {
    width: 1080,
    height: 1920,
    pad: 96,
    top: 200,
    topMin: 96,
    footer: 420,
    gap: 44,
    pill: 46,
    title: [124, 64, 3],
    date: [80, 48, 2],
    av: 60,
    caption: 40,
    hero: [300, 640],
  },
  square: {
    width: 1080,
    height: 1080,
    pad: 72,
    top: 72,
    topMin: 48,
    footer: 110,
    gap: 26,
    pill: 36,
    title: [92, 52, 2],
    date: [60, 40, 2],
    av: 44,
    caption: 32,
    hero: [180, 360],
  },
};

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF = '"Instrument Serif", "Iowan Old Style", "Palatino Linotype", Georgia, serif';
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
export const KICKER = "It's set";
const MAX_FACES = 8;

// The app's colours (styles.css), light and dark.
export const THEMES = {
  light: {
    bg: '#faf8f4',
    glow: '#c3f2de',
    ink: '#16181a',
    muted: '#55585c',
    green: '#0b7a5c',
    greenInk: '#ffffff',
    tile: '#ffffff',
    more: '#e4dfd4',
    shadow: 'rgba(22, 24, 26, 0.18)',
  },
  dark: {
    bg: '#0f1112',
    glow: '#1d4d3d',
    ink: '#f1eee8',
    muted: '#a6a9ad',
    green: '#2fc497',
    greenInk: '#06140f',
    tile: '#1f2326',
    more: '#2a2e31',
    shadow: 'rgba(0, 0, 0, 0.5)',
  },
};
// The logo's three shades (favicon.svg): one circle, two overlapping, all three.
const SHADES = [
  ['#c3f2de', '#7fd9b4'],
  ['#5fd0a2', '#1f9d72'],
  ['#0f8a63', '#064c39'],
];
const CONFETTI = ['#0b7a5c', '#2fc497', '#8fd9bf', '#14513f', '#e0a12e', '#7fd9b4'];

// ---------- text ----------

/** Split `text` into lines no wider than `maxWidth`, breaking inside a word only when it's too long alone. */
export function wrap(measure, text, font, maxWidth) {
  const fits = (s) => measure(s, font) <= maxWidth;
  const lines = [];
  let line = '';
  for (const word of String(text).trim().split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    if (fits(word)) {
      line = word;
      continue;
    }
    for (const ch of Array.from(word)) {
      if (line && !fits(line + ch)) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Shorten a line until it fits with "…" on the end. */
export function ellipsize(measure, text, font, maxWidth) {
  let chars = Array.from(text.trimEnd());
  while (chars.length && measure(`${chars.join('').trimEnd()}…`, font) > maxWidth) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

/**
 * The biggest size from `max` down to `min` at which `text` fits in `maxLines` lines. If it doesn't fit
 * even at `min`, the last line ends with "…". `font(px)` makes the CSS font for a size.
 */
export function fitText(measure, text, { font, max, min, maxWidth, maxLines }) {
  for (let px = max; px >= min; px -= 2) {
    const lines = wrap(measure, text, font(px), maxWidth);
    if (lines.length <= maxLines) return { size: px, font: font(px), lines };
  }
  const f = font(min);
  const lines = wrap(measure, text, f, maxWidth);
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(measure, lines.slice(maxLines - 1).join(' '), f, maxWidth);
  return { size: min, font: f, lines: kept };
}

/** "Dinner at Finn's" → "dinner-at-finns-its-set.png". */
export function fileName(title) {
  const slug = String(title)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${slug || 'venn'}-its-set.png`;
}

/** Who can make the picked date, yes first, or null when the poll keeps answers or names private. */
export function whoCanMakeIt(ev) {
  if (ev.hideResults || ev.hideNames || ev.finalStart == null) return null;
  const at = rankTimes(ev, ev.slots || [], ev.participants || [], Infinity).find((b) => b.start === ev.finalStart);
  return at ? [...at.yes, ...at.ifNeeded] : [];
}

// ---------- layout ----------

/**
 * Where everything goes. `measure(text, font)` is the width of `text` in a CSS font. `people` is a
 * list of names, or null to leave the faces out. Pure, so it's tested without a browser.
 */
export function layoutCard(measure, { size = 'story', title, when, emoji = '', people = null }) {
  const S = SIZES[size] || SIZES.story;
  const { width: W, height: H, pad, gap } = S;
  const maxWidth = W - 2 * pad;
  const serif = (px) => `400 ${px}px ${SERIF}`;
  const t = fitText(measure, title || 'Plans', { font: serif, max: S.title[0], min: S.title[1], maxWidth, maxLines: S.title[2] });
  // The date never outshouts the title: at most 80% of its size.
  const dateMax = Math.max(S.date[1], Math.min(S.date[0], Math.round((t.size * 0.8) / 2) * 2));
  const d = fitText(measure, when, { font: serif, max: dateMax, min: S.date[1], maxWidth, maxLines: S.date[2] });
  const pillFont = `700 ${S.pill}px ${SANS}`;
  const pill = { text: KICKER, font: pillFont, w: measure(KICKER, pillFont) + S.pill * 1.6, h: S.pill * 1.9 };
  const titleLh = t.size * 1.06;
  const dateLh = d.size * 1.18;

  const faces = people?.length ? people : null;
  const shown = faces ? faces.slice(0, faces.length > MAX_FACES ? MAX_FACES - 1 : MAX_FACES) : [];
  const more = faces ? faces.length - shown.length : 0;
  const capPx = S.caption;
  const peopleH = faces ? gap + 2 * S.av + capPx * 0.6 + capPx * 1.5 : 0;

  const textH = pill.h + gap + t.lines.length * titleLh + gap * 0.5 + d.lines.length * dateLh + peopleH;
  const area = H - S.top - S.footer; // between the top margin and the footer
  const heroH = Math.max(S.hero[0], Math.min(S.hero[1], area - textH - gap));
  const spare = area - heroH - gap - textH;
  const top = spare >= 0 ? S.top + spare / 2 : Math.max(S.topMin, S.top + spare);

  // The hero is the celebration's (celebrate.js) on a 230 × 220 grid, scaled up.
  const s = heroH / 220;
  const hero = { x: (W - 230 * s) / 2, y: top, s, w: 230 * s, h: heroH };
  let y = top + heroH + gap;
  const out = {
    width: W,
    height: H,
    hero,
    sticker: emoji ? { emoji, x: hero.x + 172 * s, y: hero.y + 10 * s, size: 62 * s } : null,
    pill: { ...pill, x: (W - pill.w) / 2, y },
  };
  y += pill.h + gap;
  out.title = { font: t.font, size: t.size, lines: t.lines.map((text, i) => ({ text, x: W / 2, y: y + (i + 0.5) * titleLh })) };
  y += t.lines.length * titleLh + gap * 0.5;
  out.date = { font: d.font, size: d.size, lines: d.lines.map((text, i) => ({ text, x: W / 2, y: y + (i + 0.5) * dateLh })) };
  y += d.lines.length * dateLh;

  out.faces = [];
  out.caption = null;
  if (faces) {
    y += gap;
    const r = S.av;
    const step = r * 1.72; // overlapping, like the avatar stacks on the page
    const n = shown.length + (more ? 1 : 0);
    let x = (W - (2 * r + (n - 1) * step)) / 2 + r;
    for (const name of shown) {
      out.faces.push({ text: initials(name), hue: hue(name), x, y: y + r, r });
      x += step;
    }
    if (more) out.faces.push({ text: `+${more}`, more: true, x, y: y + r, r });
    y += 2 * r + capPx * 0.6;
    const k = faces.length;
    out.caption = {
      text: `${k} ${k === 1 ? 'person' : 'people'} can make it`,
      font: `600 ${capPx}px ${SANS}`,
      x: W / 2,
      y: y + capPx * 0.75,
    };
    y += capPx * 1.5;
  }
  out.bottom = y; // where the content ends; the footer sits below
  const markPx = S.pill * 0.85;
  const markFont = `700 ${markPx}px ${SANS}`;
  const markW = markPx * 1.25 + markPx * 0.4 + measure('venn.day', markFont);
  out.footer = { text: 'venn.day', font: markFont, size: markPx, x: (W - markW) / 2, y: H - S.footer / 2, w: markW };
  return out;
}

// ---------- drawing ----------

const circle = (ctx, x, y, r) => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Three circles like the logo: one shade where one covers, deeper where two overlap, deepest in the middle. */
function venn(ctx, centers, r) {
  const xs = centers.map((c) => c[0]);
  const ys = centers.map((c) => c[1]);
  const shade = ([from, to]) => {
    const g = ctx.createLinearGradient(Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + r, Math.max(...ys) + r);
    g.addColorStop(0, from);
    g.addColorStop(1, to);
    return g;
  };
  const fillIn = (clips, c, style) => {
    ctx.save();
    for (const k of clips) {
      circle(ctx, ...centers[k], r);
      ctx.clip();
    }
    ctx.fillStyle = style;
    circle(ctx, ...centers[c], r);
    ctx.fill();
    ctx.restore();
  };
  ctx.fillStyle = shade(SHADES[0]);
  for (const c of centers) {
    circle(ctx, ...c, r);
    ctx.fill();
  }
  const two = shade(SHADES[1]);
  fillIn([0], 1, two);
  fillIn([0], 2, two);
  fillIn([1], 2, two);
  fillIn([0, 1], 2, shade(SHADES[2]));
}

/** A small random-looking scatter of confetti around the hero, the same every time for a title. */
function confetti(ctx, L, seed) {
  let n = seed || 1;
  const rand = () => (n = (n * 1103515245 + 12345) % 2147483648) / 2147483648;
  const { hero } = L;
  const cx = hero.x + hero.w / 2;
  const cy = hero.y + hero.h / 2;
  for (let i = 0; i < 16; i++) {
    // Above and beside the hero, never over the words below it.
    const a = Math.PI * (0.92 + (1.16 * (i + rand() * 0.8)) / 16);
    const d = hero.w * (0.58 + rand() * 0.3);
    const sz = hero.s * (4 + rand() * 4);
    const x = Math.min(L.width - sz * 2, Math.max(sz * 2, cx + Math.cos(a) * d * 1.05));
    const y = Math.max(sz * 2, cy + Math.sin(a) * d * 0.95);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI);
    ctx.fillStyle = CONFETTI[i % CONFETTI.length];
    if (i % 3 === 0) {
      circle(ctx, 0, 0, sz * 0.6);
      ctx.fill();
    } else {
      roundRect(ctx, -sz, -sz * 0.35, sz * 2, sz * 0.7, sz * 0.3);
      ctx.fill();
    }
    ctx.restore();
  }
}

function text(ctx, { text: t, x, y }, font, color, align = 'center') {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(t, x, y);
}

/** Draw a layout (from layoutCard) on a 2D context. `dog` is Finn's picture, or null to leave him out. */
export function drawCard(ctx, L, { theme = 'light', dog = null, seed = 1 } = {}) {
  const T = THEMES[theme] || THEMES.light;
  const { width: W, height: H, hero } = L;
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, W, H);
  // A soft glow behind the hero, like the landing page's.
  const gx = W / 2;
  const gy = hero.y + hero.h * 0.55;
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, hero.w * 1.05);
  glow.addColorStop(0, T.glow);
  glow.addColorStop(1, T.bg);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  confetti(ctx, L, seed);

  // The hero: the three circles, and Finn standing in front of them (celebrate.js's party, scaled up).
  const { x: hx, y: hy, s } = hero;
  ctx.save();
  ctx.globalAlpha = 0.92;
  venn(
    ctx,
    [
      [hx + 115 * s, hy + 70 * s],
      [hx + 64 * s, hy + 150 * s],
      [hx + 166 * s, hy + 150 * s],
    ],
    64 * s,
  );
  ctx.restore();
  if (dog) {
    ctx.save();
    ctx.shadowColor = 'rgba(6, 76, 57, 0.35)';
    ctx.shadowBlur = 24 * s;
    ctx.shadowOffsetY = 6 * s;
    ctx.drawImage(dog, hx + 69 * s, hy + 4 * s, 92 * s, 200 * s);
    ctx.restore();
  }
  // The poll's emoji on a tile, stuck on at an angle.
  if (L.sticker) {
    const { emoji, x, y, size } = L.sticker;
    ctx.save();
    ctx.translate(x + size / 2, y + size / 2);
    ctx.rotate(0.14);
    ctx.shadowColor = T.shadow;
    ctx.shadowBlur = size * 0.25;
    ctx.shadowOffsetY = size * 0.08;
    ctx.fillStyle = T.tile;
    roundRect(ctx, -size / 2, -size / 2, size, size, size * 0.24);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    text(ctx, { text: emoji, x: 0, y: size * 0.04 }, `${Math.round(size * 0.6)}px ${EMOJI}`, T.ink);
    ctx.restore();
  }

  // "It's set" on a green pill.
  const p = L.pill;
  ctx.fillStyle = T.green;
  roundRect(ctx, p.x, p.y, p.w, p.h, p.h / 2);
  ctx.fill();
  text(ctx, { text: p.text, x: p.x + p.w / 2, y: p.y + p.h / 2 + p.h * 0.02 }, p.font, T.greenInk);

  for (const line of L.title.lines) text(ctx, line, L.title.font, T.ink);
  for (const line of L.date.lines) text(ctx, line, L.date.font, T.green);

  // Who can make it: overlapping initials, in each person's colour from the page.
  for (const f of L.faces) {
    circle(ctx, f.x, f.y, f.r + f.r * 0.09);
    ctx.fillStyle = T.bg;
    ctx.fill();
    circle(ctx, f.x, f.y, f.r);
    if (f.more) ctx.fillStyle = T.more;
    else {
      ctx.fillStyle = `hsl(${f.hue} 45% 36%)`; // where oklch() isn't supported
      ctx.fillStyle = `oklch(46% 0.13 ${f.hue})`;
    }
    ctx.fill();
    text(ctx, f, `750 ${Math.round(f.r * (f.text.length > 2 ? 0.62 : 0.72))}px ${SANS}`, f.more ? T.ink : '#ffffff');
  }
  if (L.caption) text(ctx, L.caption, L.caption.font, T.muted);

  // venn.day, with the logo.
  const F = L.footer;
  const m = F.size * 1.25;
  const r = m * 0.29;
  venn(
    ctx,
    [
      [F.x + m * 0.35, F.y - m * 0.14],
      [F.x + m * 0.65, F.y - m * 0.14],
      [F.x + m * 0.5, F.y + m * 0.13],
    ],
    r,
  );
  text(ctx, { text: F.text, x: F.x + m + F.size * 0.4, y: F.y }, F.font, T.muted, 'left');
}

// ---------- in the browser ----------

const DOG = '/img/dog.webp';

/** Finn, or null if his picture can't load (the card still works without him). */
async function loadDog() {
  try {
    const img = new Image();
    img.src = DOG;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** The page's serif, if it can load in a moment; otherwise the card uses the system fallbacks. */
async function loadFonts() {
  if (!document.fonts?.load) return;
  if (document.fonts.check(`400 100px "Instrument Serif"`)) return;
  await Promise.race([
    document.fonts.load(`400 100px "Instrument Serif"`).catch(() => {}),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
}

const seedOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 2147483647, 7);

/**
 * Draw the card and return it as a PNG: { blob, summary }. `summary` says what's on it ({ width, height,
 * faces }), so tests can check it without reading pixels.
 */
export async function makeCard({ title, when, emoji, people, size = 'story', theme }) {
  theme ??= matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const [dog] = await Promise.all([loadDog(), loadFonts()]);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const measure = (t, font) => {
    ctx.font = font;
    return ctx.measureText(t).width;
  };
  const L = layoutCard(measure, { size, title, when, emoji, people });
  canvas.width = L.width;
  canvas.height = L.height;
  drawCard(ctx, L, { theme, dog, seed: seedOf(title) });
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No picture'))), 'image/png'),
  );
  return { blob, summary: { width: L.width, height: L.height, faces: L.faces.length, theme } };
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

let last = null; // the last picture, so a second tap shares it straight away

/**
 * The button's action. On phones that can share files, opens the share sheet with the picture (just
 * the title, no text, so it posts cleanly to a story). Elsewhere it downloads it.
 * `when` is the date as the page shows it. The button gets data-card-size and data-card-faces.
 */
export async function shareCard({ ev, when, button }) {
  if (button.getAttribute('aria-busy') === 'true') return;
  const people = whoCanMakeIt(ev);
  const theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const key = JSON.stringify([ev.title, ev.emoji, when, people, theme]);
  let file = last?.key === key ? last.file : null;
  if (!file) {
    button.setAttribute('aria-busy', 'true');
    try {
      const { blob, summary } = await makeCard({ title: ev.title, when, emoji: ev.emoji, people, theme });
      file = new File([blob], fileName(ev.title), { type: 'image/png' });
      last = { key, file };
      button.dataset.cardSize = `${summary.width}x${summary.height}`;
      button.dataset.cardFaces = String(summary.faces);
    } catch {
      return toast("Couldn't make the picture. Try again.");
    } finally {
      button.removeAttribute('aria-busy');
    }
  }
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: ev.title });
      track('share', { how: 'sheet', from: 'card' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // they closed the share sheet
      // Making the picture took too long for the browser to count it as the tap: it's ready now.
      if (e.name === 'NotAllowedError') return toast('Your picture is ready. Tap again to share it.');
    }
  }
  download(file);
  track('share', { how: 'download', from: 'card' });
  toast('Picture saved. Post it in your group chat or story.');
}
