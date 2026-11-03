// Signed in, what this browser holds joins the account on its own, so nobody has to paste a link:
// polls made or answered here (before signing in, too), and polls and templates opened here by
// their private links. Each one is sent once; My polls asks again for everything (account.js).
// Loaded only when someone's signed in (account-menu.js, event.js, brand.js).

import { addedText, rememberedLinks, unkept } from './account-data.js';
import { api, toast } from './ui.js';
import { accountHint } from './account-menu.js';

const KEPT = 'venn:kept';

function keptHere() {
  try {
    const list = JSON.parse(localStorage.getItem(KEPT));
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

let queue = Promise.resolve();

/**
 * Keep this browser's links with the account, when someone's signed in here. `all` sends every one
 * again (My polls), not only the new ones. Says what was added, unless `quiet`. One at a time, so a
 * link saved a moment ago (the page that opened it) is never missed. Returns { polls, brands,
 * answers } added, or null.
 */
export function keepThisBrowser({ all = false, quiet = false } = {}) {
  return (queue = queue.then(async () => {
    if (!accountHint()) return null;
    const kept = keptHere();
    const { links, keys } = unkept(rememberedLinks(), all ? new Set() : kept);
    if (!keys.length) return null;
    try {
      // keepalive: leaving the page right away (answer, then off) doesn't cut it off. Browsers allow
      // that only for small bodies (64 KB in all), which a long list of links can pass.
      const keepalive = JSON.stringify(links).length < 32_000;
      const { added } = await api('me/claim', { method: 'POST', body: links, keepalive });
      // Sent, so not again: the ones added, and the ones that are someone else's or gone.
      try {
        localStorage.setItem(KEPT, JSON.stringify([...new Set([...kept, ...keys])].slice(-600)));
      } catch {}
      const n = added.polls + added.brands + (added.answers || 0);
      if (n && !quiet) toast(addedText(added));
      if (n) dispatchEvent(new CustomEvent('venn:kept', { detail: added })); // My polls shows them
      return added;
    } catch {
      return null;
    }
  }));
}
