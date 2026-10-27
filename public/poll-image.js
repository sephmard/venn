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
import { fitText, loadFonts, venn, roundRect } from './share-card.js';

export const ICON_SIZE = 512;
export const CARD = { width: 1200, height: 630 };
// What the browser aims for; the server refuses anything over 200 KB and 300 KB.
const ICON_BYTES = 120_000;
const CARD_BYTES = 250_000;

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF = '"Instrument Serif", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

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
.icon-preview{display:block;width:100%;height:auto;margin-top:12px;border:1px solid var(--border);border-radius:12px}
`;

// The panel's state, for the tile on the page now. A new create page starts afresh.
let S = null;
const live = () => S?.tile?.isConnected && S.tile === $('#emoji-tile');
function state() {
  if (live()) return S;
  const tile = $('#emoji-tile');
  // `base` is the emoji the kind of plan gives (or the calendar); `emoji` one the organizer typed.
  // `had`: the poll being edited has a picture, so taking it away deletes it.
  // `sticker`: the key of the Finn sticker on the link preview, or '' for none.
  return (S = { tile, base: tile?.textContent || '🗓️', emoji: '', picture: null, had: false, sticker: '' });
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
  const remove = $('#icon-remove');
  if (remove) remove.hidden = !icon.picture;
  const row = $('#icon-emoji-row');
  if (row) row.hidden = !!icon.picture;
  if (icon.picture && $('#icon-emoji')) $('#icon-emoji').value = '';
  if ($('#icon-hint')) $('#icon-hint').textContent = icon.hint;
  if ($('#icon-finn')) $('#icon-finn').hidden = !s.picture;
  preview();
}

// The stickers that suit a poll still asking ("It's set!" is for once the date is picked).
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

/** Draw the link preview in the panel, as people will see it when the link is shared. */
let drawing = 0;
async function preview() {
  const img = $('#icon-preview');
  const s = state();
  if (!img || !s.picture) return;
  const n = ++drawing;
  const title = $('#title')?.value.trim() || $('#title')?.placeholder || '';
  const card = await previewCard(s.picture.blob, title, s.sticker).catch(() => null);
  if (!card || n !== drawing || !img.isConnected) return;
  if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(card);
}

/** The emoji they typed, or '' for the plan's own. */
export const emoji = () => (live() ? S.emoji : '');
/** The picture as a data: URL, for the celebration, or null. */
export const picture = () => (live() && S.picture?.url) || null;

/** A kind of plan was picked (or unpicked): its emoji replaces one typed before. A picture stays. */
export function setOccasion(o) {
  const s = state();
  s.base = o?.emoji || '🗓️';
  s.emoji = '';
  if ($('#icon-emoji')) $('#icon-emoji').value = '';
  show();
}

// ---------- the panel ----------

/** Open the panel under the poll's name, or close it if it's open. */
export function toggle() {
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
 * Pure, so it's tested without a browser.
 */
export function layoutPreview(measure, title) {
  const { width: W, height: H } = CARD;
  const pad = 80;
  const tile = { size: 440, x: W - pad - 440, y: (H - 440) / 2 };
  const maxWidth = tile.x - pad - 48;
  const t = fitText(measure, title || 'Plans', {
    font: (px) => `400 ${px}px ${SERIF}`,
    max: 96,
    min: 52,
    maxWidth,
    maxLines: 3,
  });
  const lh = t.size * 1.04;
  const line = { text: 'Find the day that works for everyone.', font: `500 26px ${SANS}`, h: 26 * 1.4 };
  const brand = { x: pad, y: 104, size: 44, font: `700 32px ${SANS}` };
  const top = brand.y + 40;
  const textH = t.lines.length * lh + 24 + line.h;
  const y0 = top + Math.max(0, (H - pad - top - textH) / 2);
  return {
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
 * `sticker` the organizer chose (a picture from finn-stickers.js) on its corner.
 */
export function drawPreview(ctx, L, picture, sticker = null) {
  const { width: W, height: H, tile } = L;
  ctx.fillStyle = '#faf8f4';
  ctx.fillRect(0, 0, W, H);
  const cx = tile.x + tile.size / 2;
  const cy = tile.y + tile.size / 2;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 520);
  glow.addColorStop(0, '#c3f2de');
  glow.addColorStop(1, '#faf8f4');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // The picture on a white tile, tilted a touch, like a photo stuck on.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(0.035);
  ctx.shadowColor = 'rgba(22, 24, 26, 0.18)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = '#ffffff';
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

  // Venn's mark and name.
  const { x, y, size: m, font } = L.brand;
  venn(
    ctx,
    [
      [x + m * 0.35, y - m * 0.14],
      [x + m * 0.65, y - m * 0.14],
      [x + m * 0.5, y + m * 0.13],
    ],
    m * 0.29,
  );
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#16181a';
  ctx.font = font;
  ctx.fillText('Venn', x + m + 10, y);

  ctx.font = L.title.font;
  for (const l of L.title.lines) ctx.fillText(l.text, l.x, l.y);
  ctx.fillStyle = '#55585c';
  ctx.font = L.line.font;
  ctx.fillText(L.line.text, L.line.x, L.line.y);
}

/** A Finn sticker by its key, ready to draw, or null. */
export async function stickerPicture(key) {
  const sticker = key && PREVIEW_STICKERS.find((x) => x.key === key);
  if (!sticker) return null;
  const { makeSticker } = await import('./finn-stickers.js');
  return decode(await makeSticker(sticker));
}

/** The 1200 × 630 card for the poll's link previews, as a JPEG. */
async function previewCard(blob, title, stickerKey = '') {
  const [picture, sticker] = await Promise.all([decode(blob), stickerPicture(stickerKey).catch(() => null), loadFonts()]);
  const [c, ctx] = canvas(CARD.width, CARD.height);
  const measure = (t, font) => {
    ctx.font = font;
    return ctx.measureText(t).width;
  };
  drawPreview(ctx, layoutPreview(measure, title), picture, sticker);
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
  if (ev.image)
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(src.id)}/icon.jpg?v=${ev.image.v}`);
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      s.picture = { blob, url: await dataUrl(blob) };
      s.had = !!src.edit;
      s.sticker = saved(src.id).sticker || ''; // remembered on this device, when it made the poll
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
    const card = await previewCard(s.picture.blob, title, s.sticker).catch(() => null);
    const body = { icon: s.picture.url, ...(card && { card: await dataUrl(card) }) };
    const { image } = await api(`events/${encodeURIComponent(id)}/image`, { method: 'PUT', body, headers });
    s.had = true;
    save(id, { sticker: s.sticker });
    return image;
  } catch (e) {
    toast(`Your poll is saved, but not its picture: ${e.message}`);
    return null;
  }
}
