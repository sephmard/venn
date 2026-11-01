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
