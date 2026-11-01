// Account settings (/me/settings), and the pages the sign-in emails open: confirming a new account
// (/me/confirm), choosing a new password (/me/reset) and moving to a new email (/me/email). Each
// link carries its secret after `#t=`; the page takes it out of the address bar at once and uses it
// only when the button is pressed, so mail scanners that open links don't use them up.

import { $, api, app, esc, toast } from './ui.js';
import { accountHint, refreshAccountMenu } from './account-menu.js';
import { emailSignInForm, wireEmailSignIn } from './email-signin.js';
import { signInButtons } from './account-data.js';

const MIN = 10; // src/password.js PASSWORD_MIN

await new Promise((done) =>
  document.head.append(
    Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/account.css', onload: done, onerror: done }),
  ),
);

const go = (path) => {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
  scrollTo(0, 0);
};

/** The link's secret, taken out of the address bar so it isn't left in history or shared by mistake. */
function takeToken() {
  const m = location.hash.match(/^#t=([\w-]{43})$/);
  if (location.hash) history.replaceState(null, '', location.pathname);
  return m ? m[1] : null;
}

const passwordField = (id, label, autocomplete, hint = '') => `
  <div class="em-field">
    <label for="${id}">${label}</label>
    <div class="em-pw"><input id="${id}" type="password" autocomplete="${autocomplete}" required maxlength="128"${hint ? ` aria-describedby="${id}-hint"` : ''}><button type="button" class="em-show" aria-controls="${id}" aria-pressed="false">Show</button></div>
    ${hint ? `<p class="em-hint" id="${id}-hint">${hint}</p>` : ''}
  </div>`;

function wireShow(root = document) {
  root.querySelectorAll('.em-show').forEach(
    (b) =>
      (b.onclick = () => {
        const input = $(`#${b.getAttribute('aria-controls')}`);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.textContent = show ? 'Hide' : 'Show';
        b.setAttribute('aria-pressed', String(show));
      }),
  );
}

const page = (title, inner) => `<div class="account em-page"><h1>${esc(title)}</h1>${inner}</div>`;
const gone = (message) =>
  page(
    'This link has expired',
    `<p class="lede">${esc(message || 'Links work once, and only for a while.')}</p><a class="btn btn-primary" href="/me" data-link>Go to sign in</a>`,
  );

/** After signing in here: the menu shows who it is, and My polls opens. */
async function signedIn(message) {
  try {
    const me = await api('me');
    if (me.user)
      accountHint({
        initial: (me.user.name || me.user.email || '?').trim().charAt(0).toUpperCase(),
        name: me.user.name || me.user.email || '',
      });
  } catch {}
  refreshAccountMenu();
  go('/me');
  if (message) toast(message);
}

function errorLine(id = 'em-error') {
  return {
    html: `<p class="em-error" id="${id}" role="alert" hidden></p>`,
    show(message) {
      const el = $(`#${id}`);
      el.textContent = message;
      el.hidden = false;
    },
    hide: () => ($(`#${id}`).hidden = true),
  };
}

/** /me/<which>, from My polls' renderAccount. */
export const renderSub = (which) =>
  ({ settings: renderSettings, confirm: renderConfirm, reset: renderReset, email: renderEmailChange })[which]();

// ---------- /me/confirm: the sign-up link ----------

export async function renderConfirm() {
  document.title = 'Confirm your email · Venn';
  const token = takeToken();
  if (!token) return (app.innerHTML = gone());
  const err = errorLine();
  app.innerHTML = page(
    'Confirm your email',
    `<p class="lede">One tap and your account is ready.</p>${err.html}<button type="button" class="btn btn-primary em-submit" id="em-confirm">Confirm and sign in</button>`,
  );
  $('#em-confirm').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api('auth/email/confirm', { method: 'POST', body: { token } });
      signedIn('Welcome to Venn');
    } catch (ex) {
      if (ex.status === 410 || ex.status === 409) app.innerHTML = gone(ex.message);
      else {
        err.show(ex.message);
        e.currentTarget.disabled = false;
      }
    }
  };
}

