// The poll's icon, on the create pages: tap the tile next to the poll's name to type any emoji, or
// to use a picture of your own (the restaurant, your club's logo, the book). Loaded only when the
// tile is tapped, or when editing or copying a poll.
//
// A picture never leaves the browser as the organizer chose it: it's cropped to a square and made
// small here (512 × 512 JPEG), and a 1200 × 630 card for link previews is drawn with the poll's
// name. The server stores both (src/images.js) once the poll exists.

import { $, api, esc, save, saved, toast } from './ui.js';
import { STICKERS } from './finn-moments.js';
import { firstEmoji } from './emoji.js';
import { TILE_STYLES, isTileStyle } from './tile-styles.js';
import { fitText, loadFonts, venn, roundRect } from './share-card.js';

export const ICON_SIZE = 512;
export const CARD = { width: 1200, height: 630 };
// What the browser aims for; the server refuses anything over 200 KB and 300 KB.
const ICON_BYTES = 120_000;
const CARD_BYTES = 250_000;

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF = '"Instrument Serif", "Iowan Old Style", "Palatino Linotype", Georgia, serif';
const ORBITRON = `Orbitron, ${SANS}`;
// The page is in the retro look (retro-look.js): the poll's, or the create page's.
const retro = () => !!globalThis.document?.documentElement?.classList.contains('retro');

const CSS = `
.icon-panel{margin-top:12px;padding:16px;border:1.5px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)}
.icon-panel h3{margin:0 0 4px;font-size:1rem}
.icon-panel input[type=text]{font-size:16px}
.icon-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.icon-btns .btn{white-space:normal}
.icon-finn{margin-top:16px}
.icon-finn h4{margin:0 0 8px;font-size:.95rem}
.icon-stickers{display:flex;flex-wrap:wrap;gap:8px}
.icon-stickers .pill{min-height:44px}
.icon-bgs{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.icon-bg{width:44px;height:44px;border-radius:12px;border:1.5px solid var(--border);padding:0;cursor:pointer;background:var(--accent-soft)}
.icon-bg[aria-pressed=true]{outline:3px solid var(--accent);outline-offset:2px}
.icon-bg:focus-visible{outline:3px solid var(--text);outline-offset:2px}
.icon-bg-row{margin-top:12px}
.icon-bg-row h4{margin:0;font-size:.95rem}
.icon-preview{display:block;width:100%;height:auto;margin-top:12px;border:1px solid var(--border);border-radius:12px}
`;

// A white-label template's form (create.js): its polls' cards show its logo and name, not Venn's,
// and no Finn. Asked of the page's own create.js, already loaded, when a card is drawn.
let page = null;
const org = () => page?.whiteLabelBrand?.() || null;
async function loadOrg() {
  page ??= await import('./create.js').catch(() => ({}));
  return org();
}

// The panel's state, for the tile on the page now. A new create page starts afresh.
let S = null;
const live = () => S?.tile?.isConnected && S.tile === $('#emoji-tile');
function state() {
  if (live()) return S;
  const tile = $('#emoji-tile');
  // `base` is the emoji the kind of plan gives (or the calendar); `emoji` one the organizer typed.
  // `had`: the poll being edited has a picture, so taking it away deletes it.
  // `sticker`: the key of the Finn sticker on the link preview, or '' for none. Finn is there unless
  // they take him off. `bg`: the tile's style (tile-styles.js), or '' for the plain one.
  return (S = {
    tile,
    base: tile?.textContent || '🗓️',
    emoji: '',
    picture: null,
    had: false,
    sticker: DEFAULT_STICKER,
    bg: tile?.dataset?.tile || '',
  });
}

/**
 * What the poll's icon is: a picture or an emoji, never both. A picture is the icon, and replaces
 * any emoji typed for it; without one, the emoji they typed, else the kind of plan's (`base`).
 */
export function iconOf({ picture = null, emoji = '', base = '🗓️' } = {}) {
  return picture
    ? { picture, emoji: '', text: '', hint: 'Your picture is the icon. Remove it to use an emoji instead.' }
    : {
        picture: null,
        emoji,
        text: emoji || base,
        hint: 'Or use a picture of your own. It shows on the poll and when you share its link.',
      };
}

