// Notifications when people respond to a poll: email (through a provider in email.js) and webhooks.
// Everything here runs after the response is saved, so failures never affect the person answering.

import {
  IF_NEEDED,
  ValidationError,
  YES,
  allDaySpan,
  buildSlots,
  eventWindows,
  isOptionsPoll,
  rankTimes,
} from '../public/core.js';
import { emailProvider, sendEmail } from './email.js';

export { sendEmail };

const TIMEOUT_MS = 5000;
// Don't email the organizer again about the same person editing their answer within this window.
const EDIT_EMAIL_COOLDOWN_MS = 10 * 60_000;
// Emails to the organizer per poll. There's no confirmation step, so this keeps a poll from being
// used to flood someone else's inbox; every email also has a link to stop them.
export const MAX_ORGANIZER_EMAILS = 200;
// Copies of an answer emailed to the person who gave it. Someone could type another person's
// address, so each answer gets a few copies at most, and each poll a bounded number.
export const MAX_COPIES_PER_ANSWER = 3;
export const MAX_COPIES_PER_POLL = 300;
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export const emailEnabled = (env) => emailProvider(env) != null;

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

// Venn's dog, shown in every notification. Served from the instance's own public/ folder, so it
// works for anyone hosting Venn; links in emails need the absolute URL.
export const MASCOT_PATH = '/img/venn-dog.png';
const mascotUrl = (pageUrl) => new URL(MASCOT_PATH, pageUrl).href;

function emailLayout(bodyHtml, footerHtml, pageUrl) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1d1f">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e2dc;border-radius:10px;padding:24px">
<div style="text-align:center;margin-bottom:12px"><img src="${escHtml(mascotUrl(pageUrl))}" width="80" height="174" alt="" style="display:inline-block;border:0"></div>
<div style="font-weight:700;font-size:18px;margin-bottom:16px">Venn</div>${bodyHtml}</div>
<p style="max-width:520px;margin:12px auto 0;color:#6b6d70;font-size:12px;line-height:1.5">${footerHtml}</p></body></html>`;
}

const button = (href, label) =>
  `<p style="margin:20px 0"><a href="${escHtml(href)}" style="display:inline-block;background:#0b7a5c;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:999px">${escHtml(label)}</a></p>`;

const heading = (html) => `<p style="margin:0 0 8px;font-size:22px;font-weight:700;line-height:1.3">${html}</p>`;
const para = (html) => `<p style="margin:0 0 12px;line-height:1.5">${html}</p>`;
/** The link itself, under its button, for anyone who wants to copy or forward it. */
const linkLine = (href) =>
  `<p style="margin:-8px 0 16px;font-size:13px;line-height:1.5;word-break:break-all"><a href="${escHtml(href)}" style="color:#0b7a5c">${escHtml(href)}</a></p>`;
const stopFooter = (unsubscribeUrl) =>
  `You get these emails because you asked Venn to tell you about this poll. <a href="${escHtml(unsubscribeUrl)}" style="color:#6b6d70">Stop these emails</a>.`;

/** To the organizer, the moment their poll exists: well done, and here's the link to share. */
export function pollReadyEmail({ title, pollUrl, unsubscribeUrl }) {
  const subject = `Your poll “${title}” is ready 🎉`;
  const text = `Your poll “${title}” is ready!\n\nWe're so proud of you for bringing people together. Here's the link to share with everyone:\n\n${pollUrl}\n\nWe'll email you here whenever someone answers.\n\nStop these emails: ${unsubscribeUrl}\n`;
  const html = emailLayout(
    `${heading('Your poll is ready! 🎉')}${para(
      `We're so proud of you for bringing people together. Here's the link to <strong>${escHtml(title)}</strong>. Share it with everyone:`,
    )}${button(pollUrl, 'Open your poll')}${linkLine(pollUrl)}${para("We'll email you here whenever someone answers.")}`,
    stopFooter(unsubscribeUrl),
    pollUrl,
  );
  return { subject, text, html };
}

/** To the organizer, each time someone answers: who it was, the best time so far, and the poll. */
export function responseEmail(s, unsubscribeUrl) {
  const name = s.response?.name;
  const isNew = s.event === 'response.created';
  const subject = !name
    ? `Test notification for “${s.poll.title}”`
    : isNew
      ? `🎉 ${name} just answered “${s.poll.title}”`
      : `${name} ${VERBS[s.event] || 'responded to'} “${s.poll.title}”`;
  const lead = !name
    ? `This is a test notification for “${s.poll.title}”.`
    : isNew
      ? `${name} just answered “${s.poll.title}”. We're fired up: your plans are coming together!`
      : `${name} ${VERBS[s.event] || 'responded to'} “${s.poll.title}”.`;
  const can = s.bestTime && s.bestTime.available + s.bestTime.ifNeeded;
  const best = s.bestTime
    ? `Best time so far: ${s.bestTime.label} (${can} of ${s.poll.responses} can make it).`
    : s.poll.responses
      ? ''
      : 'No answers yet.';
  const text = `${lead}${best ? `\n\n${best}` : ''}\n\nSee everyone's answers: ${s.poll.url}\n\nStop these emails: ${unsubscribeUrl}\n`;
  const headline = name && isNew ? heading(`${escHtml(name)} just answered! 🎉`) : '';
  const html = emailLayout(
    `${headline}${para(escHtml(lead))}${best ? para(escHtml(best)) : ''}${button(s.poll.url, "See everyone's answers")}${linkLine(s.poll.url)}`,
    stopFooter(unsubscribeUrl),
    s.poll.url,
  );
  return { subject, text, html };
}