// ---------- /me/reset: a new password, or a first one ----------

export async function renderReset() {
  document.title = 'Choose a password · Venn';
  const token = takeToken();
  if (!token) return (app.innerHTML = gone());
  app.innerHTML = '<div class="empty muted">Loading…</div>';
  let info;
  try {
    info = await api('auth/email/check', { method: 'POST', body: { token, kind: 'reset' } });
  } catch (ex) {
    app.innerHTML = gone(ex.status === 410 ? 'Ask for a new one from the sign-in page.' : ex.message);
    return;
  }
  const err = errorLine();
  app.innerHTML = page(
    info.hasPassword ? 'Choose a new password' : 'Add a password',
    `<form class="em-form" id="em-reset" novalidate>
       <p class="lede">For <b>${esc(info.email)}</b></p>
       <input type="email" autocomplete="username" value="${esc(info.email)}" hidden>
       ${passwordField('em-new', 'New password', 'new-password', `At least ${MIN} characters`)}
       ${err.html}
       <button type="submit" class="btn btn-primary em-submit">Save password</button>
     </form>`,
  );
  wireShow();
  $('#em-new').focus();
  $('#em-reset').onsubmit = async (e) => {
    e.preventDefault();
    const password = $('#em-new').value;
    if ([...password].length < MIN) return err.show(`Use at least ${MIN} characters`);
    const button = e.currentTarget.querySelector('button[type=submit]');
    button.disabled = true;
    err.hide();
    try {
      const { email } = await api('auth/email/reset', { method: 'POST', body: { token, password } });
      // Every browser was signed out: sign in again, here, with the new password.
      accountHint(null);
      refreshAccountMenu();
      app.innerHTML = page('Password saved', `${emailSignInForm({ alone: true })}`);
      wireEmailSignIn({ email, note: 'Sign in with your new password.', onSignedIn: () => signedIn('Signed in') });
      $('#em-password')?.focus();
    } catch (ex) {
      if (ex.status === 410) app.innerHTML = gone(ex.message);
      else {
        err.show(ex.message);
        button.disabled = false;
      }
    }
  };
}

// ---------- /me/email: the link sent to a new address ----------

export async function renderEmailChange() {
  document.title = 'Confirm your new email · Venn';
  const token = takeToken();
  if (!token) return (app.innerHTML = gone());
  const err = errorLine();
  app.innerHTML = page(
    'Confirm your new email',
    `<p class="lede">Your account will sign in with this address from now on.</p>${err.html}<button type="button" class="btn btn-primary em-submit" id="em-change">Use this email</button>`,
  );
  $('#em-change').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      const { email } = await api('auth/email/change', { method: 'POST', body: { token } });
      app.innerHTML = page(
        'Email changed',
        `<p class="lede">Your account now signs in with <b>${esc(email)}</b>.</p><a class="btn btn-primary" href="/me" data-link>Go to My polls</a>`,
      );
    } catch (ex) {
      if (ex.status === 410 || ex.status === 409) app.innerHTML = gone(ex.message);
      else {
        err.show(ex.message);
        e.currentTarget.disabled = false;
      }
    }
  };
}

// ---------- /me/settings ----------

const HASH_NOTES = {
  '#connected': 'Connected. You can sign in with it now.',
  '#connect-taken': 'That account already has its own Venn account, so it can’t be connected here.',
  '#connect-failed': 'Connecting didn’t finish. Try again.',
};

const initial = (u) => (u.name || u.email || '?').trim().charAt(0).toUpperCase();

export async function renderSettings() {
  document.title = 'Account settings · Venn';
  const note = HASH_NOTES[location.hash];
  if (location.hash) history.replaceState(null, '', location.pathname);
  app.innerHTML = '<div class="empty muted">Loading…</div>';
  let s;
  try {
    s = await api('me/settings');
  } catch (ex) {
    if (ex.status === 401) return go('/me');
    app.innerHTML = page('Account settings', `<p class="muted">${esc(ex.message)}</p>`);
    return;
  }
  draw(s);
  if (note) toast(note);
}

