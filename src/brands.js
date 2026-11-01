// Brand templates: an organization's own template, with its name, logo, accent colour and font, and
// what its polls start with (a name, a note, a place, an emoji). No accounts: like a poll, it has a
// share link (/new?brand=<id>) for the team and a secret manage link (/brand/<id>#admin=<token>);
// the server keeps only a hash of the token. Polls made from it show its look to their guests.

import { ValidationError } from '../public/core.js';
import { FONTS, isHex } from '../public/brand-look.js';
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
  if (input.accent != null && input.accent !== '') {
    if (!isHex(input.accent)) throw new ValidationError('The colour must look like #1a2b3c');
    brand.accent = input.accent.toLowerCase();
  }
  if (input.font != null && input.font !== '') {
    if (!Object.hasOwn(FONTS, input.font)) throw new ValidationError('Unknown font');
    brand.font = input.font;
  }
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
  ...(b.accent && { accent: b.accent }),
  ...(b.font && { font: b.font }),
  ...(b.title && { title: b.title }),
  ...(b.note && { note: b.note }),
  ...(b.where && { where: b.where }),
  ...(b.emoji && { emoji: b.emoji }),
  logo: b.logoV != null ? logoPath(b.id, b.logoV) : null,
});