/** Show the icon on the tile, and in the panel the emoji field only when there's no picture. */
function show() {
  const s = state();
  if (!s.tile) return;
  const icon = iconOf(s);
  s.emoji = icon.emoji;
  if (icon.picture) s.tile.innerHTML = `<img src="${esc(icon.picture.url)}" alt="">`;
  else s.tile.textContent = icon.text;
  if (s.bg) s.tile.dataset.tile = s.bg;
  else delete s.tile.dataset.tile;
  for (const b of document.querySelectorAll('[data-bg]')) b.setAttribute('aria-pressed', String(b.dataset.bg === s.bg));
  const bgs = $('#icon-bg-row');
  if (bgs) bgs.hidden = !!icon.picture || bgs.dataset.off === '1';
  const remove = $('#icon-remove');
  if (remove) remove.hidden = !icon.picture;
  const row = $('#icon-emoji-row');
  if (row) row.hidden = !!icon.picture;
  if (icon.picture && $('#icon-emoji')) $('#icon-emoji').value = '';
  if ($('#icon-hint')) $('#icon-hint').textContent = icon.hint;
  if ($('#icon-finn')) $('#icon-finn').hidden = !s.picture;
  noFinn(org());
  preview();
}

// The stickers that suit a poll still asking ("It's set!" is for once the date is picked).
/** Finn's sticker on a new picture's link preview, until the organizer picks another or none. */
export const DEFAULT_STICKER = 'cant-wait';
export const PREVIEW_STICKERS = STICKERS.filter((x) => x.key !== 'its-set');

/** The sticker choices, as buttons: "No Finn", then each sticker, with `selected` pressed. */
export function stickerButtons(selected = '') {
  return [{ key: '', caption: 'No Finn' }, ...PREVIEW_STICKERS]
    .map(
      (x) =>
        `<button type="button" class="pill" data-sticker="${x.key}" aria-pressed="${x.key === selected}">${esc(x.caption)}</button>`,
    )
    .join('');
}

/** A white-label template's preview has no Finn, so the panel doesn't offer him: just the preview. */
function noFinn(o) {
  for (const el of [$('#icon-finn-h'), $('#icon-finn .icon-stickers')]) if (el) el.hidden = !!o;
}

/** Draw the link preview in the panel, as people will see it when the link is shared. */
let drawing = 0;
export async function preview() {
  const img = $('#icon-preview');
  const s = state();
  if (!img || !s.picture) return;
  const n = ++drawing;
  const title = $('#title')?.value.trim() || $('#title')?.placeholder || '';
  const o = await loadOrg();
  noFinn(o);
  const card = await previewCard(s.picture.blob, title, s.sticker, retro(), o).catch(() => null);
  if (!card || n !== drawing || !img.isConnected) return;
  if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(card);
}

/** The emoji they typed, or '' for the plan's own. */
export const emoji = () => (live() ? S.emoji : '');
/** The tile's style ('' for the plain one). */
export const bg = () => (live() ? S.bg : '');

/** Set the tile's style, as AI does (ai-draft.js): a known key, or '' for the plain one. */
export function setBg(key) {
  const s = state();
  s.bg = isTileStyle(key) ? key : '';
  show();
}

/** The picture as a data: URL, for the celebration, or null. */
export const picture = () => (live() && S.picture?.url) || null;

/** Use this emoji (AI's pick, or '' for the plan's own). False when a picture is the icon. */
export function setEmoji(e) {
  const s = state();
  if (s.picture) return false;
  s.emoji = e || '';
  if ($('#icon-emoji')) $('#icon-emoji').value = s.emoji;
  show();
  return true;
}

/** The kind of plan's emoji (a vote starter's), keeping any the organizer typed. */
export function setBase(e) {
  state().base = e;
  show();
}

/** A kind of plan was picked (or unpicked): its emoji replaces one typed before. A picture stays. */
export function setOccasion(o) {
  const s = state();
  s.base = o?.emoji || '🗓️';
  s.emoji = '';
  if ($('#icon-emoji')) $('#icon-emoji').value = '';
  show();
}

// ---------- the panel ----------

