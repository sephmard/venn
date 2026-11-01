// What My polls (account.js) works out on its own: the links this browser remembers, a pasted
// organizer link, and what each poll's row says. Kept apart so it can be tested without a page.

/** The organizer and manage links this browser remembers: { polls: [{ id, token }], brands: [...] }. */
export function rememberedLinks(storage = globalThis.localStorage) {
  const out = { polls: [], brands: [] };
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
    }
  } catch {}
  out.polls = out.polls.slice(0, 200);
  out.brands = out.brands.slice(0, 200);
  return out;
}

/** A pasted organizer (or manage) link, as something to claim, or null. */
export function parseOrganizerLink(text) {
  const m = String(text || '')
    .trim()
    .match(/\/(e|brand)\/([A-Za-z0-9]{1,32})\/?#admin=([A-Za-z0-9]+)$/);
  return m && { kind: m[1] === 'e' ? 'polls' : 'brands', id: m[2], token: m[3] };
}

/** What a poll's row says under its name: its picked date, or how many have answered. */
export function pollMeta(p, now = Date.now()) {
  if (p.finalStart != null)
    return `${p.finalStart < now ? 'Was' : 'Picked:'} ${new Date(p.finalStart).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  return p.answers ? `${p.answers} ${p.answers === 1 ? 'answer' : 'answers'}` : 'No answers yet';
}

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
