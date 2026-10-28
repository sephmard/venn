// Feature requests and "Contact us" from the home page, emailed to the inbox in EMAIL_REPLY_TO.
// Nothing is stored: the message goes out in one email, with the sender's address (if they gave
// one) as Reply-To so the reply goes straight to them. Needs email to be set up and EMAIL_REPLY_TO.

import { ValidationError } from '../public/core.js';
import { parseAddress } from './email.js';
import { emailEnabled, escHtml, normalizeEmail } from './notify.js';

export const CONTACT_KINDS = { feature: 'Feature request', contact: 'Message' };
export const MAX_CONTACT_LENGTH = 2000;

export const contactEnabled = (env) => emailEnabled(env) && Boolean(env.EMAIL_REPLY_TO);

/** The inbox the messages go to: EMAIL_REPLY_TO's address. */
export const contactInbox = (env) => {
  const a = parseAddress(env.EMAIL_REPLY_TO);
  return typeof a === 'string' ? a : a.email;
};

/** { kind, message, email } from the form, checked. A reply needs an address, so "Contact us" asks for one. */
export function normalizeContact(body) {
  const kind = body?.kind;
  if (!Object.hasOwn(CONTACT_KINDS, kind)) throw new ValidationError('Choose a feature request or a message');
  if (typeof body.message !== 'string') throw new ValidationError('Write a message');
  const message = body.message.trim();
  if (message.length < 3) throw new ValidationError('Write a message');
  if (message.length > MAX_CONTACT_LENGTH) throw new ValidationError(`Keep it under ${MAX_CONTACT_LENGTH} characters`);
  const email = normalizeEmail(body.email);
  if (kind === 'contact' && !email) throw new ValidationError('Add your email so we can reply');
  return { kind, message, email };
}

export function contactEmail({ kind, message, email }, origin) {
  const first = message.split('\n')[0];
  const subject = `${CONTACT_KINDS[kind]}: ${first.length > 60 ? `${first.slice(0, 57)}…` : first}`;
  const from = email ? `From: ${email} (reply to this email to answer)` : 'No email given, so there is no one to reply to.';
  const text = `${CONTACT_KINDS[kind]} sent from ${origin}\n${from}\n\n${message}\n`;
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1d1f;line-height:1.5">
<p style="margin:0 0 4px;font-weight:700">${escHtml(CONTACT_KINDS[kind])} sent from ${escHtml(origin)}</p>
<p style="margin:0 0 16px;color:#55585c">${escHtml(from)}</p>
<p style="margin:0;white-space:pre-wrap">${escHtml(message)}</p></body></html>`;
  return { subject, text, html, ...(email && { replyTo: email }) };
}

/** At most CONTACT_RATE_LIMIT (default 3) messages an hour per IP, or Cloudflare's rate limiting binding. */
export async function allowContactRequest(env, ip, now, windows) {
  if (env.CONTACT_RATE_LIMITER) return (await env.CONTACT_RATE_LIMITER.limit({ key: ip || 'unknown' })).success;
  const limit = Number(env.CONTACT_RATE_LIMIT) || 3;
  const key = ip || 'unknown';
  const recent = (windows.get(key) || []).filter((t) => now - t < 3_600_000);
  if (recent.length >= limit) return false;
  recent.push(now);
  windows.set(key, recent);
  if (windows.size > 10_000) windows.clear();
  return true;
}
