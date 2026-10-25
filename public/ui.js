// Small helpers shared by the create pages and the poll page.

import { allDaySpan, pad } from './core.js';

export const app = document.getElementById('app');
export const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- local storage (per poll, and the visitor's name) ----------

export function saved(id) {
  try {
    return JSON.parse(localStorage.getItem(`venn:${id}`)) || {};
  } catch {
    return {};
  }
}
export function save(id, patch) {
  try {
    localStorage.setItem(`venn:${id}`, JSON.stringify({ ...saved(id), ...patch }));
  } catch {}
}
export function forget(id, ...keys) {
  const s = saved(id);
  for (const k of keys) delete s[k];
  try {
    localStorage.setItem(`venn:${id}`, JSON.stringify(s));
  } catch {}
}
export function lastName() {
  try {
    return localStorage.getItem('venn:name') || '';
  } catch {
    return '';
  }
}
export function rememberName(n) {
  try {
    localStorage.setItem('venn:name', n);
  } catch {}
}

/** The organizer's email for notifications, so the next poll fills it in. */
export function lastEmail() {
  try {
    return localStorage.getItem('venn:email') || '';
  } catch {
    return '';
  }
}
export function rememberEmail(e) {
  try {
    localStorage.setItem('venn:email', e);
  } catch {}
}

// ---------- feedback ----------

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

export async function copy(text, done = 'Link copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    prompt('Copy this:', text);
  }
}

// ---------- API ----------

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Optional features the server has switched on (email, calendars, AI). Fetched once.
let configPromise;
export const getConfig = () => (configPromise ??= api('config').catch(() => ({})));

// ---------- dates and times ----------

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A YYYY-MM-DD date as a UTC Date, for formatting with timeZone: 'UTC'. */
export function dateParts(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const fmt = (opts) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts });
export const fmtDow = fmt({ weekday: 'short' });
export const fmtDowLong = fmt({ weekday: 'long' });
export const fmtMonthDay = fmt({ month: 'short', day: 'numeric' });
export const fmtDay = fmt({ weekday: 'short', month: 'short', day: 'numeric' });
const fmtMinutes = fmt({ hour: 'numeric', minute: '2-digit' });
export const minutesLabel = (m) => fmtMinutes.format(new Date(Date.UTC(2000, 0, 1, 0, m)));
const at = (m) => new Date(Date.UTC(2000, 0, 1, 0, m));
const fmtHour = fmt({ hour: 'numeric' });
/** "7 PM", or "7:30 PM" when there are minutes. */
export const shortTime = (m) => (m % 60 ? minutesLabel(m % 1440) : fmtHour.format(at(m % 1440)));
/** "6 – 10 PM", "9 AM – 12 PM", "7:30 – 9:30 PM". */
export function shortRange(from, to) {
  if (to >= 1440) return `${shortTime(from)} – midnight`;
  return (from % 60 || to % 60 ? fmtMinutes : fmtHour).formatRange(at(from), at(to));
}
export const dayLabel = (d) => fmtDay.format(dateParts(d));

export function lengthLabel(min) {
  if (min % 1440 === 0) return `${min / 1440} day${min > 1440 ? 's' : ''}`;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60),
    m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hour${h > 1 ? 's' : ''}`;
}

/** "Sat, Nov 7, 7:00 – 9:00 PM", "Sat, Nov 7, all day" or "Fri, Nov 6 – Sun, Nov 8". */
export function fmtWhen(start, end, tz) {
  const span = allDaySpan(start, end, tz);
  if (span) {
    const last = dateParts(span.endDate);
    last.setUTCDate(last.getUTCDate() - 1);
    const first = dateParts(span.startDate);
    return +last === +first ? `${fmtDay.format(first)}, all day` : fmtDay.formatRange(first, last);
  }
  const f = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  });
  return f.formatRange(start, end);
}

/** Just the time part: "7:00 – 9:00 PM", or "All day". */
export function fmtTimeRange(start, end, tz) {
  const span = allDaySpan(start, end, tz);
  if (span) return span.endDate === nextDate(span.startDate) ? 'All day' : fmtWhen(start, end, tz);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz }).formatRange(start, end);
}
const nextDate = (d) => {
  const t = dateParts(d);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

/** "Eastern Time" rather than "America/New_York". */
export function tzName(tz) {
  try {
    const p = new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'longGeneric' })
      .formatToParts(new Date())
      .find((x) => x.type === 'timeZoneName');
    if (p) return p.value;
  } catch {}
  return tz.replace(/_/g, ' ');
}

export function tzOptions(selected) {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {}
  for (const z of [selected, localTz, 'UTC']) if (z && !zones.includes(z)) zones.unshift(z);
  return zones
    .map((z) => `<option value="${esc(z)}"${z === selected ? ' selected' : ''}>${esc(z.replace(/_/g, ' '))}</option>`)
    .join('');
}

export function ago(ms) {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const mins = Math.round((ms - Date.now()) / 60_000);
  if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
  const hours = Math.round(mins / 60);
  return Math.abs(hours) < 24 ? rtf.format(hours, 'hour') : rtf.format(Math.round(hours / 24), 'day');
}

// ---------- people ----------

const initials = (name) =>
  String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => [...w][0] || '')
    .join('')
    .toUpperCase() || '?';

/** A hue from the name, so each person keeps the same colour everywhere. */
function hue(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

/** A round avatar with the person's initials. Decorative: the name is always shown or labelled nearby. */
export const avatar = (name, cls = '') =>
  `<span class="av ${cls}" style="--h:${hue(name)}" aria-hidden="true">${esc(initials(name))}</span>`;

/** Overlapping avatars, like circles in a Venn diagram. */
export function avatarStack(names, max = 5) {
  if (!names.length) return '';
  const shown = names.slice(0, max).map((n) => avatar(n));
  if (names.length > max) shown.push(`<span class="av av-more" aria-hidden="true">+${names.length - max}</span>`);
  return `<span class="stack-av">${shown.join('')}</span>`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
