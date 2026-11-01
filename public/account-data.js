// What My polls (account.js) works out on its own: the links this browser remembers, a pasted
// organizer link, and what each poll's row says. Kept apart so it can be tested without a page.

/**
 * The organizer, manage and edit links this browser remembers:
 * { polls: [{ id, token }], brands: [{ id, token }], answers: [{ id, pid, token }] }.
 */
export function rememberedLinks(storage = globalThis.localStorage) {
  const out = { polls: [], brands: [], answers: [] };
  try {
    for (let i = 0; i < storage.length; i++) {
      const m = storage.key(i).match(/^venn:(brand:)?([A-Za-z0-9]{1,32})$/);
      if (!m) continue;
      let v;
      try {
        v = JSON.parse(storage.getItem(storage.key(i)));
      } catch {
        continue;
      }
      if (typeof v?.adminToken === 'string' && v.adminToken)
        (m[1] ? out.brands : out.polls).push({ id: m[2], token: v.adminToken });
      if (!m[1] && typeof v?.editToken === 'string' && v.editToken && typeof v.participantId === 'string')
        out.answers.push({ id: m[2], pid: v.participantId, token: v.editToken });
    }
  } catch {}
  out.polls = out.polls.slice(0, 200);
  out.brands = out.brands.slice(0, 200);
  out.answers = out.answers.slice(0, 200);
  return out;
}

/**
 * The remembered links not sent to the account yet (`kept`: keys sent before), and their keys:
 * "poll:<id>", "brand:<id>", "answer:<id>.<pid>".
 */
export function unkept(links, kept) {
  const keys = [];
  const pick = (list, key) =>
    list.filter((x) => {
      const k = key(x);
      if (kept.has(k)) return false;
      keys.push(k);
      return true;
    });
  return {
    links: {
      polls: pick(links.polls, (x) => `poll:${x.id}`),
      brands: pick(links.brands, (x) => `brand:${x.id}`),
      answers: pick(links.answers, (x) => `answer:${x.id}.${x.pid}`),
    },
    keys,
  };
}

/** What was just added to the account, as a toast: "Added to My polls", "Added 2 polls to My polls"… */
export function addedText({ polls = 0, brands = 0, answers = 0 }) {
  const p = polls + answers;
  if (!brands) return p === 1 ? 'Added to My polls' : `Added ${p} polls to My polls`;
  if (!p) return brands === 1 ? 'Added to your templates' : `Added ${brands} templates to your templates`;
  return `Added ${p} ${p === 1 ? 'poll' : 'polls'} and ${brands} ${brands === 1 ? 'template' : 'templates'} to My polls`;
}

/**
 * A pasted Venn link, as what it is: something to keep with the account ({ kind: 'polls' | 'brands' |
 * 'answers', item }: an organizer, manage or change-your-answer link), a template's invite
 * ({ kind: 'invite', path }), a link for guests ({ kind: 'guest', brand }), or null.
 */