function draw(s) {
  const { user, login, connected, connectable, otherSessions, emailSignIn } = s;
  const passwordRow = login
    ? `<div class="set-row"><span class="acct-text"><b>Email</b><span class="muted">${esc(login)}</span></span><button type="button" class="btn" data-open="email">Change</button></div>
       <form class="set-form" id="set-email" hidden novalidate>
         <div class="em-field"><label for="set-new-email">New email</label><input id="set-new-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required maxlength="254"></div>
         ${passwordField('set-email-pw', 'Your password', 'current-password')}
         <p class="em-error" id="set-email-error" role="alert" hidden></p>
         <div class="acct-actions"><button type="submit" class="btn btn-primary">Send a link to it</button><button type="button" class="link-btn" data-close="email">Cancel</button></div>
       </form>
       <div class="set-row"><span class="acct-text"><b>Password</b><span class="muted">••••••••••</span></span><button type="button" class="btn" data-open="password">Change</button></div>
       <form class="set-form" id="set-password" hidden novalidate>
         <input type="email" autocomplete="username" value="${esc(login)}" hidden>
         ${passwordField('set-current', 'Current password', 'current-password')}
         ${passwordField('set-new', 'New password', 'new-password', `At least ${MIN} characters`)}
         <p class="em-error" id="set-password-error" role="alert" hidden></p>
         <div class="acct-actions"><button type="submit" class="btn btn-primary">Save password</button><button type="button" class="link-btn" data-close="password">Cancel</button></div>
       </form>`
    : emailSignIn && user.email
      ? `<div class="set-row"><span class="acct-text"><b>Password</b><span class="muted">Also sign in with ${esc(user.email)}</span></span><button type="button" class="btn" id="set-add-password">Add</button></div>`
      : '';
  const connectedRows = connected
    .map(
      (c) =>
        `<div class="set-row"><span class="acct-text"><b>${esc(c.label)}</b><span class="muted">${esc(c.email || '')}${c.primary ? '' : ''}</span></span>${
          c.primary ? '' : `<button type="button" class="link-btn" data-disconnect="${esc(c.provider)}">Disconnect</button>`
        }</div>`,
    )
    .join('');
  const connectButtons = connectable.length
    ? `<div class="signin set-connect">${signInButtons(connectable, '/me/settings')
        .replace(/\?next=/g, '?connect=1&next=')
        .replace(/Continue with /g, 'Connect ')}</div>`
    : '';

  app.innerHTML = `
    <div class="account set-page">
      <a class="set-back" href="/me" data-link>‹ My polls</a>
      <h1>Account settings</h1>
      <div class="acct-who">
        <span class="acct-avatar" aria-hidden="true">${esc(initial(user))}</span>
        <span class="acct-text"><b>${esc(user.name || user.email || 'Signed in')}</b>${user.name && user.email ? `<span class="muted">${esc(user.email)}</span>` : ''}</span>
      </div>

      <section class="sheet set-section" aria-labelledby="set-h-signin">
        <h2 id="set-h-signin">Sign-in</h2>
        ${passwordRow}${connectedRows}${connectButtons}
      </section>

      <section class="sheet set-section" aria-labelledby="set-h-devices">
        <h2 id="set-h-devices">Devices</h2>
        <div class="set-row"><span class="acct-text"><b>This device</b><span class="muted">${otherSessions ? `And ${otherSessions} ${otherSessions === 1 ? 'other' : 'others'}` : 'The only one signed in'}</span></span>
          ${otherSessions ? '<button type="button" class="btn" id="set-others">Sign out others</button>' : ''}</div>
        <div class="acct-actions"><button type="button" class="btn" id="set-signout">Sign out</button></div>
      </section>

      <section class="sheet set-section" aria-labelledby="set-h-delete">
        <h2 id="set-h-delete">Delete account</h2>
        <p class="muted">Your polls and templates stay, with their links.</p>
        <form class="set-form" id="set-delete" novalidate>
          ${login ? passwordField('set-delete-pw', 'Your password', 'current-password') : ''}
          <p class="em-error" id="set-delete-error" role="alert" hidden></p>
          <button type="submit" class="btn btn-danger">Delete account</button>
        </form>
      </section>
    </div>`;
  wireShow();

  const open = (name, on) => {
    $(`#set-${name}`).hidden = !on;
    const opener = $(`[data-open="${name}"]`);
    if (opener) opener.hidden = on;
    if (on) $(`#set-${name} input:not([hidden])`).focus();
    else opener?.focus();
  };
  app.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => open(b.dataset.open, true)));
  app.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => open(b.dataset.close, false)));

  const run = async (form, id, fn) => {
    const err = errorLine(id);
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    err.hide();
    try {
      await fn();
    } catch (ex) {
      err.show(ex.message);
      button.disabled = false;
    }
  };

  const pwForm = $('#set-password');
  if (pwForm)
    pwForm.onsubmit = (e) => {
      e.preventDefault();
      const current = $('#set-current').value;
      const password = $('#set-new').value;
      if (!current) return errorLine('set-password-error').show('Enter your current password');
      if ([...password].length < MIN) return errorLine('set-password-error').show(`Use at least ${MIN} characters`);
      return run(pwForm, 'set-password-error', async () => {
        await api('me/password', { method: 'POST', body: { current, password } });
        toast('Password changed. Other devices were signed out.');
        renderSettings();
      });
    };

  const emailForm = $('#set-email');
  if (emailForm)
    emailForm.onsubmit = (e) => {
      e.preventDefault();
      const email = $('#set-new-email').value.trim();
      const password = $('#set-email-pw').value;
      if (!email || !$('#set-new-email').checkValidity()) return errorLine('set-email-error').show('Enter the new email address');
      if (!password) return errorLine('set-email-error').show('Enter your password');
      return run(emailForm, 'set-email-error', async () => {
        const res = await api('me/email', { method: 'POST', body: { email, password } });
        emailForm.innerHTML = `<p class="em-note" role="status">We sent a link to <b>${esc(res.email)}</b>. Your email changes once you tap it.</p>`;
      });
    };

  const add = $('#set-add-password');
  if (add)
    add.onclick = async () => {
      add.disabled = true;
      try {
        const res = await api('me/password/link', { method: 'POST', body: {} });
        toast(`Check ${res.email} for a link to add a password`);
      } catch (ex) {
        toast(ex.message);
        add.disabled = false;
      }
    };

  app.querySelectorAll('[data-disconnect]').forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api(`me/identities/${encodeURIComponent(b.dataset.disconnect)}`, { method: 'DELETE' });
          toast('Disconnected');
          renderSettings();
        } catch (ex) {
          toast(ex.message);
        }
      }),
  );

  const others = $('#set-others');
  if (others)
    others.onclick = async () => {
      others.disabled = true;
      try {
        await api('me/sessions/others', { method: 'POST', body: {} });
        toast('Signed out on other devices');
        renderSettings();
      } catch (ex) {
        toast(ex.message);
        others.disabled = false;
      }
    };

  $('#set-signout').onclick = async () => {
    const { signOut } = await import('./account.js');
    await signOut();
    go('/me');
  };

  const del = $('#set-delete');
  let armed = false;
  del.onsubmit = (e) => {
    e.preventDefault();
    const password = $('#set-delete-pw')?.value;
    if (login && !password) return errorLine('set-delete-error').show('Enter your password to delete your account');
    const button = del.querySelector('button[type=submit]');
    // A second press, to be sure.
    if (!armed) {
      armed = true;
      button.textContent = 'Yes, delete my account';
      return;
    }
    return run(del, 'set-delete-error', async () => {
      await api('me', { method: 'DELETE', body: login ? { password } : undefined });
      accountHint(null);
      refreshAccountMenu();
      toast('Account deleted');
      go('/me');
    });
  };
}
