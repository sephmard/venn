// Brand templates: an organization's own template, with its name, logo, accent colour and font, and
// what its polls start with (a name, a note, a place, an emoji). No accounts: like a poll, it has a
// share link (/new?brand=<id>) for the team and a secret manage link (/brand/<id>#admin=<token>);
// the server keeps only a hash of the token. Polls made from it show its look to their guests.

import { ValidationError } from '../public/core.js';
import { BUTTONS, CORNERS, FONTS, LOGO_SIZES, isHex } from '../public/brand-look.js';
import { isEmoji } from '../public/emoji.js';

export const BRAND_LIMITS = { name: 60, title: 120, note: 1000, where: 200 };
export const BRAND_ID_RE = /^[A-Za-z0-9]{1,32}$/;

function text(v, max, field, required = false) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text`);
  v = v.trim();
  if (required && !v) throw new ValidationError(`${field} is required`);
  if (v.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return v;
}

/** Check what an organization sends for its template. Only what's set is kept. */
export function normalizeBrand(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('Invalid request');
  const brand = { name: text(input.name, BRAND_LIMITS.name, 'Organization name', true) };
  // Colours: the accent, and the page's own background, cards and text (the app keeps them readable).
  for (const key of ['accent', 'bg', 'surface', 'text', 'yes', 'maybe', 'no']) {
    if (input[key] == null || input[key] === '') continue;
    if (!isHex(input[key])) throw new ValidationError('Colours must look like #1a2b3c');
    brand[key] = input[key].toLowerCase();
  }
  // Cards and text only go with a background of its own.
  if (!brand.bg) {
    delete brand.surface;
    delete brand.text;
  }
  for (const [key, list] of [
    ['font', FONTS],
    ['bodyFont', FONTS],
    ['corners', CORNERS],
    ['buttons', BUTTONS],
    ['logoSize', LOGO_SIZES],
  ]) {
    if (input[key] == null || input[key] === '') continue;
    if (typeof input[key] !== 'string' || !Object.hasOwn(list, input[key]))
      throw new ValidationError(/font/i.test(key) ? 'Unknown font' : `Unknown ${key}`);
    brand[key] = input[key];
  }
  if (input.hideName != null && typeof input.hideName !== 'boolean') throw new ValidationError('hideName must be true or false');
  if (input.hideName) brand.hideName = true;
  for (const [key, field] of [
    ['title', 'Poll name'],
    ['note', 'Note'],
    ['where', 'Where'],
  ]) {
    const v = text(input[key], BRAND_LIMITS[key], field);
    if (v) brand[key] = v;
  }
  if (input.emoji != null && input.emoji !== '') {
    if (!isEmoji(input.emoji)) throw new ValidationError('Invalid emoji');
    brand.emoji = input.emoji;
  }
  return brand;
}

/** The public path of a brand's logo, with its version so caches keep it until it changes. */
export const logoPath = (id, v) => `/api/brands/${encodeURIComponent(id)}/logo?v=${v}`;

/** A brand as anyone with its link sees it: its look and defaults, never its hash. */
export const publicBrand = (b) => ({
  id: b.id,
  name: b.name,
  ...Object.fromEntries(
    ['accent', 'bg', 'surface', 'text', 'yes', 'maybe', 'no', 'font', 'bodyFont', 'corners', 'buttons', 'logoSize', 'hideName']
      .filter((k) => b[k])
      .map((k) => [k, b[k]]),
  ),
  ...(b.title && { title: b.title }),
  ...(b.note && { note: b.note }),
  ...(b.where && { where: b.where }),
  ...(b.emoji && { emoji: b.emoji }),
  logo: b.logoV != null ? logoPath(b.id, b.logoV) : null,
});
