// My polls (/me): sign in, if you like, and every poll and brand template you organize is in one
// list on any device. Venn works the same without it. Signing in is the server's (src/auth.js); this
// page lists what the account keeps and adds the organizer links this browser remembers.

import { $, api, app, esc, plural, toast } from './ui.js';
import { accountHint, refreshAccountMenu } from './account-menu.js';
import { parseOrganizerLink, pollMeta, rememberedLinks, signInButtons } from './account-data.js';

await new Promise((done) =>
  document.head.append(
    Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/account.css', onload: done, onerror: done }),
  ),
);

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
               ${signInButtons(providers, '/me')}
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
