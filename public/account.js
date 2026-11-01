// My polls (/me): sign in, if you like, and every poll you made or answered and every brand
// template you keep is here on any device, to search, sort and group. Venn works the same without
// it. Signing in is the server's (src/auth.js); this page lists what the account keeps and adds the
// links this browser remembers.

import { $, api, app, esc, plural, toast } from './ui.js';
import { accountHint, refreshAccountMenu } from './account-menu.js';
import { stickerStack, rotate } from './stickers.js';
import {
  GROUPS,
  SORTS,
  answeredMeta,
  arrange,
  canMake,
  parseOrganizerLink,
  pollMeta,
  rememberedLinks,
  signInAgree,
  signInButtons,
} from './account-data.js';
import { emailSignInForm, wireEmailSignIn } from './email-signin.js';

await new Promise((done) =>
  document.head.append(
    Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/account.css', onload: done, onerror: done }),
  ),
);

const initial = (u) => (u.name || u.email || '?').trim().charAt(0).toUpperCase();

// Which list is showing, and how it's sorted and grouped, remembered in this browser.
const VIEW_KEY = 'venn:me-view';
const TABS = { made: 'Created', answered: 'Answered', brands: 'Templates' };
function loadView() {
  let v = {};
  try {
    v = JSON.parse(localStorage.getItem(VIEW_KEY)) || {};
  } catch {}
  return {
    tab: Object.hasOwn(TABS, v.tab) ? v.tab : 'made',
    sort: Object.hasOwn(SORTS, v.sort) ? v.sort : 'new',
    group: Object.hasOwn(GROUPS, v.group) ? v.group : 'status',
    q: '',
  };
}
const saveView = ({ tab, sort, group }) => {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ tab, sort, group }));
  } catch {}
};

export async function renderAccount() {
  // Account settings, and the pages the sign-in emails open (account-settings.js).
  const sub = location.pathname.match(/^\/me\/(settings|confirm|reset|email)\/?$/)?.[1];
  if (sub) return (await import('./account-settings.js')).renderSub(sub);
  document.title = 'My polls · Venn';
  const failed = location.hash === '#signin-failed';
  const forgot = location.hash === '#forgot';
  const signup = location.hash === '#signup';
  if (location.hash) history.replaceState(null, '', location.pathname);
  app.innerHTML = `<div class="account" aria-busy="true"><h1>My polls</h1><div class="acct-skeleton" aria-hidden="true">${'<span></span>'.repeat(4)}</div></div>`;
  let me;
  try {
    me = await api('me');
  } catch (e) {
    app.innerHTML = `<div class="account"><h1>My polls</h1><div class="sheet acct-empty"><p>${esc(e.message)}</p><button type="button" class="btn" id="acct-retry">Try again</button></div></div>`;
    $('#acct-retry').onclick = renderAccount;
    return;
  }
  if (!me.user) {
    accountHint(null);
    refreshAccountMenu();
    showSignIn(me.providers || [], failed, forgot ? 'forgot' : signup ? 'signup' : 'signin');
    return;
  }
  accountHint({ initial: initial(me.user), name: me.user.name || me.user.email || '' });
  refreshAccountMenu();
  const view = loadView();
  showMine(me, view);
  // The links this browser remembers join the account, once.
  const links = rememberedLinks();
  if (!links.polls.length && !links.brands.length && !links.answers.length) return;
  try {
    const { added } = await api('me/claim', { method: 'POST', body: links });
    const n = added.polls + added.brands + (added.answers || 0);
    if (!n) return;
    showMine(await api('me'), view);
    toast(`Added ${plural(n, added.brands === n ? 'template' : 'poll')} from this browser`);
  } catch {}
}

// ---------- signed out ----------

const HEADINGS = { signin: 'Sign in to Venn', signup: 'Create your account', forgot: 'Sign in to Venn' };

