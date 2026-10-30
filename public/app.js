// Venn's single-page app: a tiny router over the create pages and the poll page. Each page's code
// loads when it's first opened, so people answering a poll never download the poll creator.

let cleanup = () => {};

async function route() {
  cleanup();
  cleanup = () => {};
  document.getElementById('toast').hidden = true;
  document.documentElement.classList.remove('retro');
  const path = location.pathname.replace(/\/$/, '');
  const poll = path.match(/^\/e\/([A-Za-z0-9]+)$/);
  // Poll pages get their own tab icon.
  for (const l of document.querySelectorAll('link[rel=icon]'))
    l.href = l.href.replace(/favicon[^.]*/, poll ? 'favicon-poll' : 'favicon');
  let off;
  if (poll) off = await (await import('./event.js')).renderEvent(poll[1], navigate);
  else {
    // Every new poll is a Venn (create-free.js). /new/pick is the older "vote on a few dates" page,
    // still used to edit or copy polls made with it; nothing links to it otherwise.
    if (path === '/new/pick') off = (await import('./create-pick.js')).renderPick();
    else off = (await import('./create-free.js')).renderFree();
  }
  if (typeof off === 'function') cleanup = off;
}

function navigate(path) {
  history.pushState(null, '', path);
  route();
  scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    navigate(a.getAttribute('href'));
  }
});
addEventListener('popstate', route);

route();
