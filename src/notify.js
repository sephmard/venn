// Notifications when people respond to a poll: email (through a provider in email.js) and webhooks.
// Everything here runs after the response is saved, so failures never affect the person answering.

import {
  IF_NEEDED,
  ValidationError,
  YES,
  allDaySpan,
  buildSlots,
  eventWindows,
  isEmail,
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

export const emailEnabled = (env) => emailProvider(env) != null;

export function normalizeEmail(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new ValidationError('Invalid email address');
  const email = value.trim().toLowerCase();
  if (!isEmail(email)) throw new ValidationError('Invalid email address');
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

export const escHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Venn's dog, shown in every notification. Served from the instance's own public/ folder, so it
// works for anyone hosting Venn; links in emails need the absolute URL.
export const MASCOT_PATH = '/img/venn-dog.png';
const mascotUrl = (pageUrl) => new URL(MASCOT_PATH, pageUrl).href;

/** `signed`: end with "Planned with Venn… make your own", for guests. Organizers already use Venn. */
function emailLayout(bodyHtml, footerHtml, pageUrl, { signed = true } = {}) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1d1f">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e2dc;border-radius:10px;padding:24px">
<div style="text-align:center;margin-bottom:12px"><img src="${escHtml(mascotUrl(pageUrl))}" width="80" height="174" alt="Finn, the Venn dog" style="display:inline-block;border:0"></div>
<div style="font-weight:700;font-size:18px;margin-bottom:16px">Venn</div>${bodyHtml}</div>
<p style="max-width:520px;margin:12px auto 0;color:#6b6d70;font-size:12px;line-height:1.5">${footerHtml}</p>
${signed ? `<p style="max-width:520px;margin:8px auto 0;color:#6b6d70;font-size:12px;line-height:1.5">${signature(pageUrl, true)}</p>` : ''}</body></html>`;
}

/** "Planned with Venn", at the end of every email and calendar event: how the next organizer finds it. */
export function signature(pageUrl, html = false) {
  const site = new URL(pageUrl).origin;
  const make = `${site}/new?from=email`; // for usage stats: new polls that came from an email
  return html
    ? `Planned with Venn. No sign-up needed: <a href="${escHtml(make)}" style="color:#6b6d70">make your own</a>.`
    : `Planned with Venn. No sign-up needed: make your own at ${make}`;
}

const button = (href, label) =>
  `<p style="margin:20px 0"><a href="${escHtml(href)}" style="display:inline-block;background:#0b7a5c;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:999px">${escHtml(label)}</a></p>`;

const heading = (html) => `<p style="margin:0 0 8px;font-size:22px;font-weight:700;line-height:1.3">${html}</p>`;
const para = (html) => `<p style="margin:0 0 12px;line-height:1.5">${html}</p>`;
/** The link itself, under its button, for anyone who wants to copy or forward it. */
const linkLine = (href) =>
  `<p style="margin:-8px 0 16px;font-size:13px;line-height:1.5;word-break:break-all"><a href="${escHtml(href)}" style="color:#0b7a5c">${escHtml(href)}</a></p>`;
const smsBody = (title, pollUrl) => `When works for you? “${title}”: ${pollUrl}`;

/**
 * The sms: link that opens the phone's messages with `body` filled in: Apple's devices want
 * "sms:&body=", others "sms:?body=".
 */
export function smsHref(body, userAgent = '') {
  const apple = /iPhone|iPad|iPod|Macintosh/.test(userAgent);
  return `sms:${apple ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

/**
 * For email apps that take the "Text message" button's sms: link out (Gmail): a page on Venn's site
 * (GET /api/events/:id/sms) with a button that opens the phone's messages with the poll's link in.
 * The organizer taps it, rather than the page opening Messages by itself, so iPhones don't ask
 * "Open this page in Messages?" first. Only ever the poll's own title and link, so the page can't
 * be made to say anything else.
 */
export function smsPage({ title, pollUrl, userAgent }) {
  const body = smsBody(title, pollUrl);
  const href = escHtml(smsHref(body, userAgent));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Text the poll · Venn</title></head>
<body style="margin:0;padding:32px 16px;background:#faf8f4;color:#16181a;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<main style="max-width:480px;margin:0 auto"><h1 style="margin:0 0 8px;font-size:24px">Text the poll</h1>
<p style="margin:0 0 20px;color:#55585c">Your messages open with the poll's link filled in.</p>
<p style="margin:0 0 24px"><a href="${href}" style="display:block;min-height:52px;box-sizing:border-box;padding:14px 22px;border-radius:999px;background:#0b7a5c;color:#fff;font-size:18px;font-weight:600;text-align:center;text-decoration:none">Open Messages</a></p>
<p style="margin:0 0 6px;color:#55585c">Or copy this and send it however you like:</p>
<p style="margin:0 0 24px;padding:12px 14px;border:1px solid #e4dfd4;border-radius:12px;background:#fff;word-break:break-word">${escHtml(body)}</p>
<p style="margin:0"><a href="${escHtml(pollUrl)}" style="color:#0b7a5c">Back to the poll</a></p></main></body></html>`;
}

const sharePill = (href, label) =>
  `<a href="${escHtml(href)}" style="display:inline-block;margin:0 6px 8px 0;padding:10px 16px;border:1.5px solid #0b7a5c;border-radius:999px;color:#0b7a5c;text-decoration:none;font-weight:600">${escHtml(label)}</a>`;
/**
 * The poll's link in a box, to copy and send on. An email can't run a copy button, so it's the
 * link itself, easy to press and hold (or select whole) and copy. Few links keep emails out of spam.
 */
const copyBox = (href, lead = 'Copy link') =>
  `<p style="margin:16px 0 6px;font-weight:700">${escHtml(lead)}</p><p style="margin:0 0 16px;padding:12px 14px;border:1px solid #e2e2dc;border-radius:8px;background:#f7f7f5;font-size:15px;line-height:1.4;word-break:break-all;-webkit-user-select:all;user-select:all"><a href="${escHtml(href)}" style="color:#1c1d1f;text-decoration:none">${escHtml(href)}</a></p>`;
/**
 * Where a mail app's own unsubscribe button goes. Gmail and Yahoo expect it on every email, with
 * one-click support (RFC 8058): the app POSTs straight to it. Opened as a link (GET), it only
 * leads to the poll page, which asks the server to stop, so link scanners can't unsubscribe anyone.
 * `token` is the organizer's unsubscribe token, or a guest's "participantId.token".
 */
export const unsubscribeLink = (origin, eventId, token) =>
  `${origin}/api/events/${eventId}/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
export const unsubscribeHeaders = (url) => ({
  'List-Unsubscribe': `<${url}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

const stopFooter = (unsubscribeUrl) =>
  `You get these emails because you asked Venn to tell you about this poll. <a href="${escHtml(unsubscribeUrl)}" style="color:#6b6d70">Stop these emails</a>.`;

/** To the organizer, the moment their poll exists: well done, and here's the link to share. */
export function pollReadyEmail({ title, pollUrl, unsubscribeUrl }) {
  const subject = `Your poll “${title}” is ready 🎉`;
  const text = `Your poll “${title}” is ready!\n\nFinn is so proud of you for bringing people together. Here's the link to share with everyone:\n\n${pollUrl}\n\nCopy it into your group chat, or send it by text or email.\n\nWe'll email you here whenever someone answers.\n\nStop these emails: ${unsubscribeUrl}\n`;
  const html = emailLayout(
    `${heading('Your poll is ready! 🎉')}${para(
      `Finn is so proud of you for bringing people together. Share <strong>${escHtml(title)}</strong> with everyone:`,
    )}${button(pollUrl, 'Open your poll')}${copyBox(pollUrl, 'Copy link to share')}${para("We'll email you here whenever someone answers.")}`,
    stopFooter(unsubscribeUrl),
    pollUrl,
    { signed: false },
  );
  return { subject, text, html };
}

/**
 * To everyone who answered with their email, once the organizer picks the date: it's happening, and
 * one tap to put it in their calendar. `when` is the date in the poll's time zone (src/preview.js).
 */
export function dateSetEmail({ title, when, location, pollUrl, calendars }) {
  const subject = `It's happening: ${title}, ${when} 🎉`;
  const where = location ? `\nWhere: ${location}` : '';
  let text = `It's happening! “${title}” is on ${when}.${where}\n\nAdd it to your calendar:\n${calendars.map(([l, u]) => `${l}: ${u}`).join('\n')}\n\nThe poll: ${pollUrl}\n\nYou get this one email because you answered “${title}” with this address. Venn won't email you again about it.\n`;
  text += `\n${signature(pollUrl)}\n`;
  const html = emailLayout(
    `${heading('It’s happening! 🎉')}${para(`<strong>${escHtml(title)}</strong> is on <strong>${escHtml(when)}</strong>.`)}${
      location ? para(`📍 ${escHtml(location)}`) : ''
    }<p style="margin:16px 0 8px;font-weight:700">Add it to your calendar</p><p style="margin:0 0 12px">${calendars
      .map(([label, href]) => sharePill(href, label))
      .join('')}</p>${para(`<a href="${escHtml(pollUrl)}" style="color:#0b7a5c">See the poll</a>`)}`,
    `You get this one email because you answered “${escHtml(title)}” with this address. Venn won't email you again about it.`,
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
      ? `${name} just answered “${s.poll.title}”. Finn is fired up: your plans are coming together!`
      : `${name} ${VERBS[s.event] || 'responded to'} “${s.poll.title}”.`;
  const can = s.bestTime && s.bestTime.available + s.bestTime.ifNeeded;
  const best = s.bestTime
    ? `Best time so far: ${s.bestTime.label} (${can} of ${s.poll.responses} can make it).`
    : s.poll.responses
      ? ''
      : 'No answers yet.';
  const text = `${lead}${best ? `\n\n${best}` : ''}\n\nSee everyone's answers: ${s.poll.url}\n\nWaiting on anyone? Send them the same link.\n\nStop these emails: ${unsubscribeUrl}\n`;
  const headline = name && isNew ? heading(`${escHtml(name)} just answered! 🎉`) : '';
  const html = emailLayout(
    `${headline}${para(escHtml(lead))}${best ? para(escHtml(best)) : ''}${button(s.poll.url, "See everyone's answers")}${copyBox(s.poll.url, 'Waiting on anyone? Copy link to send again')}`,
    stopFooter(unsubscribeUrl),
    s.poll.url,
    { signed: false },
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
  let text = `Hi ${name}, here's what you told Venn for “${title}”:\n\n${
    list ? list.map((l) => `- ${l.label}: ${l.answer}`).join('\n') : 'None of these work.'
  }\n\nYour answer (open it to change it): ${editUrl}\nThis link is just for you, so don't share it.\n\n${pollLabel}: ${pollUrl}\n\nKnow someone else who should answer? Send them the poll: ${pollUrl}\n\nYou asked for this copy when you answered. If that wasn't you, ignore this email.\n`;
  const items = list
    ? `<ul style="margin:12px 0;padding-left:20px;line-height:1.6">${list
        .map((l) => `<li>${escHtml(l.label)}: <strong>${escHtml(l.answer)}</strong></li>`)
        .join('')}</ul>`
    : para('None of these work.');
  text += `\n${signature(pollUrl)}\n`;
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
        sendEmail(
          env,
          { to: settings.email, ...msg, headers: unsubscribeHeaders(unsubscribeLink(origin, ev.id, settings.unsubscribeToken)) },
          { fetchImpl },
        )
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
