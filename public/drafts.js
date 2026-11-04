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
    // A note typed with an unsent answer (answer-note.js) stays with it when the page saves the rest.
    const note = key.startsWith('venn:answer-draft:') && readStored(storage, key)?.note;
    storage?.setItem(key, JSON.stringify(typeof note === 'string' && !('note' in value) ? { ...value, note } : value));
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
    // The template it was started in (a default, default-template.js), or null for Venn's look.
    brand: typeof d.brand === 'string' && /^[A-Za-z0-9]{1,32}$/.test(d.brand) ? d.brand : null,
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
  if (d.fromAi === true) out.fromAi = true; // AI on "Create a Venn" read it as a vote (ai-draft.js)
  return out;
}

/** Whether a form draft has anything worth putting back (more than the name Venn remembers anyway). */
export function formDraftHasWork(d) {
  if (!d) return false;
  const picked = d.picks && Object.values(d.picks).some((l) => l.length);
  const typed = d.options?.some((s) => s.trim());
  return !!(d.title.trim() || d.location.trim() || d.desc.trim() || picked || typed);
}

/**
 * Which template a new poll's form starts in, first match wins (sprint D, G2):
 * 1. its link: `?brand=<id>`, or `?brand=none` for none this once (the default stays);
 * 2. a draft being picked up (`draft`, with work in it): whatever it started in, even none;
 * 3. the signed-in account's default for this kind of poll (`defaults[format]`, from the server);
 * 4. none: Venn's look. Editing or copying a poll (?edit, ?copy) keeps that poll's own, elsewhere.
 * Returns { id, from: 'link' | 'draft' | 'default', name? } or null. A draft in the template
 * that's still the default counts as the default (the form says so).
 */
export function startingTemplate({ link = null, draft = null, defaults = null, format }) {
  if (link === 'none') return null;
  if (link) return { id: link, from: 'link' };
  const d = defaults?.[format];
  if (draft && !draft.brand) return null;
  if (draft && draft.brand !== d?.id) return { id: draft.brand, from: 'draft' };
  return d?.id ? { id: d.id, name: d.name, from: 'default' } : null;
}

// What a template's defaults are called (My polls, the template's page; default-template.js).
const WHICH = { date: 'date polls', vote: 'votes' };
/** Which formats template `id` is the default for: [], ['date'], ['vote'] or ['date', 'vote']. */
export const defaultFor = (defs, id) => ['date', 'vote'].filter((f) => defs?.[f]?.id === id);
/** "Default", "Default for votes", or '' (a template row's meta line in My polls). */
export function defaultPill(defs, id) {
  const on = defaultFor(defs, id);
  return on.length === 2 ? 'Default' : on.length ? `Default for ${WHICH[on[0]]}` : '';
}
/** What a toast says once `formats` changed: "New date polls and votes start with Acme." (plain text) */
export function savedText(defs, formats) {
  const name = (f) => defs?.[f]?.name || 'no template';
  if (formats.every((f) => name(f) === name(formats[0])))
    return `New ${formats.map((f) => WHICH[f]).join(' and ')} start with ${name(formats[0])}.`;
  return formats.map((f) => `New ${WHICH[f]} start with ${name(f)}.`).join(' ');
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
