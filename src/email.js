// Email providers. Venn sends a few transactional emails (confirming an address, and telling an
// organizer that someone answered) through whichever provider the server has set up.
//
// Each provider says whether its settings are present and how to send one message:
//   { to, subject, text, html, headers, replyTo, fromName }  →  resolves when accepted, throws otherwise
// EMAIL_REPLY_TO, when set, is where replies go (a real inbox, so people can write back). A message's
// own `replyTo` wins: a home-page message is answered by replying to whoever sent it.
// To add a provider (Postmark, SES, an SMTP relay behind an HTTP API, ...), add an entry below and
// document its settings in docs/NOTIFICATIONS.md. `EMAIL_PROVIDER` picks one when several are set up.

const TIMEOUT_MS = 5000;

/** "Venn <hi@venn.day>" → { name: 'Venn', email: 'hi@venn.day' }; a bare address stays as it is. */
export function parseAddress(value) {
  const m = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(value || '');
  return m ? { name: m[1].replace(/^"|"$/g, ''), email: m[2].trim() } : String(value || '').trim();
}

/**
 * The organization's part of a white-label email's sender name: the template's name, made safe
 * for a From header (see below for what goes; at most 64 characters). Empty when nothing usable
 * is left. The address stays EMAIL_FROM's own, so the sending domain is never anyone's but the
 * server's.
 */
export function cleanFromName(name) {
  const clean = String(name || '')
    // Control characters (C0 and C1), bidi overrides and zero-width characters, quotes, angle
    // brackets, backslashes and @: nothing that can break the header, hide what the name says, or
    // make it look like an address. And no encoded-word start (=?), so the name can't decode to
    // something else in a mail app.
    // eslint-disable-next-line no-control-regex -- control characters are exactly what goes
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff"<>\\@]/g, ' ')
    .replace(/=\?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, 64).join('').trim(); // whole characters, never half an emoji
}

/**
 * EMAIL_FROM, with the organization's name put in front of the server's own: "Acme via Venn".
 * Anyone can make a template with any name, so the server's name always stays in the sender, the
 * pattern calendar and ticketing services use when they send on someone's behalf. As { name, email }.
 */
export function fromAddress(env, fromName) {
  const from = parseAddress(env.EMAIL_FROM);
  const email = typeof from === 'string' ? from : from.email;
  const own = (typeof from === 'string' ? '' : cleanFromName(from.name)) || 'Venn';
  // At most 40 characters of it, so "via Venn" still shows in a phone's inbox.
  const name = Array.from(cleanFromName(fromName)).slice(0, 40).join('').trim();
  if (name) return { name: `${name} via ${own}`, email };
  return typeof from === 'string' ? { name: '', email } : from;
}

const fromHeader = ({ name, email }) => (name ? `"${name}" <${email}>` : email);

export const EMAIL_PROVIDERS = [
  {
    // Cloudflare Email Sending, through a `send_email` binding named EMAIL. No API key needed.
    name: 'cloudflare',
    configured: (env) => typeof env.EMAIL?.send === 'function',
    async send(env, { to, subject, text, html, headers, replyTo: own, fromName }) {
      const replyTo = (own || env.EMAIL_REPLY_TO) && parseAddress(own || env.EMAIL_REPLY_TO);
      const named = fromName && fromAddress(env, fromName);
      const from = named ? (named.name ? named : named.email) : parseAddress(env.EMAIL_FROM);
      await env.EMAIL.send({ from, ...(replyTo && { replyTo }), to, subject, text, html, headers });
    },
  },
  {
    // Resend (resend.com), over HTTPS. Works on Cloudflare and on the Node server.
    name: 'resend',
    configured: (env) => Boolean(env.RESEND_API_KEY),
    async send(env, { to, subject, text, html, headers, replyTo, fromName }, { fetchImpl }) {
      // RESEND_API_URL is for the browser tests' stand-in (e2e/fake-oauth.js); nothing else sets it.
      const res = await fetchImpl(`${env.RESEND_API_URL || 'https://api.resend.com'}/emails`, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: fromName ? fromHeader(fromAddress(env, fromName)) : env.EMAIL_FROM,
          ...((replyTo || env.EMAIL_REPLY_TO) && { reply_to: replyTo || env.EMAIL_REPLY_TO }),
          to: [to],
          subject,
          text,
          html,
          headers,
        }),
      });
      if (!res.ok) throw new Error(`Email service responded with ${res.status}`);
    },
  },
];

/** The provider to send with: the one named by EMAIL_PROVIDER, or the first that's set up. Null when email is off. */
export function emailProvider(env, providers = EMAIL_PROVIDERS) {
  if (!env.EMAIL_FROM) return null;
  const wanted = env.EMAIL_PROVIDER?.trim().toLowerCase();
  return providers.find((p) => (!wanted || p.name === wanted) && p.configured(env)) || null;
}

export async function sendEmail(env, message, { fetchImpl, providers } = {}) {
  const provider = emailProvider(env, providers);
  if (!provider) throw new Error('Email is not set up');
  await provider.send(env, message, { fetchImpl });
}
