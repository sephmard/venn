// Retro mode on the website: the switch in the menu turns on the retrofuturist look (html.retro, in
// site.css), remembered in this browser. Loaded in <head>, before the page is drawn, so it never
// flashes the other look. Off, the site is its usual self.
(() => {
  const KEY = 'venn:retro';
  const root = document.documentElement;
  let on = false;
  try {
    on = localStorage.getItem(KEY) === '1';
  } catch {
    // Storage blocked: the usual look, and the switch still works for this page.
  }
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
  });
})();
