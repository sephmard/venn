// Venn's single-page app: a tiny router over the create pages and the poll page. Each page's code
// loads when it's first opened, so people answering a poll never download the poll creator.

let cleanup = () => {};

// Tab icon: Venn's logo; the green one in Classic mode. A white-label poll's own stays.
function tabIcon() {
  let c;
  try {
    c = localStorage.getItem('venn:retro') === '0';
  } catch {}
  for (const l of document.querySelectorAll('link[rel=icon]'))
    l.href = l.href.replace(/\/(favicon|favicon-poll|logo-retro)\.(svg|ico)\?v=\d+/, (_, n, x) =>
      c ? `/favicon.${x}?v=5` : `/logo-retro.${x}?v=1`,
    );
}

async function route() {
  cleanup();
  cleanup = () => {};
  document.getElementById('toast').hidden = true;
  // The footer's Classic mode switch is for a new poll's page only (create.js shows it there).
  const classic = document.querySelector('.footer .classic-switch');
  if (classic) classic.hidden = true;
  const path = location.pathname.replace(/\/$/, '');
  const poll = path.match(/^\/(?:e|embed)\/([A-Za-z0-9]+)$/);
  const embed = document.documentElement.classList.contains('embed');
  if (!poll) document.documentElement.classList.remove('white-label'); // a poll's own (event.js)
  const brand = path.match(/^\/brand(?:\/([A-Za-z0-9]+))?$/);
  // The look carries on until the page says, so moving between pages never flashes the other one:
  // a new poll's is set below, before it's drawn; a poll's once it loads (event.js), and an edited or
  // copied one's once its poll does (create.js).
  const look = !poll && !/[?&](edit|copy)=/.test(location.search) && import('./retro-look.js');
  tabIcon();
  let off;
  // The bar's Create a Venn shows on every page but the create pages, where the form is the way on
  // (app-look.js sets this first, before the page is drawn).
  document.documentElement.classList.toggle('creating', /^\/new(\/|$)/.test(path));
  // The account's place in the top bar's menu (account-menu.js), drawn for each page.
  // Not in a frame (/embed), where Venn's cookie isn't sent.
  if (!embed) import('./account-menu.js').then(async (m) => m.accountMenu((await import('./ui.js')).getConfig)).catch(() => {});
  if (poll) off = await (await import('./event.js')).renderEvent(poll[1], navigate);
  // An organization's brand template (brand.js): made, managed or seen from its link.
  else if (path === '/brand/preview') off = await (await import('./brand-demo.js')).renderDemo();
  else if (brand) off = await (await import('./brand.js')).renderBrand(brand[1] || null);
  // My polls (account.js): signing in, the account's polls, and its settings.
  else if (/^\/me(\/\w+)?$/.test(path)) {
    if (look) (await look).retroLook((await look).wantsRetro());
    // From a template's create form or a branded poll, My polls is in Venn's own look again.
    if (document.documentElement.classList.contains('branded')) (await import('./brand-look.js')).brandLook(null);
    off = await (await import('./account.js')).renderAccount();
  } else {
    // Every new poll is a Venn (create-free.js). /new/pick is the older "vote on a few dates" page,
    // still used to edit or copy polls made with it; nothing links to it otherwise.
    // /new/topic: a Venn about what, not when (create-topic.js).
    const pick = path === '/new/pick';
    const topic = path === '/new/topic';
    // /new/rsvp: the date is set; who's coming? (create-rsvp.js)
    const rsvp = path === '/new/rsvp';
    const page = import(pick ? './create-pick.js' : topic ? './create-topic.js' : rsvp ? './create-rsvp.js' : './create-free.js'); // fetched alongside the look
    if (look) {
      const { retroLook, wantsRetro } = await look;
      retroLook(wantsRetro());
    }
    off = pick
      ? (await page).renderPick()
      : topic
        ? (await page).renderTopic()
        : rsvp
          ? (await page).renderRsvpForm()
          : (await page).renderFree();
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
    // In a frame, the poll stays put: other pages open in a new tab.
    if (document.documentElement.classList.contains('embed')) open(a.getAttribute('href'), '_blank', 'noopener');
    else navigate(a.getAttribute('href'));
  }
});
addEventListener('popstate', route);

route();
// The top bar's menu closes on a pick, a tap outside, or Escape (loaded after the page).
void import('./menu.js').catch(() => {});
