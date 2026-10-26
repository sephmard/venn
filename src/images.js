// A poll's own picture: a square icon (shown where the poll's emoji would be) and a 1200 × 630 card
// for link previews. The organizer's browser makes both (public/poll-image.js); the server only
// checks they're really pictures of a sensible size, stores them, and serves them back.

import { ValidationError } from '../public/core.js';
import { SECURITY_HEADERS } from './security-headers.js';

/** The most each picture may weigh, in bytes. The browser aims well under these. */
export const IMAGE_LIMITS = { icon: 200_000, card: 300_000 };

/** The JSON body of an upload: both pictures in base64, plus a little room. */
export const MAX_IMAGE_BODY = Math.ceil(((IMAGE_LIMITS.icon + IMAGE_LIMITS.card) * 4) / 3) + 1000;

/** The public paths, and which picture each serves. */
export const IMAGE_FILES = { 'icon.jpg': 'icon', 'card.jpg': 'card' };

const startsWith = (bytes, sig, at = 0) => sig.every((b, i) => bytes[at + i] === b);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

/** What kind of picture the bytes are, from their first bytes: JPEG, PNG or WebP. Anything else is null. */
export function imageType(bytes) {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Check one uploaded picture: base64, or a data: URL. Returns { data (base64), type }. Refuses
 * anything that isn't a JPEG, PNG or WebP by its bytes (whatever it says it is), and anything too big.
 */
export function parseImage(value, which) {
  const name = which === 'icon' ? 'The picture' : 'The preview picture';
  if (typeof value !== 'string' || !value) throw new ValidationError(`${name} is missing`);
  const data = value.replace(/^data:image\/[a-z+.-]+;base64,/i, '');
  // Checked before decoding, so a huge upload isn't decoded just to be refused.
  if (data.length > Math.ceil((IMAGE_LIMITS[which] * 4) / 3) + 4)
    throw new ValidationError(`${name} is too big (at most ${IMAGE_LIMITS[which] / 1000} KB)`);
  if (data.length % 4 || !BASE64.test(data)) throw new ValidationError(`${name} isn't a picture`);
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  if (bytes.length > IMAGE_LIMITS[which])
    throw new ValidationError(`${name} is too big (at most ${IMAGE_LIMITS[which] / 1000} KB)`);
  const type = imageType(bytes);
  if (!type) throw new ValidationError(`${name} must be a JPEG, PNG or WebP`);
  return { data, type };
}

/** The public path of a poll's picture, with its version so caches keep it until it changes. */
export const imagePath = (id, image, which = 'icon') => `/api/events/${encodeURIComponent(id)}/${which}.jpg?v=${image.v}`;

/**
 * Serve a stored picture ({ data, type, v }). With the current version in the URL it never changes,
 * so it's cached for a year; without it, it's checked each time. It can only ever be shown as a
 * picture: no sniffing, and a sandbox with nothing allowed if it's ever opened as a page.
 */
export function imageResponse(img, { versioned = false, head = false } = {}) {
  const bytes = Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0));
  return new Response(head ? null : bytes, {
    headers: {
      ...SECURITY_HEADERS,
      'content-type': img.type,
      'content-length': String(bytes.length),
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
      'cache-control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
    },
  });
}
