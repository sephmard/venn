// Venn's single-page app: a tiny router over the create pages and the poll page. Each page's code
// loads when it's first opened, so people answering a poll never download the poll creator.

let cleanup = () => {};

async function route() {
  cleanup();
  cleanup = () => {};
  document.getElementById('toast').hidden = true;
  const path = location.pathname.replace(/\/$/, '');
  const poll = path.match(/^\/e\/([A-Za-z0-9]+)$/);
  let off;
  if (poll) off = await (await import('./event.js')).renderEvent(poll[1], navigate);
  else {
    const create = await import('./create.js');
    off = path === '/new/pick' ? create.renderPick() : path === '/new/free' ? create.renderFree() : create.renderChooser();
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
