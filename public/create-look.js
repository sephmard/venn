// A new poll's look. It's the page's: retro like the website, unless this browser chose Classic
// mode (the footer's switch, here as on the website). There's no look picker on the form (Seph,
// 2026-11-01): a brand template's look comes from its link (/new?brand=), started from the template
// itself or from My polls' Templates. Loaded once the page is drawn.

import { retroLook } from './retro-look.js';

/** The footer's switch. `preview()` redraws the link preview in the new look. */
export function createLook({ current, preview }) {
  const sw = document.querySelector('.footer .classic-switch');
  if (!sw) return;
  sw.hidden = !!current(); // a brand template's look replaces Venn's
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
