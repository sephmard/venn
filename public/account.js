// My polls (/me): sign in, if you like, and every poll and brand template you organize is in one
// list on any device. Venn works the same without it. Signing in is the server's (src/auth.js); this
// page lists what the account keeps and adds the organizer links this browser remembers.

import { $, api, app, esc, plural, toast } from './ui.js';
import { accountHint, refreshAccountMenu } from './account-menu.js';
import { parseOrganizerLink, pollMeta, rememberedLinks } from './account-data.js';

await new Promise((done) =>
  document.head.append(
    Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/account.css', onload: done, onerror: done }),
  ),
);

// Each provider's own mark, as their sign-in guidelines ask.
const MARKS = {
  google:
    '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.6 5.9c4.4-4.1 6.7-10.1 6.7-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>',
  microsoft:
    '<svg viewBox="0 0 21 21" width="20" height="20" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z"/><path fill="#7fba00" d="M11 1h9v9h-9z"/><path fill="#00a4ef" d="M1 11h9v9H1z"/><path fill="#ffb900" d="M11 11h9v9h-9z"/></svg>',
  github:
    '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 0a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.4 7.4 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.7-3.6 3.9.3.3.5.8.5 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 0z"/></svg>',
};
const LABELS = { google: 'Google', microsoft: 'Microsoft', github: 'GitHub' };

const initial = (u) => (u.name || u.email || '?').trim().charAt(0).toUpperCase();

export async function renderAccount() {
  document.title = 'My polls · Venn';
  const failed = location.hash === '#signin-failed';
  if (location.hash) history.replaceState(null, '', location.pathname);
  app.innerHTML = '<div class="empty muted">Loading…</div>';
  let me;
  try {
    me = await api('me');
  } catch (e) {
    app.innerHTML = `<div class="sheet empty"><h1>My polls</h1><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
  if (!me.user) {
    accountHint(null);
    refreshAccountMenu();
    showSignIn(me.providers || []);
    if (failed) toast('Sign-in didn’t finish. Try again.');
    return;
  }
  accountHint({ initial: initial(me.user), name: me.user.name || me.user.email || '' });
  refreshAccountMenu();
  showMine(me);
  // The organizer links this browser remembers join the account, once.
  const links = rememberedLinks();
  if (!links.polls.length && !links.brands.length) return;
  try {
    const { added } = await api('me/claim', { method: 'POST', body: links });
    const n = added.polls + added.brands;
    if (!n) return;
    showMine(await api('me'));
    toast(
      `Added ${plural(n, added.brands && !added.polls ? 'template' : added.polls && !added.brands ? 'poll' : 'item')} from this browser`,
    );
  } catch {}
}

function showSignIn(providers) {
  app.innerHTML = `
    <div class="account">
      <h1>My polls</h1>
      ${
        providers.length
          ? `<p class="lede">Sign in to see and manage your polls on any device.</p>
             <div class="signin">
               ${providers.map((p) => `<a class="btn btn-signin" href="/api/auth/${esc(p)}?next=/me">${MARKS[p] || ''}Continue with ${esc(LABELS[p] || p)}</a>`).join('')}
             </div>
             <p class="hint">No account needed to make or answer a poll.</p>`
          : `<p class="lede">Signing in isn’t set up on this server. Your polls work with their own links.</p>`
      }
    </div>`;
}

const pollRow = (p) => `
  <li><a class="acct-row" href="/e/${esc(p.id)}#organizer" data-link>
    <span class="acct-icon" aria-hidden="true">${esc(p.emoji || '📅')}</span>
    <span class="acct-text"><b>${esc(p.title)}</b><span class="muted">${esc(pollMeta(p))}</span></span>
  </a></li>`;

const brandRow = (b) => `
  <li><a class="acct-row" href="/brand/${esc(b.id)}#organizer" data-link>
    ${b.logoV != null ? `<img class="acct-icon acct-logo" src="/api/brands/${esc(b.id)}/logo?v=${esc(b.logoV)}" alt="">` : '<span class="acct-icon" aria-hidden="true">🏷️</span>'}
    <span class="acct-text"><b>${esc(b.name)}</b><span class="muted">Brand template</span></span>
  </a></li>`;

function showMine({ user, polls, brands }) {
  app.innerHTML = `
    <div class="account">
      <h1>My polls</h1>
      <div class="acct-who">
        <span class="acct-avatar" aria-hidden="true">${esc(initial(user))}</span>
        <span class="acct-text"><b>${esc(user.name || user.email || 'Signed in')}</b><span class="muted">${esc(user.name && user.email ? user.email : `Signed in with ${user.providerLabel}`)}</span></span>
      </div>
      ${
        polls.length
          ? `<ul class="acct-list" aria-label="Polls">${polls.map(pollRow).join('')}</ul>`
          : `<div class="sheet empty acct-empty"><p>No polls yet.</p><a class="btn btn-primary" href="/new" data-link>Create a Venn</a></div>`
      }
      ${brands.length ? `<h2 class="acct-h">Brand templates</h2><ul class="acct-list" aria-label="Brand templates">${brands.map(brandRow).join('')}</ul>` : ''}
      <details class="acct-add">
        <summary>Add a poll from its organizer link</summary>
        <form id="acct-add-form" class="acct-add-row">
          <input id="acct-link" type="url" inputmode="url" autocomplete="off" placeholder="venn.day/e/…#admin=…" aria-label="Organizer link">
          <button type="submit" class="btn">Add</button>
        </form>
      </details>
      <div class="acct-actions">
        <button type="button" class="btn" id="acct-out">Sign out</button>
        <button type="button" class="link-btn acct-delete" id="acct-delete">Delete account</button>
      </div>
      <div class="sheet acct-confirm" id="acct-confirm" hidden>
        <p><b>Delete your account?</b> Your polls stay, with their links.</p>
        <p class="acct-actions"><button type="button" class="btn btn-danger" id="acct-delete-yes">Delete account</button><button type="button" class="btn" id="acct-delete-no">Keep it</button></p>
      </div>
    </div>`;

  $('#acct-add-form').onsubmit = async (e) => {
    e.preventDefault();
    const link = parseOrganizerLink($('#acct-link').value);
    if (!link) return toast('Paste the whole organizer link, with #admin= at the end');
    try {
      const { added } = await api('me/claim', { method: 'POST', body: { [link.kind]: [{ id: link.id, token: link.token }] } });
      if (!added.polls && !added.brands) return toast('That link isn’t an organizer link, or the poll is already in an account');
      showMine(await api('me'));
      toast('Added');
    } catch (ex) {
      toast(ex.message);
    }
  };
  $('#acct-out').onclick = () => signOut().then(renderAccount);
  $('#acct-delete').onclick = () => {
    $('#acct-confirm').hidden = false;
    $('#acct-delete-no').focus();
  };
  $('#acct-delete-no').onclick = () => {
    $('#acct-confirm').hidden = true;
    $('#acct-delete').focus();
  };
  $('#acct-delete-yes').onclick = async () => {
    try {
      await api('me', { method: 'DELETE' });
      accountHint(null);
      refreshAccountMenu();
      toast('Account deleted');
      renderAccount();
    } catch (ex) {
      toast(ex.message);
    }
  };
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
