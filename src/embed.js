// White label and embedding: a brand template can list the websites allowed to show its polls in a
// frame (/embed/<poll>), and can hide Venn's own name and logo on its polls. Everywhere else only
// Venn frames Venn (src/security-headers.js); an embed page opens the frame to its template's sites.

import { ValidationError } from '../public/core.js';
import { SECURITY_HEADERS } from './security-headers.js';

export const MAX_EMBED_SITES = 10;
export const EMBED_PATH = /^\/embed\/([A-Za-z0-9]{1,40})\/?$/;

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** One website, as its origin: https only (plain http just for localhost, to try it out). */
export function normalizeSite(input) {
  if (typeof input !== 'string') throw new ValidationError('Websites must be addresses like https://example.com');
  let v = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  let url;
  try {
    url = new URL(v);
  } catch {
    throw new ValidationError(`"${input.trim().slice(0, 80)}" isn't a website address`);
  }
  const ok = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL.test(url.hostname));
  // Only the site itself: a frame is allowed by origin, so a page, a search or a login would mislead.
  if (!ok || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.hostname.includes('*'))
    throw new ValidationError(`Use just the website's address, like https://example.com, for "${input.trim().slice(0, 80)}"`);
  return url.origin;
}

/** A template's list of websites: unique origins, at most MAX_EMBED_SITES. */
export function normalizeSites(list) {
  if (list == null || list === '') return [];
  if (!Array.isArray(list)) throw new ValidationError('embedSites must be a list of website addresses');
  const sites = [...new Set(list.filter((s) => typeof s !== 'string' || s.trim()).map(normalizeSite))];
  if (sites.length > MAX_EMBED_SITES) throw new ValidationError(`At most ${MAX_EMBED_SITES} websites`);
  return sites;
}

/** The headers for a page those sites may frame. With none, the page is Venn's alone, as any other. */
export function frameHeaders(sites) {
  if (!sites?.length) return { ...SECURITY_HEADERS };
  const { 'x-frame-options': _, ...rest } = SECURITY_HEADERS; // frame-ancestors says it, and says more
  return {
    ...rest,
    'content-security-policy': rest['content-security-policy'].replace(
      "frame-ancestors 'self'",
      `frame-ancestors 'self' ${sites.join(' ')}`,
    ),
  };
}
