// The account's place in the top bar, on the website and the app alike: "Sign in" beside Create a
// Venn (first in the menu on phones), or (signed in) the person's name, My polls, Account settings
// and Sign out at the top of the menu. Only when the server has sign-in set up (/api/config). On a
// poll's page, which is for answering, Sign in is only in the menu, never in the bar. Who's signed
// in is remembered in this browser (just a name and an initial), so it shows without asking the server.

const KEY = 'venn:account';

/** The signed-in person as this browser remembers them ({ initial, name }), or null. Set with a value. */
export function accountHint(value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(KEY)) || null;
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else {
      localStorage.removeItem(KEY);
      localStorage.removeItem('venn:kept'); // signed out: the next account here gets this browser's links too (keep.js)
    }
  } catch {}
  return value ?? null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
let configured = null; // providers, once known
let loadConfig = () => fetch('/api/config').then((r) => r.json());

/** Draw (or redraw) the account's place. `getConfig` shares the page's /api/config, when it has one. */
export async function accountMenu(getConfig) {
  if (getConfig) loadConfig = getConfig;
  const me = accountHint();
  // Signed in: what this browser made, answered or opened by a private link joins the account.
  if (me) import('./keep.js').then((m) => m.keepThisBrowser()).catch(() => {});
  if (!me && configured === null) {
    // Whether the server has sign-in, as last seen here: drawn at once, so "Sign in" doesn't pop
    // in (and move Create a Venn) after the page has shown. Checked with the server, and redrawn
    // only if it changed.
    const seen = signInSeen();
    if (seen !== null) {
      configured = seen;
      await draw(me);
    }
    configured = ((await loadConfig().catch(() => ({}))).accounts || []).length > 0;
    signInSeen(configured);
    if (configured === seen) return;
  }
  await draw(me);
}

async function draw(me) {
  const panel = document.querySelector('.menu-panel');
  if (!panel) return;
  // The app (every page but the website's): its stylesheet for the account's part of the menu.
  if (document.getElementById('app') && (me || configured)) await styles();
  drawMenu(panel, me);
}

const SEEN = 'venn:signin-on';
function signInSeen(value) {
  try {
    if (value === undefined) return { 1: true, 0: false }[localStorage.getItem(SEEN)] ?? null;
    localStorage.setItem(SEEN, value ? '1' : '0');
  } catch {}
  return null;
}

/** Redraw after signing in or out. */
export const refreshAccountMenu = () => accountMenu();

let styled;
const styles = () =>
  (styled ??= new Promise((done) =>
    document.head.append(
      Object.assign(document.createElement('link'), {
        rel: 'stylesheet',
        href: '/account-menu.css',
        onload: done,
        onerror: done,
      }),
    ),
  ));

function drawMenu(panel, me) {
  const app = !!document.getElementById('app');
  // In the app, links go through its router (app.js), so the page changes without reloading.
  const link = (href, text) => `<a href="${href}"${app ? ' data-link' : ''}>${text}</a>`;
  panel.querySelector('.acct-group')?.remove();
  panel.closest('.nav-links')?.querySelector('.site-signin')?.remove();
  if (!me && !configured) return;
  // Signed out: "Sign in", quieter than Create a Venn, which stays the main way in. In the bar on
  // wider screens; on phones, where the bar is full, first in the menu (the stylesheet shows one).
  // A poll's page is for answering, so there it's only in the menu, never in the bar.
  if (!me) {
    const onPoll = /^\/e\//.test(location.pathname);
    if (!onPoll) {
      const a = Object.assign(document.createElement('a'), { href: '/me', className: 'site-signin', textContent: 'Sign in' });
      if (app) a.dataset.link = '';
      panel.closest('details').before(a);
    }
    const group = document.createElement('div');
    group.className = `acct-group acct-group-out${onPoll ? ' acct-group-always' : ''}`;
    group.innerHTML = `${link('/me', 'Sign in')}<hr class="menu-sep" />`;
    panel.prepend(group);
    return;
  }
  // Signed in: the account first in the menu, set apart from the website's links by a line.
  const group = document.createElement('div');
  group.className = 'acct-group';
  group.innerHTML = `${me.name ? `<p class="menu-who">${esc(me.name)}</p>` : ''}
     ${link('/me', 'My polls')}
     ${link('/me/settings', 'Account settings')}
     <button type="button" class="menu-signout">Sign out</button>
     <hr class="menu-sep" />`;
  group.querySelector('.menu-signout').addEventListener('click', async () => {
    panel.closest('details').open = false;
    const { signOut } = await import('./account.js');
    await signOut();
    if (app && location.pathname === '/me') (await import('./account.js')).renderAccount();
  });
  panel.prepend(group);
}
