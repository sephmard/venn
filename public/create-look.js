// A new poll's look. It's the page's: retro like the website, unless this browser chose Classic
// mode (the footer's switch, here as on the website). Signed in, a "Look" row at the top picks
// one of Venn's two built-in looks, Retro or Classic, or one of the account's brand templates
// (its own or shared with it). Loaded once the page is drawn.

import { accountHint } from './account-menu.js';
import { retroLook } from './retro-look.js';
import { $, api, esc } from './ui.js';

const isRetro = () => document.documentElement.classList.contains('retro');

/** The footer's switch and the Look row. `preview()` redraws the link preview in the new look. */
export function createLook({ pick, current, preview }) {
  const sw = document.querySelector('.footer .classic-switch');
  const show = () => sw && (sw.hidden = !!current()); // a brand template's look replaces Venn's
  if (sw) {
    show();
    sw.setAttribute('aria-checked', String(!isRetro()));
    sw.onclick = () => {
      const on = !isRetro();
      try {
        if (on) localStorage.removeItem('venn:retro');
        else localStorage.setItem('venn:retro', '0');
      } catch {}
      retroLook(on);
      sw.setAttribute('aria-checked', String(!on));
      mark(current());
      preview();
    };
  }
  return lookRow({
    pick: async (id) => {
      // Retro and Classic are this poll's look only; the footer's switch is the website's.
      if (id === 'retro' || id === 'classic') {
        await pick(null);
        retroLook(id === 'retro');
        sw?.setAttribute('aria-checked', String(id === 'classic'));
        preview();
      } else await pick(id);
      show();
    },
    current,
  });
}

/** Tick the choice in the Look row: a template (its id), or Retro or Classic. */
function mark(chosen) {
  const want = chosen || (isRetro() ? 'retro' : 'classic');
  for (const x of document.querySelectorAll('#look-row [data-look]'))
    x.setAttribute('aria-checked', String(x.dataset.look === want));
}

/**
 * Draw the row once the account is known: Retro, Classic, then its templates. `pick(id)` uses
 * that one; `current()` is the template in use, from a ?brand= link.
 */
async function lookRow({ pick, current }) {
  if (!accountHint()) return; // nobody signed in on this browser: no request
  const me = await api('me').catch(() => null);
  const form = $('#create');
  if (!me?.user || !form || $('#look-row')) return;
  const brands = (me.brands || []).filter((b) => b.name);
  const option = (id, label) =>
    `<button type="button" class="pill" role="radio" data-look="${esc(id)}" aria-checked="false">${esc(label)}</button>`;
  form
    .querySelector('.create-lede')
    .insertAdjacentHTML(
      'afterend',
      `<div class="look-row" id="look-row"><span class="look-label" id="look-h">Look</span><div class="pills" role="radiogroup" aria-labelledby="look-h">${option('retro', 'Retro')}${option('classic', 'Classic')}${brands.map((b) => option(b.id, b.name)).join('')}</div></div>`,
    );
  mark(current());
  $('#look-row').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-look]');
    if (!b || b.getAttribute('aria-checked') === 'true') return;
    for (const x of $('#look-row').querySelectorAll('[data-look]')) x.setAttribute('aria-checked', String(x === b));
    await pick(b.dataset.look);
  });
}