/**
 * Open the panel under the poll's name, or close it if it's open. `styles: false` leaves out the
 * tile's backgrounds (a brand template's poll has its organization's look instead).
 */
export function toggle({ styles = true } = {}) {
  const s = state();
  if ($('#icon-panel')) return close();
  if (!document.getElementById('icon-css'))
    document.head.append(Object.assign(document.createElement('style'), { id: 'icon-css', textContent: CSS }));
  const panel = document.createElement('div');
  panel.className = 'icon-panel';
  panel.id = 'icon-panel';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-labelledby', 'icon-h');
  panel.innerHTML = `
    <h3 id="icon-h">Your poll's icon</h3>
    <div id="icon-emoji-row"${s.picture ? ' hidden' : ''}>
      <label for="icon-emoji">Any emoji</label>
      <input id="icon-emoji" type="text" autocomplete="off" spellcheck="false" enterkeyhint="done" placeholder="Type or paste one, like 🎂" aria-describedby="icon-hint" value="${esc(s.emoji)}">
    </div>
    <div class="icon-bg-row" id="icon-bg-row" data-off="${styles ? '' : '1'}"${s.picture || !styles ? ' hidden' : ''}>
      <h4 id="icon-bg-h">Background</h4>
      <div class="icon-bgs" role="group" aria-labelledby="icon-bg-h">
        ${[{ key: '', name: 'Plain' }, ...TILE_STYLES]
          .map(
            (t) =>
              `<button type="button" class="icon-bg" data-bg="${t.key}"${t.key ? ` data-tile="${t.key}"` : ''} aria-label="${t.name}" aria-pressed="${t.key === s.bg}"></button>`,
          )
          .join('')}
      </div>
    </div>
    <p class="hint" id="icon-hint"></p>
    <div class="icon-btns">
      <button type="button" class="btn" id="icon-upload">Upload a picture</button>
      <button type="button" class="btn btn-ghost" id="icon-remove"${s.picture ? '' : ' hidden'}>Remove picture</button>
      <input type="file" id="icon-file" accept="image/*" hidden>
    </div>
    <p class="field-err" id="icon-err" role="alert"></p>
    <div class="icon-finn" id="icon-finn"${s.picture ? '' : ' hidden'}>
      <h4 id="icon-finn-h">Finn on your link preview</h4>
      <div class="icon-stickers" role="group" aria-labelledby="icon-finn-h">
        ${stickerButtons(s.sticker)}
      </div>
      <img class="icon-preview" id="icon-preview" width="1200" height="630" alt="How your poll's link looks when it's shared">
    </div>`;
  s.tile.closest('.title-row').after(panel);
  s.tile.setAttribute('aria-expanded', 'true');
  const input = $('#icon-emoji');
  input.addEventListener('input', () => {
    const typed = input.value.trim();
    const e = firstEmoji(typed);
    say(typed && !e ? "That isn't an emoji. Try one from your keyboard's emoji keys." : '');
    s.emoji = e;
    show();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault(); // not the form's submit
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close(true);
  });
  $('#icon-upload').addEventListener('click', () => $('#icon-file').click());
  $('#icon-file').addEventListener('change', (e) => usePicture(e.target.files?.[0]));
  panel.querySelector('.icon-bgs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bg]');
    if (b) setBg(b.dataset.bg);
  });
  panel.querySelector('.icon-stickers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sticker]');
    if (!b) return;
    s.sticker = b.dataset.sticker;
    for (const x of panel.querySelectorAll('[data-sticker]')) x.setAttribute('aria-pressed', String(x === b));
    preview();
  });
  // The preview follows the poll's name as it's typed.
  let typing;
  $('#title')?.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(preview, 400);
  });
  $('#icon-remove').addEventListener('click', () => {
    s.picture = null;
    show();
    $('#icon-emoji').focus();
  });
  show();
  preview();
  (s.picture ? $('#icon-upload') : input).focus();
}

function close(refocus = false) {
  $('#icon-panel')?.remove();
  S?.tile?.setAttribute('aria-expanded', 'false');
  if (refocus) S?.tile?.focus();
}

const say = (message) => {
  if ($('#icon-err')) $('#icon-err').textContent = message;
};

