// Venn's single-page app: a tiny router over the create pages and the poll page.

import { renderChooser, renderFree, renderPick } from './create.js';
import { renderEvent } from './event.js';

let cleanup = () => {};

// Poll pages get their own tab icon, so an open poll stands out from the create pages.
function setTabIcon(name) {
  for (const link of document.querySelectorAll('link[rel="icon"]'))
    link.href = `/${name}.${link.type === 'image/svg+xml' ? 'svg' : 'ico'}?v=5`;
}

async function route() {
  cleanup();
  cleanup = () => {};
  document.getElementById('toast').hidden = true;
  const path = location.pathname.replace(/\/$/, '');
  const poll = path.match(/^\/e\/([A-Za-z0-9]+)$/);
  setTabIcon(poll ? 'favicon-poll' : 'favicon');
  let off;
  if (poll) off = await renderEvent(poll[1], navigate);
  else if (path === '/new/pick') off = renderPick();
  else if (path === '/new/free') off = renderFree();
  else off = renderChooser();
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
