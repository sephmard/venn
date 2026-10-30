// The website's look: retro (html.retro, in site.css) is the site's own; Classic mode in the menu
// switches to the classic look, remembered in this browser. Loaded in <head>, before the page is
// drawn, so it never flashes the other look. The home page's address says which: venn.day for
// retro, venn.day/classic for classic, so a copied link shares the look (and its preview).
(() => {
  const KEY = 'venn:retro';
  const root = document.documentElement;
  const home = location.pathname === '/' || location.pathname === '/classic';
  const asked = new URLSearchParams(location.search).get('retro'); // older links: ?retro=1 or 0
  let on = true;
  const remember = () => {
    try {
      if (on) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, '0');
    } catch {
      // Not remembered, but this page shows it.
    }
  };
  if (location.pathname === '/classic' || asked === '0') ((on = false), remember());
  else if (asked === '1') remember();
  else
    try {
      on = localStorage.getItem(KEY) !== '0';
    } catch {
      // Storage blocked: the site's own look.
    }
  const share = () => {
    const url = new URL(location.href);
    url.searchParams.delete('retro');
    if (home) url.pathname = on ? '/' : '/classic';
    if (url.href !== location.href) history.replaceState(history.state, '', url);
  };
  const apply = () => {
    root.classList.toggle('retro', on);
    // What the stylesheet can't swap: the tab icon, the browser bar's colour, Finn's stickers.
    const icon = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
    if (icon) icon.href = on ? '/logo-retro.svg?v=1' : '/favicon.svg?v=5';
    for (const m of document.querySelectorAll('meta[name="theme-color"]'))
      m.content = on ? '#0d0221' : m.media.includes('dark') ? '#0f1112' : '#faf8f4';
    for (const img of document.querySelectorAll('[data-stickers] img'))
      img.src = img.src.replace(/\/stickers\/(retro\/)?finn-/, on ? '/stickers/retro/finn-' : '/stickers/finn-');
    for (const b of document.querySelectorAll('.classic-switch')) b.setAttribute('aria-checked', String(!on));
  };
  apply();
  share();
  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.classic-switch')) return;
    on = !on;
    remember();
    apply();
    share();
  });
})();