/** A file they chose: made into the square icon, and shown on the tile. */
async function usePicture(file) {
  if (!file) return;
  say('');
  if (file.type && !file.type.startsWith('image/')) return say("That file isn't a picture.");
  const upload = $('#icon-upload');
  upload.setAttribute('aria-busy', 'true');
  try {
    const blob = await squareIcon(await decode(file));
    const s = state();
    s.picture = { blob, url: await dataUrl(blob) };
    show(); // the picture replaces any emoji typed for it
  } catch {
    say("Couldn't open that picture. Try a JPEG or PNG.");
  } finally {
    upload.removeAttribute('aria-busy');
    $('#icon-file').value = '';
  }
}

// ---------- pictures ----------

const dataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** A picture from a file or blob, ready to draw. */
async function decode(blob) {
  if (self.createImageBitmap)
    try {
      return await createImageBitmap(blob);
    } catch {}
  const img = new Image();
  img.src = await dataUrl(blob);
  await img.decode();
  return img;
}

function canvas(width, height) {
  const c = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

/** The canvas as a JPEG, as good as fits in `bytes`. */
async function jpeg(c, bytes) {
  let blob;
  for (const q of [0.85, 0.75, 0.62, 0.5]) {
    blob = await new Promise((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('No picture'))), 'image/jpeg', q),
    );
    if (blob.size <= bytes) break;
  }
  return blob;
}

const sizeOf = (img) => [img.naturalWidth || img.width, img.naturalHeight || img.height];

/** The middle square of the picture at 512 × 512, on white (a JPEG has no see-through parts). */
export async function squareIcon(img) {
  const [w, h] = sizeOf(img);
  if (!w || !h) throw new Error('Empty picture');
  const side = Math.min(w, h);
  const [c, ctx] = canvas(ICON_SIZE, ICON_SIZE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, ICON_SIZE, ICON_SIZE);
  return jpeg(c, ICON_BYTES);
}

/**
 * Where everything goes on the link-preview card: the picture big on the right, on a white tile, and
 * Venn's mark, the poll's name and a line about Venn on the left, like Venn's own (public/og.png).
 * `retro`: in the retro look (public/og-retro.png), the name in chrome capitals. `org`: a white-label
 * template's { name, hideName, logo } (logo: a picture, or null), whose logo and name take Venn's
 * place, in the plain look. Pure, so it's tested without a browser.
 */
export function layoutPreview(measure, title, retro = false, org = null) {
  if (org) retro = false;
  const { width: W, height: H } = CARD;
  const pad = 80;
  const tile = { size: 440, x: W - pad - 440, y: (H - 440) / 2 };
  const maxWidth = tile.x - pad - 48;
  const t = fitText(measure, retro ? (title || 'Plans').toUpperCase() : title || 'Plans', {
    font: (px) => (retro ? `900 ${px}px ${ORBITRON}` : `400 ${px}px ${SERIF}`),
    max: retro ? 64 : 96,
    min: retro ? 36 : 52,
    maxWidth,
    maxLines: 3,
  });
  const lh = t.size * 1.04;
  const line = { text: 'Find the day that works for everyone.', font: `500 26px ${SANS}`, h: 26 * 1.4 };
  const brand = { x: pad, y: 104, size: 44, font: retro ? `900 30px ${ORBITRON}` : `700 32px ${SANS}` };
  if (org) {
    // The logo as tall as fits (64px), up to four times as wide, then the name unless the logo says it.
    const [w, h] = org.logo ? sizeOf(org.logo) : [0, 0];
    const lh = w && h ? Math.min(64, (64 * 4 * h) / w) : 0;
    const logo = lh ? { x: pad, y: brand.y - lh / 2, w: (lh * w) / h, h: lh } : null;
    const named = !(org.hideName && logo);
    const nameX = logo ? pad + logo.w + 16 : pad;
    const name = named ? String(org.name || '').trim() : '';
    brand.org = { logo, name: name && { text: name, x: nameX, maxWidth: maxWidth - (nameX - pad) } };
  }
  const top = brand.y + 40;
  const textH = t.lines.length * lh + 24 + line.h;
  const y0 = top + Math.max(0, (H - pad - top - textH) / 2);
  return {
    retro,
    width: W,
    height: H,
    tile,
    brand,
    title: { font: t.font, lines: t.lines.map((text, i) => ({ text, x: pad, y: y0 + (i + 0.5) * lh })) },
    line: { ...line, x: pad, y: y0 + t.lines.length * lh + 24 + line.h / 2 },
  };
}