function showSignIn(providers, failed, mode) {
  const buttons = providers.filter((p) => p !== 'email');
  const email = providers.includes('email');
  app.innerHTML = `
    <div class="account acct-signin-page">
      <div class="acct-hero">
        <span class="acct-hero-art" aria-hidden="true">${stickerStack(120)}</span>
        <h1 id="acct-h">${HEADINGS[email ? mode : 'signin']}</h1>
        <p class="lede">${
          providers.length
            ? 'Every poll you make or answer, and your templates, on any device.'
            : 'Signing in isn’t set up on this server. Your polls work with their own links.'
        }</p>
      </div>
      ${
        providers.length
          ? `${
              email
                ? `<div class="seg acct-mode" role="group" aria-label="Sign in or create an account">
                     <button type="button" data-acct-mode="signin">Sign in</button>
                     <button type="button" data-acct-mode="signup">Create account</button>
                   </div>`
                : ''
            }
             ${failed ? '<p class="acct-alert" role="alert">Sign-in didn’t finish. Try again.</p>' : ''}
             ${buttons.length ? `<div class="signin">${signInButtons(buttons, '/me')}</div>` : ''}
             ${email ? emailSignInForm({ alone: !buttons.length }) : ''}
             <p class="hint">No account needed to make or answer a poll.</p>
             ${signInAgree()}`
          : '<a class="btn btn-primary" href="/new" data-link>Create a Venn</a>'
      }
    </div>`;
  rotate(app.querySelector('[data-stickers]'));
  // Email and password (email-signin.js). /me#forgot opens on "Forgot password?", /me#signup on
  // Create account. The switch and the heading follow the form, whichever way it changes.
  if (email) {
    const tabs = app.querySelectorAll('[data-acct-mode]');
    const form = wireEmailSignIn({
      mode,
      switcher: true,
      onSignedIn: renderAccount,
      onMode: (m) => {
        $('#acct-h').textContent = HEADINGS[m];
        for (const t of tabs)
          t.setAttribute('aria-pressed', String(t.dataset.acctMode === (m === 'signup' ? 'signup' : 'signin')));
      },
    });
    for (const t of tabs) t.onclick = () => t.getAttribute('aria-pressed') !== 'true' && form.show(t.dataset.acctMode);
  }
  // A tap shows it's on its way (the provider's page can take a moment), and can't be tapped twice.
  for (const a of app.querySelectorAll('.btn-signin'))
    a.addEventListener('click', (e) => {
      if (app.querySelector('.btn-signin.is-busy')) return e.preventDefault();
      a.classList.add('is-busy');
      a.setAttribute('aria-disabled', 'true');
      a.lastChild.textContent = `Opening ${a.lastChild.textContent.replace('Continue with ', '')}…`;
    });
}
// Back from the provider's page without signing in (the page comes back from the cache): ready again.
addEventListener('pageshow', (e) => {
  if (e.persisted && location.pathname === '/me' && app.querySelector('.btn-signin.is-busy')) renderAccount();
});

// ---------- signed in ----------

const pollRow = (p) => `
  <li><a class="acct-row" href="/e/${esc(p.id)}#organizer" data-link>
    <span class="acct-icon" aria-hidden="true">${esc(p.emoji || '📅')}</span>
    <span class="acct-text"><b>${esc(p.title)}</b><span class="muted">${esc(pollMeta(p))}</span></span>
    <span class="acct-chev" aria-hidden="true">›</span>
  </a></li>`;

const answeredRow = (p) => {
  const can = canMake(p);
  return `
  <li><a class="acct-row" href="/e/${esc(p.id)}" data-link>
    <span class="acct-icon" aria-hidden="true">${esc(p.emoji || '📅')}</span>
    <span class="acct-text"><b>${esc(p.title)}</b><span class="muted">${esc(answeredMeta(p))}${p.organizer ? ` · ${esc(p.organizer)}` : ''}</span></span>
    ${can ? `<span class="acct-can ${can[0]}">${can[1]}</span>` : '<span class="acct-chev" aria-hidden="true">›</span>'}
  </a></li>`;
};

const brandRow = (b) => `
  <li class="acct-brand">
    <a class="acct-row" href="/brand/${esc(b.id)}#organizer" data-link>
      ${b.logoV != null ? `<img class="acct-icon acct-logo" src="/api/brands/${esc(b.id)}/logo?v=${esc(b.logoV)}" alt="">` : '<span class="acct-icon" aria-hidden="true">🏷️</span>'}
      <span class="acct-text"><b>${esc(b.name)}</b><span class="muted">Edit and share</span></span>
    </a>
    <a class="btn acct-use" href="/new?brand=${esc(b.id)}" data-link aria-label="New poll with ${esc(b.name)}">New poll</a>
  </li>`;

const EMPTY = {
  made: ['No polls yet.', '<a class="btn btn-primary" href="/new" data-link>Create a Venn</a>'],
  answered: ['Polls you answer while signed in show up here.', ''],
  brands: ['Your logo and colours on every poll.', '<a class="btn btn-primary" href="/brand/new" data-link>Make a template</a>'],
};

const options = (all, on) =>
  Object.entries(all)
    .map(([k, label]) => `<option value="${k}"${k === on ? ' selected' : ''}>${label}</option>`)
    .join('');

