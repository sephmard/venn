// The account's place in the top bar (app pages) and on the website: "Sign in" beside Create a
// Venn, or (signed in) the person's initial, or the website menu, with My polls, Account settings
// and Sign out. Only when the server has sign-in set up
// (/api/config), and never "Sign in" on a poll's page, which is for answering. Who's signed in is
// remembered in this browser (just a name and an initial), so it shows without asking the server.

const KEY = 'venn:account';

/** The signed-in person as this browser remembers them ({ initial, name }), or null. Set with a value. */
export function accountHint(value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(KEY)) || null;
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
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
  if (!me && configured === null) configured = ((await loadConfig().catch(() => ({}))).accounts || []).length > 0;
  // The app's top bar (the website has its menu instead).
  const bar = document.getElementById('app') && document.querySelector('.topbar');
  if (bar) await drawBar(bar, me);
  const panel = document.querySelector('.menu-panel');
  if (panel) drawSiteMenu(panel, me);
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

async function drawBar(bar, me) {
  const onPoll = /^\/e\//.test(location.pathname);
  if (!me && (!configured || onPoll)) return bar.querySelector('.acct-slot')?.remove();
  await styles();
  // Already showing this person (or Sign in): left alone, so an open menu stays open.
  const key = me ? `${me.initial}|${me.name}` : '-';
  if (bar.querySelector('.acct-slot')?.dataset.key === key) return;
  bar.querySelector('.acct-slot')?.remove();
  const slot = document.createElement('div');
  slot.className = 'acct-slot';
  slot.dataset.key = key;
  slot.innerHTML = me
    ? `<details class="acct-menu">
         <summary aria-label="${esc(me.name ? `Account: ${me.name}` : 'Account')}"><span class="acct-avatar" aria-hidden="true">${esc(me.initial)}</span></summary>
         <div class="acct-panel">
           <a href="/me" data-link>My polls</a>
           <a href="/me/settings" data-link>Account settings</a>
           <button type="button" data-signout>Sign out</button>
         </div>
       </details>`
    : '<a class="btn btn-ghost acct-signin" href="/me" data-link>Sign in</a>';
  bar.append(slot); // after Create a Venn, at the end of the bar
  const menu = slot.querySelector('details');
  if (!menu) return;
  // Closes on a pick, a tap outside, or Escape, like the website's menu.
  slot.addEventListener('click', (e) => {
    if (e.target.closest('.acct-panel a')) menu.open = false;
  });
  slot.querySelector('[data-signout]').onclick = async () => {
    menu.open = false;
    const { signOut } = await import('./account.js');
    await signOut();
    if (location.pathname === '/me') (await import('./account.js')).renderAccount();
  };
  const away = (e) => {
    if (!slot.isConnected) return removeEventListener('click', away);
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  };
  addEventListener('click', away);
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
}

function drawSiteMenu(panel, me) {
  panel.querySelector('.acct-group')?.remove();
  panel.closest('.nav-links')?.querySelector('.site-signin')?.remove();
  if (!me && !configured) return;
  // Signed out: "Sign in" in the bar, quieter than Create a Venn, which stays the main way in.
  if (!me) {
    // On phones, where the bar is full, a person icon says it.
    const a = Object.assign(document.createElement('a'), { href: '/me', className: 'site-signin' });
    a.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2" /><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg><span>Sign in</span>';
    panel.closest('details').before(a);
    return;
  }
  // Signed in: the account first in the menu, set apart from the website's links by a line.
  const group = document.createElement('div');
  group.className = 'acct-group';
  group.innerHTML = `${me.name ? `<p class="menu-who">${esc(me.name)}</p>` : ''}
     <a href="/me">My polls</a>
     <a href="/me/settings">Account settings</a>
     <button type="button" class="menu-signout">Sign out</button>
     <hr class="menu-sep" />`;
  group.querySelector('.menu-signout').addEventListener('click', async () => {
    panel.closest('details').open = false;
    const { signOut } = await import('./account.js');
    await signOut();
  });
  panel.prepend(group);
}