/**
 * Draw the link-preview card (a layout from layoutPreview) with the poll's picture, and the Finn
 * `sticker` the organizer chose (a picture from finn-stickers.js) on its corner. `logo`: a
 * white-label template's logo, as a picture, when the layout has one.
 */
export function drawPreview(ctx, L, picture, sticker = null, logo = null) {
  if (L.brand.org) sticker = null; // Finn is Venn's
  const { width: W, height: H, tile } = L;
  const T = L.retro ? RETRO : PLAIN;
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, W, H);
  const cx = tile.x + tile.size / 2;
  const cy = tile.y + tile.size / 2;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 520);
  glow.addColorStop(0, T.glow);
  glow.addColorStop(1, T.bg);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  if (L.retro) horizon(ctx, W, H);

  // The picture on a white tile, tilted a touch, like a photo stuck on.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(0.035);
  ctx.shadowColor = T.shadow;
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = L.retro ? 0 : 14;
  ctx.fillStyle = T.tile;
  const s = tile.size;
  roundRect(ctx, -s / 2, -s / 2, s, s, 44);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  roundRect(ctx, -s / 2 + 14, -s / 2 + 14, s - 28, s - 28, 32);
  ctx.clip();
  if (picture) ctx.drawImage(picture, -s / 2 + 14, -s / 2 + 14, s - 28, s - 28);
  ctx.restore();
  // Finn, stuck on the picture's bottom corner, a little tilted.
  if (sticker) {
    ctx.save();
    ctx.translate(tile.x + tile.size - 30, tile.y + tile.size - 70);
    ctx.rotate(0.08);
    ctx.drawImage(sticker, -130, -130, 260, 260);
    ctx.restore();
  }

  // Venn's mark and name, or a white-label template's logo and name.
  const { x, y, size: m, font, org } = L.brand;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = T.ink;
  ctx.font = font;
  if (org) {
    if (org.logo) ctx.drawImage(logo, org.logo.x, org.logo.y, org.logo.w, org.logo.h);
    if (org.name) ctx.fillText(org.name.text, org.name.x, y, org.name.maxWidth);
  } else {
    const centers = [
      [x + m * 0.35, y - m * 0.14],
      [x + m * 0.65, y - m * 0.14],
      [x + m * 0.5, y + m * 0.13],
    ];
    if (L.retro) rings(ctx, centers, m * 0.29);
    else venn(ctx, centers, m * 0.29);
    ctx.fillText(L.retro ? 'VENN' : 'Venn', x + m + 10, y);
  }

  ctx.font = L.title.font;
  if (L.retro) {
    ctx.shadowColor = 'rgba(255, 60, 172, 0.6)';
    ctx.shadowBlur = 18;
  }
  for (const l of L.title.lines) ctx.fillText(l.text, l.x, l.y);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = T.muted;
  ctx.font = L.line.font;
  ctx.fillText(L.line.text, L.line.x, L.line.y);
}

// The card's colours: the app's paper, or the retro look's night (retro-app.css).
const PLAIN = {
  bg: '#faf8f4',
  glow: '#c3f2de',
  tile: '#ffffff',
  shadow: 'rgba(22, 24, 26, 0.18)',
  ink: '#16181a',
  muted: '#55585c',
};
const RETRO = {
  bg: '#0d0221',
  glow: '#3a0f5c',
  tile: '#150a35',
  shadow: 'rgba(45, 226, 230, 0.75)',
  ink: '#f5f0ff',
  muted: '#c9bfec',
};

/** The retro look's neon grid, running to the horizon along the bottom. */
function horizon(ctx, W, H) {
  const top = H - 120;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 60, 172, 0.7)';
  for (let i = 0, y = top; y < H; i++, y = top + 6 * i * i + 6 * i) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(45, 226, 230, 0.6)';
  for (let x = -W; x <= 2 * W; x += 80) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + (x - W / 2) * 0.25, top);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.restore();
}

