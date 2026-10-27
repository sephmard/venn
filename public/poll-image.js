// The poll's icon, on the create pages: tap the tile next to the poll's name to type any emoji, or
// to use a picture of your own (the restaurant, your club's logo, the book). Loaded only when the
// tile is tapped, or when editing or copying a poll.
//
// A picture never leaves the browser as the organizer chose it: it's cropped to a square and made
// small here (512 × 512 JPEG), and a 1200 × 630 card for link previews is drawn with the poll's
// name. The server stores both (src/images.js) once the poll exists.

import { $, api, esc, toast } from './ui.js';
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
`;

// The panel's state, for the tile on the page now. A new create page starts afresh.
let S = null;
const live = () => S?.tile?.isConnected && S.tile === $('#emoji-tile');
function state() {
  if (live()) return S;
  const tile = $('#emoji-tile');
  // `base` is the emoji the kind of plan gives (or the calendar); `emoji` one the organizer typed.
  // `had`: the poll being edited has a picture, so taking it away deletes it.
  return (S = { tile, base: tile?.textContent || '🗓️', emoji: '', picture: null, had: false });
}

/** Show the icon on the tile: the picture, else the emoji they typed, else the plan's. */
function show() {
  const s = state();
  if (!s.tile) return;
  if (s.picture) s.tile.innerHTML = `<img src="${esc(s.picture.url)}" alt="">`;
  else s.tile.textContent = s.emoji || s.base;
  const remove = $('#icon-remove');
  if (remove) remove.hidden = !s.picture;
  // A picture or an emoji, never both: with a picture, the emoji field steps aside.
  const row = $('#icon-emoji-row');
  if (row) row.hidden = !!s.picture;
  if ($('#icon-hint'))
    $('#icon-hint').textContent = s.picture
      ? 'Your picture is the icon. Remove it to use an emoji instead.'
      : 'Or use a picture of your own. It shows on the poll and when you share its link.';
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
    <p class="field-err" id="icon-err" role="alert"></p>`;
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
  $('#icon-remove').addEventListener('click', () => {
    s.picture = null;
    show();
    $('#icon-emoji').focus();
  });
  show();
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
    // The picture replaces any emoji typed for it.
    s.emoji = '';
    if ($('#icon-emoji')) $('#icon-emoji').value = '';
    show();
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

/** Draw the link-preview card (a layout from layoutPreview) with the poll's picture. */
export function drawPreview(ctx, L, picture) {
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

/** The 1200 × 630 card for the poll's link previews, as a JPEG. */
async function previewCard(blob, title) {
  const [picture] = await Promise.all([decode(blob), loadFonts()]);
  const [c, ctx] = canvas(CARD.width, CARD.height);
  const measure = (t, font) => {
    ctx.font = font;
    return ctx.measureText(t).width;
  };
  drawPreview(ctx, layoutPreview(measure, title), picture);
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
    const card = await previewCard(s.picture.blob, title).catch(() => null);
    const body = { icon: s.picture.url, ...(card && { card: await dataUrl(card) }) };
    const { image } = await api(`events/${encodeURIComponent(id)}/image`, { method: 'PUT', body, headers });
    s.had = true;
    return image;
  } catch (e) {
    toast(`Your poll is saved, but not its picture: ${e.message}`);
    return null;
  }
}