function showMine(me, view) {
  const { user } = me;
  const lists = { made: me.polls || [], answered: me.answered || [], brands: me.brands || [] };
  app.innerHTML = `
    <div class="account">
      <h1>My polls</h1>
      <div class="tabs acct-tabs" role="tablist" aria-label="My polls">
        ${Object.entries(TABS)
          .map(
            ([k, label]) =>
              `<button type="button" role="tab" id="acct-tab-${k}" aria-controls="acct-panel" data-tab="${k}">${label}${lists[k].length ? ` <span class="acct-n">${lists[k].length}</span>` : ''}</button>`,
          )
          .join('')}
      </div>
      <div id="acct-panel" role="tabpanel">
        <div class="acct-tools">
          <label class="acct-search">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <input id="acct-q" type="search" enterkeyhint="search" autocomplete="off" aria-label="Search">
          </label>
          <div class="acct-pickers">
            <label class="acct-pick"><span>Sort</span><select id="acct-sort">${options(SORTS, view.sort)}</select></label>
            <label class="acct-pick" id="acct-group-pick"><span>Group</span><select id="acct-group">${options(GROUPS, view.group)}</select></label>
          </div>
        </div>
        <div id="acct-results" aria-live="polite"></div>
      </div>
      <section class="sheet acct-account" aria-label="Account">
        <div class="acct-who">
          <span class="acct-avatar" aria-hidden="true">${esc(initial(user))}</span>
          <span class="acct-text"><b>${esc(user.name || user.email || 'Signed in')}</b><span class="muted">${esc(user.name && user.email ? user.email : `Signed in with ${user.providerLabel}`)}</span></span>
        </div>
        <details class="acct-add">
          <summary>Add a poll from its link</summary>
          <form id="acct-add-form" class="acct-add-row">
            <input id="acct-link" type="url" inputmode="url" autocomplete="off" placeholder="venn.day/e/…#admin=…" aria-label="Organizer link">
            <button type="submit" class="btn">Add</button>
          </form>
        </details>
        <div class="acct-actions">
          <a class="btn" href="/me/settings" data-link>Account settings</a>
          <button type="button" class="btn" id="acct-out">Sign out</button>
        </div>
      </section>
    </div>`;

  const draw = () => {
    saveView(view);
    for (const b of app.querySelectorAll('[role="tab"]')) {
      const on = b.dataset.tab === view.tab;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
    }
    $('#acct-panel').setAttribute('aria-labelledby', `acct-tab-${view.tab}`);
    const items = lists[view.tab];
    const brands = view.tab === 'brands';
    // Searching, sorting and grouping are for lists long enough to need them.
    $('.acct-tools').hidden = items.length < 2;
    $('#acct-q').placeholder = brands ? 'Search templates' : 'Search polls';
    $('#acct-group-pick').hidden = brands;
    // Templates have no date to sort by.
    const sort = brands && view.sort === 'date' ? 'new' : view.sort;
    $('#acct-sort').innerHTML = options(
      brands ? Object.fromEntries(Object.entries(SORTS).filter(([k]) => k !== 'date')) : SORTS,
      sort,
    );
    const groups = arrange(items, { q: view.q, sort, group: brands ? 'none' : view.group });
    const row = { made: pollRow, answered: answeredRow, brands: brandRow }[view.tab];
    const out = $('#acct-results');
    if (!items.length) {
      const [line, action] = EMPTY[view.tab];
      out.innerHTML = `<div class="sheet acct-empty"><p>${line}</p>${action}</div>`;
    } else if (!groups.length) {
      out.innerHTML = `<div class="acct-empty acct-none"><p>Nothing matches “${esc(view.q.trim())}”.</p><button type="button" class="link-btn" id="acct-clear">Clear search</button></div>`;
      $('#acct-clear').onclick = () => {
        $('#acct-q').value = view.q = '';
        draw();
        $('#acct-q').focus();
      };
    } else {
      out.innerHTML =
        groups
          .map(
            (g) =>
              `${g.label ? `<h2 class="acct-h">${esc(g.label)} <span class="muted">${g.items.length}</span></h2>` : ''}<ul class="acct-list" aria-label="${esc(g.label || TABS[view.tab])}">${g.items.map(row).join('')}</ul>`,
          )
          .join('') + (brands ? '<a class="acct-new" href="/brand/new" data-link>+ New template</a>' : '');
    }
  };

  const tabs = [...app.querySelectorAll('[role="tab"]')];
  for (const b of tabs) {
    b.onclick = () => {
      view.tab = b.dataset.tab;
      draw();
    };
    // Arrow keys move between the tabs, as tabs do.
    b.onkeydown = (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      const next = tabs[(tabs.indexOf(b) + d + tabs.length) % tabs.length];
      next.focus();
      next.click();
    };
  }
  $('#acct-q').oninput = (e) => {
    view.q = e.target.value;
    draw();
  };
  $('#acct-sort').onchange = (e) => {
    view.sort = e.target.value;
    draw();
  };
  $('#acct-group').onchange = (e) => {
    view.group = e.target.value;
    draw();
  };
  $('#acct-q').value = view.q;
  draw();

  $('#acct-add-form').onsubmit = async (e) => {
    e.preventDefault();
    const link = parseOrganizerLink($('#acct-link').value);
    if (!link) return toast('Paste the whole organizer link, with #admin= at the end');
    try {
      const { added } = await api('me/claim', { method: 'POST', body: { [link.kind]: [{ id: link.id, token: link.token }] } });
      if (!added.polls && !added.brands) return toast('That link isn’t an organizer link, or the poll is already in an account');
      showMine(await api('me'), { ...view, tab: link.kind === 'brands' ? 'brands' : 'made' });
      toast('Added');
    } catch (ex) {
      toast(ex.message);
    }
  };
  $('#acct-out').onclick = () => signOut().then(renderAccount);
}

/** Sign out here: the session ends on the server, and the menu forgets the name. */
export async function signOut() {
  try {
    await api('auth/logout', { method: 'POST' });
  } catch {}
  accountHint(null);
  refreshAccountMenu();
  toast('Signed out');
}