/** The retro logo (public/logo-retro.svg): the three circles as neon rings. */
function rings(ctx, centers, r) {
  ctx.save();
  ctx.lineWidth = r * 0.22;
  ctx.shadowBlur = r * 0.6;
  centers.forEach(([cx, cy], i) => {
    ctx.strokeStyle = ctx.shadowColor = ['#2de2e6', '#ff3cac', '#ffd319'][i];
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();
}

/** A Finn sticker by its key, ready to draw, or null. `retro`: in the retro look's colours. */
export async function stickerPicture(key, retro = false) {
  const sticker = key && PREVIEW_STICKERS.find((x) => x.key === key);
  if (!sticker) return null;
  const { makeSticker } = await import('./finn-stickers.js');
  return decode(await makeSticker(sticker, { retro }));
}

/** Orbitron, from retro-app.css, if it can load in a moment. */
async function loadRetroFont() {
  await Promise.race([document.fonts?.load('900 64px Orbitron').catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
}

/** A white-label template's logo (its public path), ready to draw, or null. */
async function logoPicture(path) {
  if (!path) return null;
  const res = await fetch(path);
  if (!res.ok) throw new Error(res.statusText);
  return decode(await res.blob());
}

/**
 * The 1200 × 630 card for the poll's link previews, as a JPEG. `brand`: a white-label template
 * (create.js), whose logo and name go where Venn's would.
 */
async function previewCard(blob, title, stickerKey = '', retro = false, brand = null) {
  if (brand) [retro, stickerKey] = [false, ''];
  const [picture, sticker, logo] = await Promise.all([
    decode(blob),
    stickerPicture(stickerKey, retro).catch(() => null),
    brand ? logoPicture(brand.logo).catch(() => null) : null,
    retro ? loadRetroFont() : loadFonts(),
  ]);
  const [c, ctx] = canvas(CARD.width, CARD.height);
  const measure = (t, font) => {
    ctx.font = font;
    return ctx.measureText(t).width;
  };
  const org = brand && { name: brand.name, hideName: brand.hideName, logo };
  drawPreview(ctx, layoutPreview(measure, title, retro, org), picture, sticker, logo);
  return jpeg(c, CARD_BYTES);
}

// ---------- saving ----------

/**
 * Start from a poll being edited or copied (edit-poll.js): its own emoji, when it isn't a kind of
 * plan's, and its picture. A copy gets the same picture, with a card for its own name.
 */
export async function restore(ev, src, custom) {
  const s = state();
  if (custom && ev.emoji) s.emoji = ev.emoji;
  s.bg = isTileStyle(ev.tile) && !ev.brand ? ev.tile : '';
  if (ev.image)
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(src.id)}/icon.jpg?v=${ev.image.v}`);
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      s.picture = { blob, url: await dataUrl(blob) };
      s.had = !!src.edit;
      s.sticker = saved(src.id).sticker ?? DEFAULT_STICKER; // remembered on this device, when it made the poll
    } catch {} // the poll keeps its picture; it just isn't shown here
  show();
}

/**
 * Save the picture to poll `id`, with the organizer's token, once the poll is saved: the icon, and a
 * card drawn with the poll's `title`. When it was taken away from a poll that had one, delete it.
 * A picture that can't be saved never undoes the poll: it says so and carries on.
 */
export async function upload(id, adminToken, title) {
  if (!live()) return null;
  const s = S;
  const headers = { 'x-admin-token': adminToken };
  try {
    if (!s.picture) {
      if (s.had) await api(`events/${encodeURIComponent(id)}/image`, { method: 'DELETE', headers });
      s.had = false;
      return null;
    }
    const o = await loadOrg();
    const card = await previewCard(s.picture.blob, title, s.sticker, retro(), o).catch(() => null);
    const body = { icon: s.picture.url, ...(card && { card: await dataUrl(card), ...(o && { cardBrand: o.id }) }) };
    const { image } = await api(`events/${encodeURIComponent(id)}/image`, { method: 'PUT', body, headers });
    s.had = true;
    save(id, { sticker: s.sticker });
    return image;
  } catch (e) {
    toast(`Your poll is saved, but not its picture: ${e.message}`);
    return null;
  }
}
