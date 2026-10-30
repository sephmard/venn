// Retro mode on the website: the switch in the menu turns on the retrofuturist look (html.retro, in
// site.css), remembered in this browser. Loaded in <head>, before the page is drawn, so it never
// flashes the other look. Off, the site is its usual self. While it's on, the address says
// ?retro=1, so a copied link shares it; ?retro=0 turns it off.
(() => {
  const KEY = 'venn:retro';
  const root = document.documentElement;
  const asked = new URLSearchParams(location.search).get('retro');
  let on = asked === '1';
  try {
    if (asked === '1' || asked === '0') {
      if (on) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } else on = localStorage.getItem(KEY) === '1';
  } catch {
    // Storage blocked: the link's choice, or the usual look; the switch still works for this page.
  }
  const share = () => {
    const url = new URL(location.href);
    if (on) url.searchParams.set('retro', '1');
    else url.searchParams.delete('retro');
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
    try {
      if (on) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      // Not remembered, but on for now.
    }
    apply();
    share();
  });
})();
