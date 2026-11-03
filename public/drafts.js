// Work people haven't sent yet, kept on this device so a reload, the Back button or a trip to the
// calendar app doesn't lose it: a half-made poll (per tab, in sessionStorage) and a guest's unsent
// answer (per poll, in localStorage, for two weeks). No DOM here: test/drafts.test.js covers it.

import { IF_NEEDED, YES } from './core.js';

const DAY = 864e5;
const ANSWER_DAYS = 14;
const MAX_KEYS = 3000;

/** Read and parse a stored draft; anything broken (or storage switched off) is no draft. */
export function readStored(storage, key) {
  try {
    const d = JSON.parse(storage?.getItem(key) ?? 'null');
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  } catch {
    return null;
  }
}
export function writeStored(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {}
}
export function dropStored(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {}
}

const strings = (x, max = MAX_KEYS) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string').slice(0, max) : []);
const text = (x, max) => (typeof x === 'string' ? x.slice(0, max) : '');

// ---------- a half-made poll ----------

export const formDraftKey = (kind) => `venn:draft:${kind}`;

/**
 * A create form's draft, made safe to put back: strings only, and no day before `today`
 * (YYYY-MM-DD), since a poll can't offer those. `picks` keys start with their date.
 */
export function cleanFormDraft(d, today) {
  if (!d) return null;
  const future = (list) => strings(list).filter((k) => k.slice(0, 10) >= today);
  const out = {
    title: text(d.title, 120),
    occasion: Number.isInteger(d.occasion) && d.occasion >= 0 ? d.occasion : null,
    location: text(d.location, 200),
    desc: text(d.desc, 1000),
    organizer: text(d.organizer, 80),
    privacy: Array.isArray(d.privacy) ? d.privacy.map((x) => x === true) : [],
  };
  // A date poll: what's picked at each level, which level, and days in a row.
  if (d.picks && typeof d.picks === 'object') {
    out.picks = {};
    out.maybe = {};
    for (const lv of ['days', 'parts', 'hours']) {
      out.picks[lv] = future(d.picks[lv]);
      out.maybe[lv] = future(d.maybe?.[lv]);
    }
    out.level = ['days', 'parts', 'hours'].includes(d.level) ? d.level : 'days';
    out.timeLevel = ['parts', 'hours'].includes(d.timeLevel) ? d.timeLevel : null;
    out.span = Number.isInteger(d.span) && d.span > 1 ? d.span : 1;
  }
  // A vote: the options typed so far, and the kind of question.
  if (Array.isArray(d.options)) {
    out.options = strings(d.options, 50).map((s) => s.slice(0, 120));
    out.kind = d.kind === 'yesno' ? 'yesno' : 'options';
    out.single = d.single === true;
    // The starter pressed (topic-templates.js), by its name in links.
    out.starter = typeof d.starter === 'string' && /^[a-z]+(-[a-z]+)*$/.test(d.starter) ? d.starter.slice(0, 40) : '';
  }
  return out;
}

/** Whether a form draft has anything worth putting back (more than the name Venn remembers anyway). */
export function formDraftHasWork(d) {
  if (!d) return false;
  const picked = d.picks && Object.values(d.picks).some((l) => l.length);
  const typed = d.options?.some((s) => s.trim());
  return !!(d.title.trim() || d.location.trim() || d.desc.trim() || picked || typed);
}

// ---------- a guest's answer not sent yet ----------

export const answerDraftKey = (id) => `venn:answer-draft:${id}`; // (event.js and topic-poll.js spell it out)

/**
 * A guest's unsent answer, kept only for the poll's current times and only for two weeks:
 * { mine: { slot: YES | IF_NEEDED }, touched: [slot], declined, name }, or null.
 */
export function cleanAnswerDraft(d, slots, now = Date.now()) {
  if (!d || !(now - d.at >= 0 && now - d.at < ANSWER_DAYS * DAY)) return null;
  const valid = new Set(slots.map(String));
  const mine = {};
  if (d.mine && typeof d.mine === 'object')
    for (const [k, v] of Object.entries(d.mine)) if (valid.has(k) && (v === YES || v === IF_NEEDED)) mine[k] = v;
  const touched = strings(d.touched).filter((k) => valid.has(k));
  const declined = d.declined === true;
  if (!Object.keys(mine).length && !touched.length && !declined) return null;
  return { mine, touched, declined, name: text(d.name, 80) };
}
