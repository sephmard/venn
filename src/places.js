// Place search for the "Where" field: GET /api/places?q=… suggests real places and addresses as
// people type. The browser only ever talks to Venn; this asks the place search provider, so
// people's IP addresses never reach it, and answers can be cached and rate limited.
//
//   PLACES_PROVIDER=photon   Photon (photon.komoot.io): OpenStreetMap data, free, no key.
//                            PHOTON_URL points at your own Photon instead.
//   GOOGLE_PLACES_API_KEY    Google Places API (New) Autocomplete. A secret. PLACES_PROVIDER=google,
//                            or leave PLACES_PROVIDER unset.
//
// Neither set: the feature is off, /api/config says `places: false`, and "Where" is a plain field.
// What people type is never logged.

import { ValidationError } from '../public/core.js';

export const MAX_PLACES = 5;
const TIMEOUT_MS = 2500;
const CACHE_MS = 10 * 60_000;
const CACHE_ENTRIES = 500;
const PHOTON_LANGS = new Set(['en', 'de', 'fr']);

/** Which provider this server uses: 'photon', 'google' or null (off). An explicit PLACES_PROVIDER wins. */
export function placesProvider(env) {
  const p = (env.PLACES_PROVIDER || '').trim().toLowerCase();
  if (p === 'photon') return 'photon';
  if (p === 'google' || !p) return env.GOOGLE_PLACES_API_KEY ? 'google' : null;
  return null;
}

/** Per-server state: the rate limit's windows and Photon's answers. The Worker shares one per isolate. */
export const placesState = () => ({ windows: new Map(), cache: new Map() });

/** At most PLACES_RATE_LIMIT (default 60) searches a minute per IP, or Cloudflare's rate limiting binding. */
export async function allowPlacesRequest(env, ip, now, windows) {
  if (env.PLACES_RATE_LIMITER) return (await env.PLACES_RATE_LIMITER.limit({ key: ip || 'unknown' })).success;
  const limit = Number(env.PLACES_RATE_LIMIT) || 60;
  const key = ip || 'unknown';
  const recent = (windows.get(key) || []).filter((t) => now - t < 60_000);
  if (recent.length >= limit) return false;
  recent.push(now);
  windows.set(key, recent);
  if (windows.size > 10_000) windows.clear();
  return true;
}

/** The search's parameters from the URL, checked. */
export function placesQuery(params) {
  const q = (params.get('q') || '').trim().replace(/\s+/g, ' ');
  if (q.length < 2 || q.length > 100) throw new ValidationError('Search for 2 to 100 characters');
  const lang = (params.get('lang') || '').toLowerCase().slice(0, 2);
  let near = null;
  const n = params.get('near');
  if (n) {
    const [lat, lon] = n.split(',').map(Number);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new ValidationError('near must be lat,lon');
    // Rounded to about 10 km: plenty for a bias, and better for privacy and caching.
    near = { lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10 };
  }
  const session = params.get('session') || '';
  if (session && !/^[\w-]{1,36}$/.test(session)) throw new ValidationError('Bad session token');
  return { q, lang: /^[a-z]{2}$/.test(lang) ? lang : '', near, session };
}

const join = (parts) => {
  const seen = new Set();
  return parts.filter((p) => p && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
};

// Countries that write the house number before the street ("374 Metropolitan Avenue").
const NUMBER_FIRST = new Set(['US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'FR', 'IN', 'ZA', 'PH', 'SG', 'MY', 'IL']);

/** One Photon (GeoJSON) feature as { name, detail, label }: "Name, street housenumber, city". */
export function photonPlace({ properties: p = {} } = {}) {
  const street =
    p.street && p.housenumber
      ? NUMBER_FIRST.has(p.countrycode)
        ? `${p.housenumber} ${p.street}`
        : `${p.street} ${p.housenumber}`
      : p.street;
  // Without a street (a town, a park), the country tells one Springfield from another.
  const parts = join([p.name, street, p.city || p.locality || p.district || p.county, !street && p.country]);
  return place(parts[0], parts.slice(1).join(', '));
}

/** One Google Autocomplete suggestion as { name, detail, label }. */
export function googlePlace({ placePrediction: p } = {}) {
  if (!p) return null;
  const f = p.structuredFormat;
  return f?.mainText?.text ? place(f.mainText.text, f.secondaryText?.text || '') : place(p.text?.text || '', '');
}

function place(name, detail) {
  name = String(name || '').trim();
  detail = String(detail || '').trim();
  if (!name) return null;
  return { name, detail, label: (detail ? `${name}, ${detail}` : name).slice(0, 200) };
}

/** The places, without empty or repeated ones, at most MAX_PLACES. */
function tidy(list) {
  const seen = new Set();
  return list.filter((p) => p && !seen.has(p.label.toLowerCase()) && seen.add(p.label.toLowerCase())).slice(0, MAX_PLACES);
}

async function searchPhoton({ q, lang, near }, { env, fetchImpl, origin }) {
  const url = new URL('/api/', env.PHOTON_URL || 'https://photon.komoot.io');
  url.searchParams.set('q', q);
  // A few extra, since some come back the same once they're written short.
  url.searchParams.set('limit', String(MAX_PLACES + 3));
  if (PHOTON_LANGS.has(lang)) url.searchParams.set('lang', lang);
  if (near) {
    url.searchParams.set('lat', String(near.lat));
    url.searchParams.set('lon', String(near.lon));
  }
  // Photon's fair use: say who's asking, so its operators can get in touch.
  const res = await fetchImpl(url, {
    headers: { accept: 'application/json', 'user-agent': `Venn place search (+${origin})` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Photon answered ${res.status}`);
  const data = await res.json();
  return tidy((data.features || []).map(photonPlace));
}

async function searchGoogle({ q, lang, near, session }, { env, fetchImpl }) {
  const body = { input: q };
  if (lang) body.languageCode = lang;
  if (session) body.sessionToken = session;
  if (near) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lon }, radius: 50_000 } };
  const res = await fetchImpl('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.GOOGLE_PLACES_API_KEY,
      'x-goog-fieldmask': 'suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google Places answered ${res.status}`);
  const data = await res.json();
  return tidy((data.suggestions || []).map(googlePlace));
}

/**
 * Suggestions for what someone typed → { places: [{ name, detail, label }] }. Photon's answers are
 * cached for a while, in memory and in the browser. Google's aren't: its terms don't allow it.
 */
export async function searchPlaces(
  env,
  params,
  { fetchImpl = fetch, now = Date.now(), origin = '', state = placesState() } = {},
) {
  const provider = placesProvider(env);
  const query = placesQuery(params);
  if (provider === 'google') {
    return { places: await searchGoogle(query, { env, fetchImpl }), cacheControl: 'no-store' };
  }
  const key = [query.lang, query.near ? `${query.near.lat},${query.near.lon}` : '', query.q.toLowerCase()].join('|');
  const hit = state.cache.get(key);
  const cacheControl = `public, max-age=${CACHE_MS / 1000}`;
  if (hit && now - hit.at < CACHE_MS) return { places: hit.places, cacheControl };
  const places = await searchPhoton(query, { env, fetchImpl, origin });
  state.cache.delete(key);
  state.cache.set(key, { at: now, places });
  // The oldest go first.
  while (state.cache.size > CACHE_ENTRIES) state.cache.delete(state.cache.keys().next().value);
  return { places, cacheControl };
}
