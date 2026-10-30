// The app's look from its first paint, run in <head>: a new poll starts retro like the website,
// unless this browser chose Classic mode or the link says ?retro=0. A poll's look comes from the server.
(() => {
  const q = new URLSearchParams(location.search);
  let on = /^\/new(\/|$)/.test(location.pathname) && !q.has('edit') && !q.has('copy') && q.get('retro') !== '0';
  if (on && !q.has('retro'))
    try {
      on = localStorage.getItem('venn:retro') !== '0';
    } catch {}
  if (on) document.documentElement.classList.add('retro');
})();