export function parseVennLink(text) {
  const m = String(text || '')
    .trim()
    .match(/(?:^|\/)(e|brand)\/([A-Za-z0-9]{1,32})\/?(?:#(.*))?$/);
  if (!m) {
    const share = String(text || '').match(/\/new\/?(?:\w+)?\?(?:.*&)?brand=([A-Za-z0-9]{1,32})/);
    return share ? { kind: 'guest', brand: true } : null;
  }
  const [, where, id, hash = ''] = m;
  const h = new URLSearchParams(hash);
  const token = h.get('admin');
  if (token && /^[A-Za-z0-9]+$/.test(token)) return { kind: where === 'e' ? 'polls' : 'brands', item: { id, token } };
  if (where === 'brand' && /^[A-Za-z0-9]{1,64}$/.test(h.get('join') || ''))
    return { kind: 'invite', path: `/brand/${id}#join=${h.get('join')}` };
  const [pid, edit] = (where === 'e' && h.get('edit')?.split('.')) || [];
  if (pid && edit) return { kind: 'answers', item: { id, pid, token: edit } };
  return { kind: 'guest', brand: where === 'brand' };
}

/** What a poll's row says under its name: its picked date, or how many have answered. */
export function pollMeta(p, now = Date.now()) {
  if (p.decided) return `Decided: ${p.decided}`;
  if (p.finalStart != null)
    return `${p.finalStart < now ? 'Was' : 'Picked:'} ${new Date(p.finalStart).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  return p.answers ? `${p.answers} ${p.answers === 1 ? 'answer' : 'answers'}` : 'No answers yet';
}

const short = (t, now) =>
  new Date(t).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(new Date(t).getFullYear() !== new Date(now).getFullYear() && { year: 'numeric' }),
  });

/** When a row's poll was made (or answered), short: "Today", "Oct 30", "Oct 30, 2025". */
export function whenShort(t, now = Date.now()) {
  if (t == null) return '';
  return new Date(t).toDateString() === new Date(now).toDateString() ? 'Today' : short(t, now);
}

/** Whether a My polls row is a topic poll (deciding what or where), not a date poll. */
export const isVote = (p) => p.mode === 'topic';

/**
 * Everything a made poll's row says under its name, so polls with the same name can be told apart:
 * what kind it is (a vote, when it isn't finding a date), the pick (or that it's waiting), how many
 * answered, and where.
 */
export function madeMeta(p, now = Date.now()) {
  const n = p.answers ? `${p.answers} ${p.answers === 1 ? 'answer' : 'answers'}` : 'No answers yet';
  return [isVote(p) && 'Vote', p.finalStart != null || p.decided ? pollMeta(p, now) : null, n, p.location]
    .filter(Boolean)
    .join(' · ');
}

/** A nudge for the group, ready to paste or share: "Still need your answer for …". */
export const nudgeText = (p, url) => `Still need your answer for “${p.title}”: ${url}`;

/** What an answered poll's row says: the picked date and whether they're in, or that it's waiting. */
export function answeredMeta(p, now = Date.now()) {
  const first =
    p.finalStart == null && !p.decided
      ? `Waiting on ${isVote(p) ? 'a pick' : 'a date'} · ${p.answers} ${p.answers === 1 ? 'answer' : 'answers'}`
      : pollMeta(p, now);
  return [isVote(p) && 'Vote', first, p.organizer, p.location].filter(Boolean).join(' · ');
}

/** Whether they can make the picked date (or went with the pick), as the key says it: [class, words], or null. */
export const canMake = (p) =>
  p.can == null
    ? null
    : (isVote(p)
        ? [
            ['v-no', 'Not your pick'],
            ['v-maybe', 'If needed'],
            ['v-yes', 'Your pick'],
          ]
        : [
            ['v-no', 'Can’t make it'],
            ['v-maybe', 'If needed'],
            ['v-yes', 'You’re in'],
          ])[p.can] || null;

// My polls' sorts and groupings, by key, with their labels. `when` is the time that matters for a
// row: when the poll was made, or when they answered it.
export const SORTS = { new: 'Newest', old: 'Oldest', date: 'Date picked', name: 'Name' };
/** What each sort says in full, in the sort sheet. */
export const SORT_HINTS = { new: 'Newest first', old: 'Oldest first', date: 'Soonest picked date first', name: 'A to Z' };
export const GROUPS = { status: 'Status', month: 'Month', none: 'None' };
/** Which polls to show: all of them, only the ones finding a date, or only the votes. */
export const KINDS = { all: 'All', date: 'Dates', topic: 'Votes' };
/** Whether a list has both kinds of poll, so showing one kind is worth offering. */
export const mixedKinds = (items) => items.some(isVote) && items.some((p) => !isVote(p));
const STATUS = [
  ['soon', 'Coming up'],
  ['open', 'Waiting on a date'],
  ['pick', 'Waiting on a pick'],
  ['past', 'Past'],
];
const when = (p) => p.answeredAt ?? p.createdAt ?? 0;
// A decided topic poll is done: with the past ones.
const statusOf = (p, now) =>
  p.decided ? 'past' : isVote(p) ? 'pick' : p.finalStart == null ? 'open' : p.finalStart >= now ? 'soon' : 'past';

/**
 * The rows to show, filtered by `q` (its name, or who made it) and `kind` (KINDS), sorted and
 * grouped: [{ key, label, items }]. With group 'none', one group with no label.
 */
export function arrange(items, { q = '', sort = 'new', group = 'status', kind = 'all' } = {}, now = Date.now()) {
  const words = q.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const hay = (p) => `${p.title || p.name || ''} ${p.organizer || ''}`.toLocaleLowerCase();
  const list = items.filter(
    (p) => words.every((w) => hay(p).includes(w)) && (kind === 'all' || (kind === 'topic') === isVote(p)),
  );
  const name = (p) => p.title || p.name || '';
  const by = {
    new: (a, b) => when(b) - when(a),
    old: (a, b) => when(a) - when(b),
    name: (a, b) => name(a).localeCompare(name(b), undefined, { sensitivity: 'base', numeric: true }),
    // Picked dates first, the nearest coming one first, then past ones, latest first; then the rest, newest.
    date: (a, b) => {
      const rank = (p) => ({ soon: 0, past: 1, open: 2, pick: 2 })[statusOf(p, now)];
      const d = rank(a) - rank(b);
      if (d) return d;
      if (rank(a) === 0) return a.finalStart - b.finalStart;
      if (rank(a) === 1) return (b.finalStart ?? when(b)) - (a.finalStart ?? when(a));
      return when(b) - when(a);
    },
  };
  list.sort(by[sort] || by.new);
  if (group === 'none' || !list.length) return list.length ? [{ key: 'all', label: '', items: list }] : [];
  if (group === 'month') {
    const out = new Map();
    for (const p of list) {
      const d = new Date(when(p));
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!out.has(key))
        out.set(key, { key, label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), items: [] });
      out.get(key).items.push(p);
    }
    return [...out.values()];
  }
  return STATUS.map(([key, label]) => ({ key, label, items: list.filter((p) => statusOf(p, now) === key) })).filter(
    (g) => g.items.length,
  );
}

/** The line under the sign-in buttons: what signing in agrees to. */
export const signInAgree = () =>
  '<p class="acct-agree">By continuing, you agree to Venn’s <a href="/terms">Terms</a> and <a href="/privacy">Privacy policy</a>.</p>';

// Each provider's own mark, as their sign-in guidelines ask.
const MARKS = {
  google:
    '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.6 5.9c4.4-4.1 6.7-10.1 6.7-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>',
  microsoft:
    '<svg viewBox="0 0 21 21" width="20" height="20" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z"/><path fill="#7fba00" d="M11 1h9v9h-9z"/><path fill="#00a4ef" d="M1 11h9v9H1z"/><path fill="#ffb900" d="M11 11h9v9h-9z"/></svg>',
  github:
    '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 0a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.4 7.4 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.7-3.6 3.9.3.3.5.8.5 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 0z"/></svg>',
};
const LABELS = { google: 'Google', microsoft: 'Microsoft', github: 'GitHub' };

/** "Continue with Google" (and the others set up), each coming back to `next` once signed in. */
export const signInButtons = (providers, next) =>
  providers
    .filter((p) => Object.hasOwn(LABELS, p))
    .map(
      (p) =>
        `<a class="btn btn-signin" href="/api/auth/${p}?next=${encodeURIComponent(next)}">${MARKS[p]}Continue with ${LABELS[p]}</a>`,
    )
    .join('');
