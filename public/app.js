// Venn's single-page app: a tiny router over the create pages and the poll page. Each page's code
// loads when it's first opened, so people answering a poll never download the poll creator.

let cleanup = () => {};

async function route() {
  cleanup();
  cleanup = () => {};
  document.getElementById('toast').hidden = true;
  const path = location.pathname.replace(/\/$/, '');
  const poll = path.match(/^\/e\/([A-Za-z0-9]+)$/);
  // The look carries on until the page says, so moving between pages never flashes the other one:
  // a new poll's is set below, before it's drawn; a poll's once it loads (event.js), and an edited or
  // copied one's once its poll does (create.js).
  const look = !poll && !/[?&](edit|copy)=/.test(location.search) && import('./retro-look.js');
  // Poll pages get their own tab icon.
  for (const l of document.querySelectorAll('link[rel=icon]'))
    l.href = l.href.replace(/favicon[^.]*/, poll ? 'favicon-poll' : 'favicon');
  let off;
  if (poll) off = await (await import('./event.js')).renderEvent(poll[1], navigate);
  else {
    // Every new poll is a Venn (create-free.js). /new/pick is the older "vote on a few dates" page,
    // still used to edit or copy polls made with it; nothing links to it otherwise.
    const pick = path === '/new/pick';
    const page = pick ? import('./create-pick.js') : import('./create-free.js'); // fetched alongside the look
    if (look) {
      const { retroLook, wantsRetro } = await look;
      retroLook(wantsRetro());
    }
    off = pick ? (await page).renderPick() : (await page).renderFree();
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
