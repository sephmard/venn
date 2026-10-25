// Notifications when people respond to a poll: email (via Resend) and webhooks.
// Everything here runs after the response is saved, so failures never affect the person answering.

import { ValidationError, buildSlots, rankTimes } from '../public/core.js';

const TIMEOUT_MS = 5000;
// Don't email the organizer again about the same person editing their answer within this window.
const EDIT_EMAIL_COOLDOWN_MS = 10 * 60_000;
// Confirmation emails per poll, so a poll can't be used to spam someone's inbox.
export const MAX_CONFIRMATIONS = 3;
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export const emailEnabled = (env) => Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);

export function normalizeEmail(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new ValidationError('Invalid email address');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new ValidationError('Invalid email address');
  return email;
}

// ---------- webhook URL safety ----------

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(ip) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v6.startsWith('::ffff:')) return isPrivateIPv4(v6.slice(7));
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/**
 * Only allow public HTTPS endpoints, so a poll can't be used to make the server
 * call internal services. `resolveHost` (Node only) checks what the name points to.
 */
export async function validateWebhookUrl(value, { resolveHost } = {}) {
  if (value == null || value === '') return null;
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new ValidationError('Webhook URL is not a valid URL');
  }
  if (url.protocol !== 'https:') throw new ValidationError('Webhook URL must start with https://');
  if (url.username || url.password) throw new ValidationError('Webhook URL must not contain a username or password');
  if (url.port && url.port !== '443') throw new ValidationError('Webhook URL must use the standard HTTPS port');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || !host.includes('.'))
    throw new ValidationError('Webhook URL must be a public address');
  const literal = host.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(literal) || literal.includes(':')) {
    if (isPrivateAddress(literal)) throw new ValidationError('Webhook URL must be a public address');
  } else if (resolveHost) {
    let addresses;
    try {
      addresses = await resolveHost(host);
    } catch {
      throw new ValidationError("Webhook URL's host could not be found");
    }
    if (!addresses.length || addresses.some(isPrivateAddress)) throw new ValidationError('Webhook URL must be a public address');
  }
  if (url.href.length > 2000) throw new ValidationError('Webhook URL is too long');
  return url.href;
}

// ---------- messages ----------

function fmtWhen(start, end, tz) {
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }).format(start);
  const t = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const zone =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(start)
      .find((p) => p.type === 'timeZoneName')?.value || tz;
  return `${day}, ${t.format(start)} – ${t.format(end)} ${zone}`;
}

const VERBS = {
  'response.created': 'responded to',
  'response.updated': 'updated their answers to',
  'response.deleted': 'removed their response from',
};

/** Everything a notification needs, independent of the channel. */
export function buildSummary(ev, participants, { kind, name, origin, now }) {
  const best = rankTimes(ev, buildSlots(ev), participants, 1)[0] || null;
  return {
    event: kind,
    sentAt: new Date(now).toISOString(),
    poll: {
      id: ev.id,
      title: ev.title,
      url: `${origin}/e/${ev.id}`,
      responses: participants.length,
      finalStart: ev.finalStart == null ? null : new Date(ev.finalStart).toISOString(),
    },
    response: name == null ? null : { name },
    bestTime: best && {
      start: new Date(best.start).toISOString(),
      end: new Date(best.end).toISOString(),
      available: best.yes.length,
      ifNeeded: best.ifNeeded.length,
      label: fmtWhen(best.start, best.end, ev.timezone),
    },
  };
}

export function summaryText(s) {
  const who = s.response ? `${s.response.name} ${VERBS[s.event] || 'responded to'}` : 'Test notification for';
  let text = `${who} “${s.poll.title}”.`;
  if (s.bestTime) {
    const can = s.bestTime.available + s.bestTime.ifNeeded;
    text += ` Best time so far: ${s.bestTime.label} (${can} of ${s.poll.responses} can make it).`;
  } else if (s.poll.responses === 0) text += ' No responses yet.';
  return text;
}

const escHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function emailLayout(bodyHtml, footerHtml) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1d1f">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e2dc;border-radius:10px;padding:24px">
<div style="font-weight:700;font-size:18px;margin-bottom:16px">Venn</div>${bodyHtml}</div>
<p style="max-width:520px;margin:12px auto 0;color:#6b6d70;font-size:12px;line-height:1.5">${footerHtml}</p></body></html>`;
}

const button = (href, label) =>
  `<p style="margin:20px 0"><a href="${escHtml(href)}" style="display:inline-block;background:#0f9d76;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">${escHtml(label)}</a></p>`;

export function responseEmail(s, unsubscribeUrl) {
  const subject = s.response
    ? `${s.response.name} ${VERBS[s.event] || 'responded to'} “${s.poll.title}”`
    : `Test notification for “${s.poll.title}”`;
  const text = `${summaryText(s)}\n\nSee all responses: ${s.poll.url}\n\nStop these emails: ${unsubscribeUrl}\n`;
  const html = emailLayout(
    `<p style="margin:0;line-height:1.5">${escHtml(summaryText(s))}</p>${button(s.poll.url, 'See all responses')}`,
    `You get these emails because you asked to be notified about this poll. <a href="${escHtml(unsubscribeUrl)}" style="color:#6b6d70">Stop these emails</a>.`,
  );
  return { subject, text, html };
}

export function confirmationEmail(title, confirmUrl) {
  const subject = `Confirm notifications for “${title}”`;
  const text = `Someone (hopefully you) asked Venn to email this address when people respond to the poll “${title}”.\n\nConfirm: ${confirmUrl}\n\nIf this wasn't you, ignore this email and nothing more will be sent.\n`;
  const html = emailLayout(
    `<p style="margin:0;line-height:1.5">Someone (hopefully you) asked Venn to email this address when people respond to the poll <strong>${escHtml(title)}</strong>.</p>${button(confirmUrl, 'Confirm notifications')}`,
    "If this wasn't you, ignore this email and nothing more will be sent.",
  );
  return { subject, text, html };
}

// ---------- delivery ----------

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Slack and Discord incoming webhooks expect their own simple formats. */
export function webhookBody(url, s) {
  const host = new URL(url).hostname;
  const text = `${summaryText(s)} ${s.poll.url}`;
  if (host === 'hooks.slack.com') return { text };
  if (/(^|\.)discord(app)?\.com$/.test(host) && new URL(url).pathname.startsWith('/api/webhooks')) return { content: text };
  return s;
}

export async function sendWebhook(url, secret, s, { fetchImpl, now }) {
  const body = JSON.stringify(webhookBody(url, s));
  const timestamp = String(Math.floor(now / 1000));
  const res = await fetchImpl(url, {
    method: 'POST',
    redirect: 'manual', // never follow a redirect to somewhere else
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Venn-Webhook/1.0',
      'x-venn-event': s.event,
      'x-venn-timestamp': timestamp,
      'x-venn-signature': `sha256=${await hmacHex(secret, `${timestamp}.${body}`)}`,
    },
    body,
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status };
}

export async function sendEmail(env, { to, subject, text, html, headers }, { fetchImpl }) {
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, html, headers }),
  });
  if (!res.ok) throw new Error(`Email service responded with ${res.status}`);
}

/** Send whatever the organizer has set up for this poll. Never throws. */
export async function notifyResponse({ store, env, fetchImpl, now, origin, ev, kind, participantId, name }) {
  try {
    const settings = await store.getNotify(ev.id);
    if (!settings || (!settings.webhookUrl && !(settings.email && settings.emailConfirmed))) return;
    const participants = await store.listParticipants(ev.id);
    const s = buildSummary(ev, participants, { kind, name, origin, now: now() });
    const delivery = { ...(settings.lastDelivery || {}) };
    const emailedAt = { ...(settings.emailedAt || {}) };

    const jobs = [];
    if (settings.webhookUrl) {
      jobs.push(
        sendWebhook(settings.webhookUrl, settings.webhookSecret, s, { fetchImpl, now: now() })
          .then((r) => (delivery.webhook = { at: now(), ok: r.ok, status: r.status }))
          .catch(
            (e) =>
              (delivery.webhook = { at: now(), ok: false, error: e.name === 'TimeoutError' ? 'Timed out' : 'Could not connect' }),
          ),
      );
    }
    const recentlyEmailed = kind === 'response.updated' && now() - (emailedAt[participantId] || 0) < EDIT_EMAIL_COOLDOWN_MS;
    if (settings.email && settings.emailConfirmed && emailEnabled(env) && !recentlyEmailed) {
      const unsubscribeUrl = `${origin}/e/${ev.id}#unsubscribe=${settings.unsubscribeToken}`;
      const msg = responseEmail(s, unsubscribeUrl);
      jobs.push(
        sendEmail(env, { to: settings.email, ...msg, headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` } }, { fetchImpl })
          .then(() => {
            delivery.email = { at: now(), ok: true };
            emailedAt[participantId] = now();
          })
          .catch(() => (delivery.email = { at: now(), ok: false, error: 'Email service error' })),
      );
    }
    await Promise.all(jobs);
    // Re-read so concurrent changes to the settings aren't overwritten.
    const latest = await store.getNotify(ev.id);
    if (latest) await store.setNotify(ev.id, { ...latest, lastDelivery: delivery, emailedAt });
  } catch (e) {
    console.error('notification failed', e);
  }
}
