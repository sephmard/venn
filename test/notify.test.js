import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApp } from '../server.js';
import { existsSync } from 'node:fs';
import {
  MASCOT_PATH,
  MAX_ORGANIZER_EMAILS,
  answerCopyEmail,
  isPrivateAddress,
  notifyResponse,
  pollReadyEmail,
  responseEmail,
  retroEmail,
  signature,
  smsHref,
  summaryText,
  validateWebhookUrl,
  webhookBody,
} from '../src/notify.js';

// ---------- unit ----------

/** Whether an email has this exact line: a link checked whole, not found somewhere in the text. */
const hasLine = (text, line) => text.split('\n').some((l) => l === line);

test('emails keep links few: the one button, the link to copy, and a way to stop them', () => {
  const pollUrl = 'https://venn.example/e/abc';
  const s = { event: 'response.created', poll: { title: 'Dinner', url: pollUrl, responses: 1 }, response: { name: 'Ana' } };
  const ready = pollReadyEmail({ title: 'Dinner', pollUrl, unsubscribeUrl: `${pollUrl}#unsubscribe=u` });
  const answered = responseEmail(s, `${pollUrl}#unsubscribe=u`);
  const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  for (const m of [ready, answered]) {
    // Open, Copy link (the same link), and Stop these emails. No share or "make your own" links.
    assert.deepEqual(hrefs(m.html), [pollUrl, pollUrl, `${pollUrl}#unsubscribe=u`]);
    assert.match(m.html, /Copy link/);
    assert.match(m.html, /user-select:all/);
    assert.doesNotMatch(m.html + m.text, /wa\.me|sms:|mailto:|\/new\?from=email/);
  }
  assert.match(ready.html, />Open your Venn</);
  assert.ok(hasLine(ready.text, pollUrl));
  assert.ok(hasLine(answered.text, 'Waiting on anyone? Send them the same link.'));
  // Titles are escaped.
  const odd = pollReadyEmail({ title: '"><b>x', pollUrl, unsubscribeUrl: 'u' }).html;
  assert.doesNotMatch(odd, /"><b>x/);
});

test("emails to guests are signed by Venn, with a way to make your own poll; the organizer's aren't", () => {
  const pollUrl = 'https://venn.example/e/abc';
  const s = { event: 'response.created', poll: { title: 'Dinner', url: pollUrl, responses: 1 }, response: { name: 'Ana' } };
  const copy = answerCopyEmail({ title: 'Dinner', name: 'Ana', lines: [], pollUrl, editUrl: `${pollUrl}#edit=p.t` });
  assert.equal(signature(pollUrl), 'Planned with Venn. No sign-up needed: make your own at https://venn.example/new?from=email');
  assert.ok(hasLine(copy.text, signature(pollUrl)));
  assert.match(copy.html, /href="https:\/\/venn\.example\/new\?from=email"/);
  assert.doesNotMatch(copy.html, /wa\.me|sms:|mailto:/);
  const organizer = [
    pollReadyEmail({ title: 'Dinner', pollUrl, unsubscribeUrl: `${pollUrl}#unsubscribe=u` }),
    responseEmail(s, `${pollUrl}#unsubscribe=u`),
  ];
  for (const m of [copy, ...organizer]) assert.match(m.html, /alt="Finn, the Venn dog"/);
  for (const m of organizer) assert.doesNotMatch(m.text + m.html, /Planned with Venn/);
  assert.match(organizer[0].text, /Finn is so proud of you/);
});

test("every notification email shows Venn's dog, from the instance's own site", () => {
  assert.ok(existsSync(new URL(`../public${MASCOT_PATH}`, import.meta.url)));
  const ready = pollReadyEmail({
    title: 'Dinner',
    pollUrl: 'https://venn.example/e/abc',
    unsubscribeUrl: 'https://venn.example/e/abc#unsubscribe=u',
  });
  assert.match(ready.html, /<img src="https:\/\/venn\.example\/img\/venn-dog\.png"/);
  const s = {
    event: 'test',
    poll: { title: 'Dinner', url: 'https://venn.example/e/abc', responses: 0 },
    response: null,
    bestTime: null,
  };
  assert.match(responseEmail(s, 'https://venn.example/e/abc#unsubscribe=u').html, /venn\.example\/img\/venn-dog\.png/);
});

test("the emails: a proud poll-ready email, an excited one per answer, and the guest's own link", () => {
  const pollUrl = 'https://venn.example/e/abc';
  const ready = pollReadyEmail({ title: 'Dinner <3', pollUrl, unsubscribeUrl: `${pollUrl}#unsubscribe=u` });
  assert.equal(ready.subject, 'Your Venn “Dinner <3” is ready 🎉');
  assert.match(ready.text, /proud of you for bringing people together/);
  assert.ok(hasLine(ready.text, pollUrl));
  assert.match(ready.html, /Dinner &lt;3/);
  assert.doesNotMatch(ready.html, /Dinner <3/);

  const s = {
    event: 'response.created',
    poll: { title: 'Dinner', url: pollUrl, responses: 1 },
    response: { name: 'Ana' },
    bestTime: null,
  };
  const mail = responseEmail(s, `${pollUrl}#unsubscribe=u`);
  assert.equal(mail.subject, '🎉 Ana just answered “Dinner”');
  assert.match(mail.text, /Ana just answered “Dinner”\. Finn is fired up/);
  assert.ok(hasLine(mail.text, `See everyone's answers: ${pollUrl}`));
  assert.equal(responseEmail({ ...s, event: 'response.updated' }, '').subject, 'Ana updated their answers to “Dinner”');

  const editUrl = `${pollUrl}#edit=p1.secret`;
  const copy = answerCopyEmail({ title: 'Dinner', name: 'Ana', lines: [], pollUrl, editUrl });
  assert.ok(hasLine(copy.text, `Your answer (open it to change it): ${editUrl}`));
  assert.match(copy.html, /View or change your answer/);
  assert.match(copy.html, /See everyone's answers/);
  assert.match(
    answerCopyEmail({ title: 'Dinner', name: 'Ana', lines: [], pollUrl, editUrl, seeAnswers: false }).html,
    /Open the poll/,
  );
  assert.match(copy.text, /None of these work\./); // the same words as the poll page
});

test('emails say "can make it" or "available", like the poll page, never "free" for availability', () => {
  const pollUrl = 'https://venn.example/e/abc';
  const s = {
    event: 'response.created',
    poll: { title: 'Dinner', url: pollUrl, responses: 3 },
    response: { name: 'Ana' },
    bestTime: { label: 'Wed, Nov 4, 3:00 PM – 4:00 PM EST', available: 2, ifNeeded: 1 },
  };
  const mails = [
    pollReadyEmail({ title: 'Dinner', pollUrl, unsubscribeUrl: `${pollUrl}#unsubscribe=u` }),
    responseEmail(s, `${pollUrl}#unsubscribe=u`),
    responseEmail({ ...s, response: null, bestTime: null, poll: { ...s.poll, responses: 0 } }, ''),
    answerCopyEmail({
      title: 'Dinner',
      name: 'Ana',
      lines: [{ label: 'Wed, Nov 4, all day', answer: 'yes' }],
      pollUrl,
      editUrl: `${pollUrl}#edit=p.t`,
    }),
  ];
  assert.match(mails[1].text, /\(3 of 3 can make it\)/);
  assert.match(summaryText(s), /3 of 3 can make it/);
  for (const m of mails) for (const part of [m.subject, m.text, m.html]) assert.doesNotMatch(part, /\bfree\b/i);
});

test('email buttons and links use the app green, which is readable with white text (WCAG AA)', () => {
  const pollUrl = 'https://venn.example/e/abc';
  const emails = [
    pollReadyEmail({ title: 'Dinner', pollUrl, unsubscribeUrl: pollUrl }),
    answerCopyEmail({ title: 'Dinner', name: 'Ana', lines: [], pollUrl, editUrl: pollUrl }),
  ];
  for (const { html } of emails) {
    assert.doesNotMatch(html, /#0f9d76/i); // 3.4:1 with white, too faint
    assert.match(html, /background:#0b7a5c;color:#fff;[^"]*border-radius:999px/); // a pill, like the app's buttons
  }
  assert.match(emails[1].html, /<a href="[^"]+" style="color:#0b7a5c">/);
  // The link to copy is dark text on a light box, like a text field.
  assert.match(emails[0].html, /background:#f7f7f5;[^"]*"><a href="[^"]+" style="color:#1c1d1f;/);
});

test("a poll can only send so many emails to the organizer, since addresses aren't confirmed", async () => {
  const sentTo = [];
  let settings = { email: 'sam@example.com', unsubscribeToken: 'u', emailsSent: MAX_ORGANIZER_EMAILS - 1 };
  const store = {
    getNotify: async () => settings,
    setNotify: async (_id, next) => (settings = next),
    listParticipants: async () => [],
  };
  const env = { RESEND_API_KEY: 'k', EMAIL_FROM: 'Venn <venn@example.com>' };
  const fetchImpl = async (url, init) => {
    sentTo.push(JSON.parse(init.body).to);
    return new Response('{}', { status: 200 });
  };
  const ev = { id: 'abc', title: 'Dinner', timezone: 'UTC', mode: 'options', options: [] };
  const answer = (participantId) =>
    notifyResponse({
      store,
      env,
      fetchImpl,
      now: Date.now,
      origin: 'https://venn.example',
      ev,
      kind: 'response.created',
      participantId,
      name: 'Ana',
    });
  await answer('p1');
  assert.equal(sentTo.length, 1);
  assert.equal(settings.emailsSent, MAX_ORGANIZER_EMAILS);
  await answer('p2');
  assert.equal(sentTo.length, 1);
});

test('webhook URLs must be public https endpoints', async () => {
  const bad = [
    'http://example.com/hook',
    'https://localhost/hook',
    'https://intranet/hook',
    'https://printer.local/x',
    'https://10.0.0.5/x',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/x',
    'https://user:pw@example.com/x',
    'https://example.com:8443/x',
    'not a url',
  ];
  for (const url of bad) await assert.rejects(validateWebhookUrl(url), undefined, url);
  // DNS names that point inside the network are rejected too.
  await assert.rejects(
    validateWebhookUrl('https://sneaky.example.com/x', { resolveHost: async () => ['192.168.1.10'] }),
    /public/,
  );
  assert.equal(
    await validateWebhookUrl('https://example.com/hook', { resolveHost: async () => ['93.184.215.14'] }),
    'https://example.com/hook',
  );
  assert.equal(await validateWebhookUrl(''), null);
  assert.ok(isPrivateAddress('::ffff:127.0.0.1'));
  assert.ok(!isPrivateAddress('8.8.8.8'));
});

const summary = {
  event: 'response.created',
  poll: { title: 'Design review', url: 'https://v.example/e/abc', responses: 3 },
  response: { name: 'Ana' },
  bestTime: { label: 'Wed, Nov 4, 3:00 PM – 4:00 PM EST', available: 2, ifNeeded: 1 },
};

test('Slack and Discord get messages in their own format', () => {
  assert.match(
    summaryText(summary),
    /^Ana responded to “Design review”\. Best time so far: Wed, Nov 4.*\(3 of 3 can make it\)\.$/,
  );
  const slack = webhookBody('https://hooks.slack.com/services/T/B/x', summary);
  assert.deepEqual(Object.keys(slack), ['text', 'blocks']);
  assert.match(slack.blocks[0].accessory.image_url, /\/img\/venn-dog\.png$/);
  const discord = webhookBody('https://discord.com/api/webhooks/1/abc', summary);
  assert.deepEqual(Object.keys(discord), ['content', 'embeds']);
  assert.match(discord.embeds[0].thumbnail.url, /\/img\/venn-dog\.png$/);
  assert.equal(webhookBody('https://example.com/hook', summary), summary);
});

// ---------- end to end through the API ----------

let server, base, sent;
const env = { RESEND_API_KEY: 're_test', EMAIL_FROM: 'Venn <notify@venn.example>' };

before(async () => {
  const fakeFetch = async (url, init) => {
    sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  };
  server = createApp({ env, fetchImpl: fakeFetch, resolve: async () => ['93.184.215.14'] });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => (sent = []));

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });
  const data = await res.json();
  await server.settled();
  return { status: res.status, data };
}

const poll = {
  title: 'Design review',
  timezone: 'America/New_York',
  mode: 'options',
  options: [{ start: Date.UTC(2026, 10, 4, 20), end: Date.UTC(2026, 10, 4, 21) }],
};
const emails = () => sent.filter((s) => s.url === 'https://api.resend.com/emails');

test("a retro poll's emails are the same email in neon: dark, with neon buttons and links", () => {
  const plain = pollReadyEmail({ title: 'Game night', pollUrl: 'https://venn.day/e/abc', unsubscribeUrl: 'https://venn.day/u' });
  const retro = pollReadyEmail({
    title: 'Game night',
    pollUrl: 'https://venn.day/e/abc',
    unsubscribeUrl: 'https://venn.day/u',
    retro: true,
  });
  assert.equal(retro.subject, plain.subject);
  assert.equal(retro.text, plain.text);
  assert.equal(retro.html, retroEmail(plain.html));
  assert.match(retro.html, /background:#0d0221/);
  assert.match(retro.html, /background:#ff3cac;color:#0d0221/); // the button: dark ink on neon magenta
  assert.doesNotMatch(retro.html, /#0b7a5c|#f7f7f5/); // nothing of the usual green or paper left
  // Every kind of email takes the look.
  for (const html of [
    answerCopyEmail({
      title: 'T',
      name: 'Ana',
      lines: [],
      pollUrl: 'https://venn.day/e/a',
      editUrl: 'https://venn.day/e/a#edit',
      retro: true,
    }).html,
    responseEmail(
      { event: 'response.created', response: { name: 'Ana' }, poll: { title: 'T', responses: 1, url: 'https://venn.day/e/a' } },
      'https://venn.day/u',
      { retro: true },
    ).html,
  ])
    assert.doesNotMatch(html, /#0b7a5c|#f7f7f5/);
});

test('the organizer gets their poll link straight away, then an email per answer, and can stop them', async () => {
  assert.equal((await call('/api/config')).data.email, true);

  const { data } = await call('/api/events', { method: 'POST', body: { ...poll, notifyEmail: 'Sam@Example.com' } });
  const { id, adminToken } = data;
  const admin = { 'x-admin-token': adminToken };

  // No confirmation step: the first email is the poll's link.
  assert.equal(emails().length, 1);
  assert.deepEqual(emails()[0].body.to, ['sam@example.com']);
  assert.equal(emails()[0].body.subject, 'Your Venn “Design review” is ready 🎉');
  assert.ok(hasLine(emails()[0].body.text, `${base}/e/${id}`));
  assert.doesNotMatch(emails()[0].body.text, /confirm/i);
  assert.equal(emails()[0].body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  // Each answer triggers an email naming who answered, with an unsubscribe link.
  sent = [];
  const slot = poll.options[0].start;
  await call(`/api/events/${id}/participants`, { method: 'POST', body: { name: 'Ana', availability: { [slot]: 2 } } });
  assert.equal(emails().length, 1);
  assert.equal(emails()[0].body.subject, '🎉 Ana just answered “Design review”');
  sent = [];
  const lee = await call(`/api/events/${id}/participants`, {
    method: 'POST',
    body: { name: 'Lee', availability: { [slot]: 1 } },
  });
  assert.equal(emails().length, 1);
  const mail = emails()[0].body;
  assert.equal(mail.subject, '🎉 Lee just answered “Design review”');
  assert.match(mail.text, /Best time so far: Wed, Nov 4, 3:00 PM – 4:00 PM EST \(2 of 2 can make it\)/);
  // Mail apps' own unsubscribe button, with one-click support (RFC 8058).
  const listUnsubscribe = mail.headers['List-Unsubscribe'].slice(1, -1);
  assert.ok(listUnsubscribe.startsWith(`${base}/api/events/${id}/notifications/unsubscribe?token=`), listUnsubscribe);
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  // Quick edits by the same person don't send another email.
  sent = [];
  const leePath = `/api/events/${id}/participants/${lee.data.id}`;
  await call(leePath, {
    method: 'PUT',
    body: { name: 'Lee', availability: {} },
    headers: { 'x-edit-token': lee.data.editToken },
  });
  assert.equal(emails().length, 0);

  // Settings are organizer-only and never part of the public poll.
  assert.equal((await call(`/api/events/${id}/notifications`)).status, 403);
  const settings = (await call(`/api/events/${id}/notifications`, { headers: admin })).data;
  assert.equal(settings.email, 'sam@example.com');
  assert.equal(settings.emailConfirmed, undefined);
  assert.equal(settings.lastDelivery.email.ok, true);
  const pub = JSON.stringify((await call(`/api/events/${id}`)).data);
  assert.doesNotMatch(pub, /sam@example\.com|unsubscribe/i);

  // Opened as a link, the mail app's unsubscribe link leads to the poll page, which finishes it.
  const opened = await fetch(listUnsubscribe, { redirect: 'manual' });
  assert.equal(opened.status, 303);
  const unsub = mail.text.match(/#unsubscribe=(\w+)/)[1];
  assert.equal(opened.headers.get('location'), `${base}/e/${id}#unsubscribe=${unsub}`);
  assert.equal((await call(`/api/events/${id}/notifications`, { headers: admin })).data.email, 'sam@example.com');

  // Unsubscribing stops the emails.
  assert.equal(
    (await call(`/api/events/${id}/notifications/unsubscribe`, { method: 'POST', body: { token: 'wrong' } })).status,
    400,
  );
  assert.equal(
    (await call(`/api/events/${id}/notifications/unsubscribe`, { method: 'POST', body: { token: unsub } })).status,
    200,
  );
  sent = [];
  await call(`/api/events/${id}/participants`, { method: 'POST', body: { name: 'Kim', availability: {} } });
  assert.equal(emails().length, 0);
});

/** What a mail app's one-click unsubscribe button sends (RFC 8058): a form post, not JSON. */
const oneClick = async (headerValue) => {
  const res = await fetch(headerValue.slice(1, -1), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
  await server.settled();
  return res.status;
};

test('the retro look is a poll setting: its page knows, and its emails come in neon', async () => {
  const { data } = await call('/api/events', { method: 'POST', body: { ...poll, retro: true, notifyEmail: 'sam@example.com' } });
  assert.match(emails()[0].body.html, /background:#0d0221/);
  assert.equal((await call(`/api/events/${data.id}`)).data.retro, true);
  // The organizer turns it off: back to the usual look.
  const off = await call(`/api/events/${data.id}/settings`, {
    method: 'PUT',
    body: { retro: false },
    headers: { 'x-admin-token': data.adminToken },
  });
  assert.equal(off.data.retro, false);
  assert.equal((await call(`/api/events/${data.id}`)).data.retro, undefined);
});

test("one tap on a mail app's unsubscribe button stops the organizer's emails", async () => {
  const { data } = await call('/api/events', { method: 'POST', body: { ...poll, notifyEmail: 'sam@example.com' } });
  const header = emails()[0].body.headers['List-Unsubscribe'];
  assert.equal(await oneClick(header.replace(/token=\w+/, 'token=wrong')), 400);
  assert.equal(await oneClick(header), 200);
  sent = [];
  await call(`/api/events/${data.id}/participants`, { method: 'POST', body: { name: 'Ana', availability: {} } });
  assert.equal(emails().length, 0);
});

test("guests' emails can be stopped in one tap too, and only for that guest", async () => {
  const two = { ...poll, options: [...poll.options, { start: Date.UTC(2026, 10, 5, 20), end: Date.UTC(2026, 10, 5, 21) }] };
  const { data } = await call('/api/events', { method: 'POST', body: { ...two, requireEmail: true, hostAvailability: {} } });
  const { id } = data;
  const slot = two.options[0].start;
  sent = [];
  const ana = await call(`/api/events/${id}/participants`, {
    method: 'POST',
    body: { name: 'Ana', email: 'ana@example.com', availability: { [slot]: 2 }, copyTo: 'ana@example.com' },
  });
  await call(`/api/events/${id}/participants`, {
    method: 'POST',
    body: { name: 'Lee', email: 'lee@example.com', availability: { [slot]: 2 } },
  });
  const copy = emails().find((e) => e.body.subject === 'Your answer to “Design review”').body;
  assert.equal(copy.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(copy.headers['List-Unsubscribe'], new RegExp(`token=${ana.data.id}\\.\\w+>$`));
  // Someone else's id with a made-up token does nothing.
  assert.equal(await oneClick(copy.headers['List-Unsubscribe'].replace(/\.\w+>$/, '.nope>')), 400);
  assert.equal(await oneClick(copy.headers['List-Unsubscribe']), 200);

  // Ana stopped her emails, so only Lee hears the date is set; and Ana gets no more copies.
  const pick = (start) =>
    call(`/api/events/${id}/finalize`, { method: 'POST', body: { start }, headers: { 'x-admin-token': data.adminToken } });
  sent = [];
  await pick(slot);
  assert.deepEqual(
    emails().map((m) => m.body.to[0]),
    ['lee@example.com'],
  );
  const lee = emails()[0].body.headers['List-Unsubscribe'];
  assert.doesNotMatch(lee, new RegExp(ana.data.id));
  await call(`/api/events/${id}/participants/${ana.data.id}`, {
    method: 'PUT',
    body: { name: 'Ana', email: 'ana@example.com', availability: {}, copyTo: 'ana@example.com' },
    headers: { 'x-edit-token': ana.data.editToken },
  });
  assert.equal(emails().filter((m) => m.body.to[0] === 'ana@example.com').length, 0);

  // Lee can stop the next one, with the link from the date email.
  assert.equal(await oneClick(lee), 200);
  sent = [];
  await pick(two.options[1].start);
  assert.equal(emails().length, 0);
});

test('signed webhooks, Slack formatting and the test button', async () => {
  const { id, adminToken } = (await call('/api/events', { method: 'POST', body: poll })).data;
  const admin = { 'x-admin-token': adminToken };
  const settingsPath = `/api/events/${id}/notifications`;

  const rejected = await call(settingsPath, { method: 'PUT', body: { webhookUrl: 'http://example.com/x' }, headers: admin });
  assert.equal(rejected.status, 400);

  const set = await call(settingsPath, { method: 'PUT', body: { webhookUrl: 'https://example.com/hook' }, headers: admin });
  assert.match(set.data.webhookSecret, /^whsec_/);

  sent = [];
  await call(`/api/events/${id}/participants`, { method: 'POST', body: { name: 'Ana', availability: {} } });
  assert.equal(sent.length, 1);
  const hook = sent[0];
  assert.equal(hook.url, 'https://example.com/hook');
  assert.equal(hook.body.event, 'response.created');
  assert.equal(hook.body.response.name, 'Ana');
  assert.equal(hook.body.poll.responses, 1);
  // Receivers can verify the signature with the secret.
  const expected = createHmac('sha256', set.data.webhookSecret)
    .update(`${hook.headers['x-venn-timestamp']}.${JSON.stringify(hook.body)}`)
    .digest('hex');
  assert.equal(hook.headers['x-venn-signature'], `sha256=${expected}`);

  // The test button reports the result.
  const tested = await call(`${settingsPath}/test`, { method: 'POST', body: {}, headers: admin });
  assert.deepEqual(tested.data, { ok: true, status: 200 });

  // Slack gets plain text.
  await call(settingsPath, { method: 'PUT', body: { webhookUrl: 'https://hooks.slack.com/services/T/B/x' }, headers: admin });
  sent = [];
  await call(`/api/events/${id}/participants`, { method: 'POST', body: { name: 'Lee', availability: {} } });
  assert.match(sent[0].body.text, /^Lee responded to “Design review”.*\/e\//);
});

test('email is refused when the server has no email service', async (t) => {
  const bare = createApp({ env: {} });
  await new Promise((r) => bare.listen(0, r));
  t.after(() => bare.close());
  const url = `http://localhost:${bare.address().port}`;
  const res = await fetch(`${url}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...poll, notifyEmail: 'a@b.co' }),
  });
  assert.equal(res.status, 400);
  const config = await (await fetch(`${url}/api/config`)).json();
  assert.equal(config.email, false);
  assert.deepEqual(config.calendars, { google: null, microsoft: null, microsoftTenant: 'common' });
});

test('calendar client IDs are published when configured', async (t) => {
  const app = createApp({
    env: { GOOGLE_CLIENT_ID: 'g.apps.googleusercontent.com', MICROSOFT_CLIENT_ID: 'ms-id', MICROSOFT_TENANT: 'consumers' },
  });
  await new Promise((r) => app.listen(0, r));
  t.after(() => app.close());
  const config = await (await fetch(`http://localhost:${app.address().port}/api/config`)).json();
  assert.deepEqual(config.calendars, {
    google: 'g.apps.googleusercontent.com',
    microsoft: 'ms-id',
    microsoftTenant: 'consumers',
  });
});

test('people who answer can get a copy of their answer, with their edit link', async () => {
  const { data } = await call('/api/events', { method: 'POST', body: poll });
  const slot = poll.options[0].start;
  const path = `/api/events/${data.id}/participants`;

  // A bad address is refused before anything is saved.
  const bad = await call(path, { method: 'POST', body: { name: 'Ana', availability: { [slot]: 2 }, copyTo: 'nope' } });
  assert.equal(bad.status, 400);
  assert.equal((await call(`/api/events/${data.id}`)).data.participants.length, 0);

  sent = [];
  const ana = await call(path, {
    method: 'POST',
    body: { name: 'Ana Lima', availability: { [slot]: 2 }, copyTo: 'Ana@Example.com' },
  });
  assert.equal(ana.status, 201);
  const copy = emails().find((e) => e.body.subject === 'Your answer to “Design review”');
  assert.deepEqual(copy.body.to, ['ana@example.com']);
  assert.match(copy.body.text, /Wed, Nov 4, 3:00 PM – 4:00 PM EST: yes/);
  assert.ok(copy.body.text.includes(`#edit=${ana.data.id}.${ana.data.editToken}`));

  // Saving again sends a fresh copy, up to a limit per answer.
  const edit = (availability) =>
    call(`${path}/${ana.data.id}`, {
      method: 'PUT',
      body: { name: 'Ana Lima', availability, copyTo: 'ana@example.com' },
      headers: { 'x-edit-token': ana.data.editToken },
    });
  sent = [];
  await edit({});
  assert.match(emails()[0].body.text, /None of these work\./);
  for (let i = 0; i < 3; i++) await edit({ [slot]: 1 });
  sent = [];
  await edit({ [slot]: 1 });
  assert.equal(emails().length, 0);

  // No address, no copy; and the address is never kept with the poll.
  await call(path, { method: 'POST', body: { name: 'Lee', availability: { [slot]: 2 } } });
  assert.ok(!JSON.stringify((await call(`/api/events/${data.id}`)).data).includes('ana@example.com'));
});

test("once the date is picked, everyone who gave an email hears it's happening, once", async () => {
  const { data } = await call('/api/events', {
    method: 'POST',
    body: { ...poll, location: 'Room 4', organizer: 'Sam', requireEmail: true, hostAvailability: {} },
  });
  const { id, adminToken } = data;
  const admin = { 'x-admin-token': adminToken };
  const slot = poll.options[0].start;
  for (const [name, email] of [
    ['Ana', 'ana@example.com'],
    ['Lee', 'lee@example.com'],
  ])
    await call(`/api/events/${id}/participants`, { method: 'POST', body: { name, email, availability: { [slot]: 2 } } });
  const pick = (start) => call(`/api/events/${id}/finalize`, { method: 'POST', body: { start }, headers: admin });

  sent = [];
  await pick(slot);
  const mails = emails();
  assert.deepEqual(mails.map((m) => m.body.to[0]).sort(), ['ana@example.com', 'lee@example.com']);
  const m = mails[0].body;
  assert.equal(m.subject, "It's happening: Design review, Wed, Nov 4, 3:00 PM EST 🎉");
  assert.match(m.text, /Where: Room 4/);
  assert.ok(m.text.includes(`Apple (iCal): ${base}/api/events/${id}/event.ics`));
  assert.match(m.text, /Google Calendar: https:\/\/calendar\.google\.com\//);
  assert.ok(hasLine(m.text, signature(`${base}/e/${id}`)));
  assert.match(m.html, />Outlook<\/a>/);

  // Picking the same date again, or unpicking it, sends nothing more.
  sent = [];
  await pick(null);
  await pick(slot);
  assert.equal(emails().length, 0);
});

test('no "It\'s happening" email for polls that didn\'t ask for emails', async () => {
  const { data } = await call('/api/events', { method: 'POST', body: poll });
  const slot = poll.options[0].start;
  await call(`/api/events/${data.id}/participants`, {
    method: 'POST',
    body: { name: 'Ana', availability: { [slot]: 2 }, copyTo: 'ana@example.com' },
  });
  sent = [];
  await call(`/api/events/${data.id}/finalize`, {
    method: 'POST',
    body: { start: slot },
    headers: { 'x-admin-token': data.adminToken },
  });
  assert.equal(emails().length, 0);
});

test('the "Text message" link: an sms: link in the form each phone wants', () => {
  const body = 'When works for you? “Dinner & drinks”: https://venn.example/e/abc';
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
  const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
  assert.equal(smsHref(body, iphone), `sms:&body=${encodeURIComponent(body)}`);
  assert.equal(smsHref(body, android), `sms:?body=${encodeURIComponent(body)}`);
  assert.equal(smsHref(body), `sms:?body=${encodeURIComponent(body)}`);
});

test("an email's Text message button opens the poll's own message, never anything else", async () => {
  const { data } = await call('/api/events', { method: 'POST', body: { ...poll, title: 'Dinner <b>& drinks</b>' } });
  const page = async (ua) => {
    const res = await fetch(`${base}/api/events/${data.id}/sms`, { headers: { 'user-agent': ua } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.ok(res.headers.get('content-security-policy'));
    return res.text();
  };
  const html = await page('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
  const body = encodeURIComponent(`When works for you? “Dinner <b>& drinks</b>”: ${base}/e/${data.id}`);
  // A button to tap, not a redirect: iPhones ask before a page opens Messages by itself, not after a tap.
  assert.ok(!html.includes('http-equiv="refresh"'));
  assert.ok(html.includes(`href="sms:&amp;body=${body}"`));
  assert.ok(html.includes('Dinner &lt;b&gt;&amp; drinks&lt;/b&gt;'));
  assert.ok(!html.includes('<b>&'));
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.match(await page('Mozilla/5.0 (Linux; Android 15)'), /href="sms:\?body=/);
  assert.equal((await fetch(`${base}/api/events/nope/sms`)).status, 404);
});
