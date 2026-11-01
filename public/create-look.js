// A new poll's look. It's the page's: retro like the website, unless this browser chose Classic
// mode (the footer's switch, here as on the website). Signed in with brand templates of their own,
// a "Look" row at the top picks Venn's look or one of the templates. Loaded once the page is drawn.

import { accountHint } from './account-menu.js';
import { retroLook } from './retro-look.js';
import { $, api, esc } from './ui.js';

/** The footer's switch and the Look row. `preview()` redraws the link preview in the new look. */
export function createLook({ pick, current, preview }) {
  const sw = document.querySelector('.footer .classic-switch');
  const show = () => sw && (sw.hidden = !!current()); // a brand template's look replaces Venn's
  if (sw) {
    show();
    sw.setAttribute('aria-checked', String(!document.documentElement.classList.contains('retro')));
    sw.onclick = () => {
      const on = !document.documentElement.classList.contains('retro');
      try {
        if (on) localStorage.removeItem('venn:retro');
        else localStorage.setItem('venn:retro', '0');
      } catch {}
      retroLook(on);
      sw.setAttribute('aria-checked', String(!on));
      preview();
    };
  }
  return lookRow({ pick: async (id) => (await pick(id), show()), current });
}

/**
 * Draw the row once the account's templates are known. `pick(id or null)` uses that template (or
 * Venn's look); `current()` is the template in use, from a ?brand= link.
 */
async function lookRow({ pick, current }) {
  if (!accountHint()) return; // nobody signed in on this browser: no request
  const me = await api('me').catch(() => null);
  const brands = me?.user ? (me.brands || []).filter((b) => b.name) : [];
  const form = $('#create');
  if (!brands.length || !form || $('#look-row')) return;
  const chosen = current();
  const option = (id, label) =>
    `<button type="button" class="pill" role="radio" data-look="${esc(id)}" aria-checked="${String((chosen || '') === id)}">${esc(label)}</button>`;
  form
    .querySelector('.create-lede')
    .insertAdjacentHTML(
      'afterend',
      `<div class="look-row" id="look-row"><span class="look-label" id="look-h">Look</span><div class="pills" role="radiogroup" aria-labelledby="look-h">${option('', 'Venn')}${brands.map((b) => option(b.id, b.name)).join('')}</div></div>`,
    );
  $('#look-row').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-look]');
    if (!b || b.getAttribute('aria-checked') === 'true') return;
    for (const x of $('#look-row').querySelectorAll('[data-look]')) x.setAttribute('aria-checked', String(x === b));
    await pick(b.dataset.look || null);
  });
}
