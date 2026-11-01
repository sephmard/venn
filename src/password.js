// Passwords, for people who sign in with their email instead of Google, Microsoft or GitHub.
//
// Stored as PBKDF2-HMAC-SHA256 through Web Crypto, which the Worker and Node both have built in (no
// dependency, no WebAssembly). Cloudflare Workers cap PBKDF2 at 100,000 iterations, so that is the
// count; the stored string names its algorithm and count, so stronger settings can come later and
// older hashes are upgraded the next time their owner signs in (`needsRehash`).
//
// The rules follow NIST SP 800-63B: a minimum length, a generous maximum, no "must contain a symbol"
// rules, pasting and password managers welcome, and a check against passwords already leaked in
// breaches (Have I Been Pwned's range API, which only ever sees the first 5 characters of a SHA-1).

import { ValidationError } from '../public/core.js';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
const ITERATIONS = 100_000;
const ALGORITHM = 'pbkdf2-sha256';
const HIBP_URL = 'https://api.pwnedpasswords.com/range/';
const HIBP_TIMEOUT_MS = 2500;

const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The same password always gives the same bytes, however the keyboard composed its accents. */
const normalized = (password) => enc.encode(String(password).normalize('NFKC'));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', normalized(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** "pbkdf2-sha256$100000$<salt>$<hash>", base64. */
export async function hashPassword(password, { iterations = ITERATIONS } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${ALGORITHM}$${iterations}$${b64(salt)}$${b64(await derive(password, salt, iterations))}`;
}

/** Equal bytes, in time that doesn't depend on where they first differ. */
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password, stored) {
  const [alg, count, salt, hash] = String(stored || '').split('$');
  const iterations = Number(count);
  if (alg !== ALGORITHM || !Number.isInteger(iterations) || iterations < 1 || !salt || !hash) return false;
  try {
    return sameBytes(await derive(password, unb64(salt), iterations), unb64(hash));
  } catch {
    return false;
  }
}

/** True when a stored hash is weaker than what new passwords get. */
export const needsRehash = (stored) => String(stored || '').split('$')[1] !== String(ITERATIONS);

/**
 * A hash to check against when there's no account, so "no such account" takes as long as "wrong
 * password" and the timing doesn't tell which emails have accounts.
 */
let decoy;
export const decoyHash = () => (decoy ??= hashPassword(crypto.randomUUID()));

/** The password if it's allowed, or a ValidationError saying why not (before any breach check). */
export function checkPasswordRules(password, { email } = {}) {
  if (typeof password !== 'string' || !password) throw new ValidationError('Choose a password');
  const length = [...password.normalize('NFKC')].length;
  if (length < PASSWORD_MIN) throw new ValidationError(`Use at least ${PASSWORD_MIN} characters`);
  if (length > PASSWORD_MAX) throw new ValidationError(`Use at most ${PASSWORD_MAX} characters`);
  const lower = password.trim().toLowerCase();
  if (new Set(lower).size < 3) throw new ValidationError('That password is too easy to guess');
  if (email && (lower === email.toLowerCase() || lower === email.toLowerCase().split('@')[0]))
    throw new ValidationError('Don’t use your email as your password');
  if (/^(venn|password|passw0rd|qwerty|letmein|welcome|iloveyou|admin)/.test(lower) && length < 16)
    throw new ValidationError('That password is too easy to guess');
  return password;
}

/**
 * How many times this password appears in known breaches (0 if none), using Have I Been Pwned's
 * k-anonymity range API: only the first 5 hex characters of its SHA-1 leave the server, and padded
 * responses hide which of the ~800 matches was ours. Null if the check couldn't run; then the
 * password is allowed, so an outage never blocks signing up.
 */
export async function breachCount(password, { fetchImpl = fetch, env = {} } = {}) {
  if (env.PWNED_PASSWORDS === 'off') return null;
  try {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', normalized(password)));
    const hex = [...digest]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    const res = await fetchImpl(`${env.PWNED_PASSWORDS_URL || HIBP_URL}${hex.slice(0, 5)}`, {
      headers: { 'add-padding': 'true', 'user-agent': 'Venn' },
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const suffix = hex.slice(5);
    for (const line of (await res.text()).split('\n')) {
      const [s, n] = line.trim().split(':');
      if (s === suffix) return Number(n) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}

/** The rules, then the breach check. Resolves to the password, or throws a ValidationError. */
export async function acceptablePassword(password, { email, fetchImpl, env } = {}) {
  checkPasswordRules(password, { email });
  if ((await breachCount(password, { fetchImpl, env })) > 0)
    throw new ValidationError('That password has appeared in a data breach. Choose another one.');
  return password;
}
