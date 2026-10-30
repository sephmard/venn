// Run in <head>, before anything is drawn. The look: a new poll starts retro like the website,
// unless this browser chose Classic mode or the link says ?retro=0 (a poll's look comes from the
// server). And the page's code, fetched now and all at once rather than one file after another.
(() => {
  const q = new URLSearchParams(location.search);
  const create = /^\/new(\/free)?\/?$/.test(location.pathname);
  let on = create && !q.has('edit') && !q.has('copy') && q.get('retro') !== '0';
  if (on && !q.has('retro'))
    try {
      on = localStorage.getItem('venn:retro') !== '0';
    } catch {}
  if (on) document.documentElement.classList.add('retro');
  // Each page's modules (kept in step with their imports by test/budget.test.js).
  const code = create
    ? ['create-free.js', 'core.js', 'picker.js', 'ui.js', 'create.js', 'templates.js', 'retro-look.js']
    : /^\/e\//.test(location.pathname)
      ? ['event.js', 'core.js', 'invite.js', 'day-parts.js', 'ui.js', 'when.js']
      : [];
  const add = (attrs) => document.head.append(Object.assign(document.createElement('link'), attrs));
  for (const f of code) add({ rel: 'modulepreload', href: `/${f}` });
  if (create) add({ rel: 'preload', as: 'style', href: '/create.css' });
  if (on || document.documentElement.classList.contains('retro'))
    add({ rel: 'preload', as: 'font', type: 'font/woff2', crossOrigin: '', href: '/fonts/orbitron-latin-900-normal.woff2' });
})();
