// The account's place in the top bar (app pages) and in the website's menu: "Sign in", or the
// signed-in person's initial with My polls and Sign out. Only when the server has sign-in set up
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
  panel.querySelector('.acct-item')?.remove();
  if (!me && !configured) return;
  const a = Object.assign(document.createElement('a'), {
    href: '/me',
    className: 'acct-item',
    textContent: me ? 'My polls' : 'Sign in',
  });
  panel.prepend(a);
}
