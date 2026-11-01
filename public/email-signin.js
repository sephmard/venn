// Signing in with an email and a password, on the sign-in screen of My polls (account.js), under
// "Continue with Google". Three small forms in one place: sign in, create an account, and a
// forgotten password. Making an account, or resetting a password, ends with "check your inbox":
// the server emails a link (src/email-auth.js), and the page it opens is account-settings.js.

import { $, api, esc } from './ui.js';

const MIN = 10; // src/password.js PASSWORD_MIN

const field = ({ id, label, type, autocomplete, value = '', hint = '' }) => `
  <div class="em-field">
    <label for="${id}">${label}</label>
    ${
      type === 'password'
        ? `<div class="em-pw"><input id="${id}" type="password" autocomplete="${autocomplete}" required minlength="${autocomplete === 'new-password' ? MIN : 1}" maxlength="128"${hint ? ` aria-describedby="${id}-hint"` : ''}><button type="button" class="em-show" aria-controls="${id}" aria-pressed="false">Show</button></div>`
        : `<input id="${id}" type="email" inputmode="email" autocomplete="${autocomplete}" autocapitalize="off" spellcheck="false" required maxlength="254" value="${esc(value)}">`
    }
    ${hint ? `<p class="em-hint" id="${id}-hint">${hint}</p>` : ''}
  </div>`;

const MODES = {
  signin: {
    button: 'Sign in',
    fields: (email) => [
      field({ id: 'em-email', label: 'Email', autocomplete: 'username', value: email }),
      field({ id: 'em-password', label: 'Password', type: 'password', autocomplete: 'current-password' }),
    ],
    links:
      '<button type="button" class="link-btn" data-mode="forgot">Forgot password?</button><button type="button" class="link-btn" data-mode="signup">Create an account</button>',
  },
  signup: {
    button: 'Create account',
    fields: (email) => [
      field({ id: 'em-email', label: 'Email', autocomplete: 'username', value: email }),
      field({
        id: 'em-password',
        label: 'Password',
        type: 'password',
        autocomplete: 'new-password',
        hint: `At least ${MIN} characters`,
      }),
    ],
    links: '<button type="button" class="link-btn" data-mode="signin">I have an account</button>',
  },
  forgot: {
    button: 'Email me a link',
    fields: (email) => [field({ id: 'em-email', label: 'Email', autocomplete: 'username', value: email })],
    links: '<button type="button" class="link-btn" data-mode="signin">Back to sign in</button>',
  },
};

/** The form's place on the sign-in screen. `alone`: no other way to sign in, so no "or". */
export const emailSignInForm = ({ alone = false } = {}) =>
  `<div class="em-signin" id="em-signin">${alone ? '' : '<p class="em-or"><span>or</span></p>'}<div id="em-body"></div></div>`;

/**
 * Make the form work. `onSignedIn` runs once the password signs in. `mode` and `email` start it
 * somewhere else than "Sign in" (after a reset: signing in, with the email filled in).
 */
export function wireEmailSignIn({ onSignedIn, mode = 'signin', email = '', note = '' } = {}) {
  const body = $('#em-body');
  if (!body) return;

  const draw = (m, { keep = true, message = '' } = {}) => {
    const typed = keep ? $('#em-email')?.value.trim() || email : email;
    const spec = MODES[m];
    body.innerHTML = `
      <form class="em-form" novalidate data-mode="${m}">
        ${m === 'forgot' ? '<p class="em-lede">We’ll email you a link to choose a new password.</p>' : ''}
        ${message ? `<p class="em-note" role="status">${esc(message)}</p>` : ''}
        ${spec.fields(typed).join('')}
        <p class="em-error" id="em-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary em-submit">${spec.button}</button>
        <div class="em-links">${spec.links}</div>
      </form>`;
    const form = body.querySelector('form');
    form.querySelectorAll('[data-mode]').forEach(
      (b) =>
        (b.onclick = () => {
          draw(b.dataset.mode, { keep: true });
          focusFirst();
        }),
    );
    form.querySelectorAll('.em-show').forEach(
      (b) =>
        (b.onclick = () => {
          const input = $(`#${b.getAttribute('aria-controls')}`);
          const show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          b.textContent = show ? 'Hide' : 'Show';
          b.setAttribute('aria-pressed', String(show));
        }),
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      submit(m, form);
    };
  };

  const focusFirst = () => {
    const email = $('#em-email');
    (email && !email.value ? email : $('#em-password') || email)?.focus();
  };

  /** Say what's wrong, and put the cursor where it can be fixed. */
  const fail = (message, input) => {
    const el = $('#em-error');
    el.textContent = message;
    el.hidden = false;
    input?.focus();
  };

  async function submit(m, form) {
    const emailInput = $('#em-email');
    const password = $('#em-password')?.value || '';
    const address = emailInput.value.trim();
    if (!address || !emailInput.checkValidity()) return fail('Enter your email address', emailInput);
    if (m !== 'forgot' && !password) return fail('Enter a password', $('#em-password'));
    if (m === 'signup' && [...password].length < MIN) return fail(`Use at least ${MIN} characters`, $('#em-password'));
    const button = form.querySelector('.em-submit');
    button.disabled = true;
    $('#em-error').hidden = true;
    try {
      if (m === 'signin') {
        await api('auth/email/login', { method: 'POST', body: { email: address, password } });
        return onSignedIn?.();
      }
      const res = await api(`auth/email/${m === 'signup' ? 'signup' : 'forgot'}`, {
        method: 'POST',
        body: m === 'signup' ? { email: address, password } : { email: address },
      });
      checkInbox(res.email || address, m);
    } catch (ex) {
      fail(ex.message);
      button.disabled = false;
    }
  }

  function checkInbox(address, m) {
    body.innerHTML = `
      <div class="em-sent" role="status">
        <span class="em-sent-icon" aria-hidden="true">✉️</span>
        <h2>Check your inbox</h2>
        <p>We sent a link to <b>${esc(address)}</b>${m === 'signup' ? ' to finish making your account' : ''}.</p>
        <p class="em-hint">Nothing there? Look in spam, or try again in a minute.</p>
        <button type="button" class="link-btn" data-again>Use a different email</button>
      </div>`;
    body.querySelector('[data-again]').onclick = () => {
      draw(m, { keep: false });
      focusFirst();
    };
    body.querySelector('h2').focus?.();
  }

  draw(mode, { keep: false, message: note });
}
