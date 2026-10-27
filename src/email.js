// Email providers. Venn sends a few transactional emails (confirming an address, and telling an
// organizer that someone answered) through whichever provider the server has set up.
//
// Each provider says whether its settings are present and how to send one message:
//   { to, subject, text, html, headers }  →  resolves when accepted, throws otherwise
// EMAIL_REPLY_TO, when set, is where replies go (a real inbox, so people can write back).
// To add a provider (Postmark, SES, an SMTP relay behind an HTTP API, ...), add an entry below and
// document its settings in docs/NOTIFICATIONS.md. `EMAIL_PROVIDER` picks one when several are set up.

const TIMEOUT_MS = 5000;

/** "Venn <hi@venn.day>" → { name: 'Venn', email: 'hi@venn.day' }; a bare address stays as it is. */
export function parseAddress(value) {
  const m = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(value || '');
  return m ? { name: m[1].replace(/^"|"$/g, ''), email: m[2].trim() } : String(value || '').trim();
}

export const EMAIL_PROVIDERS = [
  {
    // Cloudflare Email Sending, through a `send_email` binding named EMAIL. No API key needed.
    name: 'cloudflare',
    configured: (env) => typeof env.EMAIL?.send === 'function',
    async send(env, { to, subject, text, html, headers }) {
      const replyTo = env.EMAIL_REPLY_TO && parseAddress(env.EMAIL_REPLY_TO);
      await env.EMAIL.send({ from: parseAddress(env.EMAIL_FROM), ...(replyTo && { replyTo }), to, subject, text, html, headers });
    },
  },
  {
    // Resend (resend.com), over HTTPS. Works on Cloudflare and on the Node server.
    name: 'resend',
    configured: (env) => Boolean(env.RESEND_API_KEY),
    async send(env, { to, subject, text, html, headers }, { fetchImpl }) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          ...(env.EMAIL_REPLY_TO && { reply_to: env.EMAIL_REPLY_TO }),
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