/** "Sat, Nov 7, 7:00 PM – 9:00 PM EST" or "Fri, Nov 6 – Sun, Nov 8", for one window of a poll. */
function windowLabel(start, end, tz) {
  const span = allDaySpan(start, end, tz);
  if (!span) return fmtWhen(start, end, tz);
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const first = Date.parse(`${span.startDate}T00:00:00Z`);
  const last = Date.parse(`${span.endDate}T00:00:00Z`) - 86_400_000;
  return first === last ? `${day.format(first)}, all day` : `${day.format(first)} – ${day.format(last)}`;
}

/** Someone's answers in words, grouped: [{ label, answer: 'yes' | 'if needed' }]. Hours next to each other merge. */
export function answerLines(ev, availability) {
  const out = [];
  let run = null;
  for (const w of eventWindows(ev)) {
    const v = availability[w.start];
    if (v !== YES && v !== IF_NEEDED) {
      run = null;
      continue;
    }
    if (run && run.v === v && run.end === w.start && !isOptionsPoll(ev)) run.end = w.end;
    else out.push((run = { v, start: w.start, end: w.end }));
  }
  return out.map((r) => ({ label: windowLabel(r.start, r.end, ev.timezone), answer: r.v === YES ? 'yes' : 'if needed' }));
}

/**
 * A copy of someone's answer, for them: what they said, their own link to see and change it, and
 * the poll. `seeAnswers` is false when the organizer hides everyone's answers.
 */
export function answerCopyEmail({ title, name, lines, pollUrl, editUrl, seeAnswers = true }) {
  const subject = `Your answer to “${title}”`;
  const list = lines.length ? lines : null;
  const pollLabel = seeAnswers ? "See everyone's answers" : 'Open the poll';
  const text = `Hi ${name}, here's what you told Venn for “${title}”:\n\n${
    list ? list.map((l) => `- ${l.label}: ${l.answer}`).join('\n') : 'None of these work.'
  }\n\nYour answer (open it to change it): ${editUrl}\nThis link is just for you, so don't share it.\n\n${pollLabel}: ${pollUrl}\n\nYou asked for this copy when you answered. If that wasn't you, ignore this email.\n`;
  const items = list
    ? `<ul style="margin:12px 0;padding-left:20px;line-height:1.6">${list
        .map((l) => `<li>${escHtml(l.label)}: <strong>${escHtml(l.answer)}</strong></li>`)
        .join('')}</ul>`
    : para('None of these work.');
  const html = emailLayout(
    `${para(`Hi ${escHtml(name)}, here's what you told Venn for <strong>${escHtml(title)}</strong>:`)}${items}${button(
      editUrl,
      'View or change your answer',
    )}${linkLine(editUrl)}${para("This link is just for you, so don't share it.")}${para(
      `<a href="${escHtml(pollUrl)}" style="color:#0b7a5c">${pollLabel}</a>`,
    )}`,
    "You asked for this copy when you answered the poll. If that wasn't you, ignore this email and nothing more will be sent.",
    pollUrl,
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

/** Slack and Discord incoming webhooks expect their own formats: a message, with the dog beside it. */
export function webhookBody(url, s) {
  const host = new URL(url).hostname;
  const text = `${summaryText(s)} ${s.poll.url}`;
  const image = mascotUrl(s.poll.url);
  if (host === 'hooks.slack.com') {
    const mrkdwn = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    return {
      text,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: mrkdwn },
          accessory: { type: 'image', image_url: image, alt_text: 'Venn' },
        },
      ],
    };
  }
  if (/(^|\.)discord(app)?\.com$/.test(host) && new URL(url).pathname.startsWith('/api/webhooks'))
    return { content: text, embeds: [{ title: s.poll.title, url: s.poll.url, thumbnail: { url: image } }] };
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

/** Send whatever the organizer has set up for this poll. Never throws. */
export async function notifyResponse({ store, env, fetchImpl, now, origin, ev, kind, participantId, name }) {
  try {
    const settings = await store.getNotify(ev.id);
    if (!settings || (!settings.webhookUrl && !settings.email)) return;
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
    let emailsSent = settings.emailsSent || 0;
    if (settings.email && emailEnabled(env) && !recentlyEmailed && emailsSent < MAX_ORGANIZER_EMAILS) {
      const unsubscribeUrl = `${origin}/e/${ev.id}#unsubscribe=${settings.unsubscribeToken}`;
      const msg = responseEmail(s, unsubscribeUrl);
      jobs.push(
        sendEmail(env, { to: settings.email, ...msg, headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` } }, { fetchImpl })
          .then(() => {
            delivery.email = { at: now(), ok: true };
            emailedAt[participantId] = now();
            emailsSent += 1;
          })
          .catch(() => (delivery.email = { at: now(), ok: false, error: 'Email service error' })),
      );
    }
    await Promise.all(jobs);
    // Re-read so concurrent changes to the settings aren't overwritten.
    const latest = await store.getNotify(ev.id);
    if (latest) await store.setNotify(ev.id, { ...latest, lastDelivery: delivery, emailedAt, emailsSent });
  } catch (e) {
    console.error('notification failed', e);
  }
}
