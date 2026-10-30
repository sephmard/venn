// Retro mode on the website: the retrofuturist look (html.retro, in site.css) is the site's own,
// and the switch in the menu turns it off (the classic look), remembered in this browser. Loaded in
// <head>, before the page is drawn, so it never flashes the other look. While it's off, the
// address says ?retro=0, so a copied link shares that; ?retro=1 turns it back on.
(() => {
  const KEY = 'venn:retro';
  const root = document.documentElement;
  const asked = new URLSearchParams(location.search).get('retro');
  let on = asked !== '0';
  const remember = () => {
    try {
      if (on) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, '0');
    } catch {
      // Not remembered, but this page shows it.
    }
  };
  if (asked === '1' || asked === '0') remember();
  else
    try {
      on = localStorage.getItem(KEY) !== '0';
    } catch {
      // Storage blocked: the site's own look.
    }
  const share = () => {
    const url = new URL(location.href);
    if (on) url.searchParams.delete('retro');
    else url.searchParams.set('retro', '0');
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
    for (const b of document.querySelectorAll('.retro-switch')) b.setAttribute('aria-checked', String(on));
  };
  apply();
  share();
  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.retro-switch')) return;
    on = !on;
    remember();
    apply();
    share();
  });
})();
