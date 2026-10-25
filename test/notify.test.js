import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApp } from '../server.js';
import { validateWebhookUrl, webhookBody, summaryText, isPrivateAddress } from '../src/notify.js';

// ---------- unit ----------

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
  assert.deepEqual(Object.keys(webhookBody('https://hooks.slack.com/services/T/B/x', summary)), ['text']);
  assert.deepEqual(Object.keys(webhookBody('https://discord.com/api/webhooks/1/abc', summary)), ['content']);
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

test('email notifications need confirming, then arrive, and can be stopped', async () => {
  assert.deepEqual((await call('/api/config')).data, { email: true });

  const { data } = await call('/api/events', { method: 'POST', body: { ...poll, notifyEmail: 'Sam@Example.com' } });
  const { id, adminToken } = data;
  const admin = { 'x-admin-token': adminToken };

  // A confirmation email goes out first.
  assert.equal(emails().length, 1);
  assert.deepEqual(emails()[0].body.to, ['sam@example.com']);
  assert.match(emails()[0].body.subject, /Confirm notifications/);
  const token = emails()[0].body.text.match(/#confirm-email=(\w+)/)[1];

  // Nothing is sent about responses until the address is confirmed.
  sent = [];
  const slot = poll.options[0].start;
  await call(`/api/events/${id}/participants`, { method: 'POST', body: { name: 'Ana', availability: { [slot]: 2 } } });
  assert.equal(emails().length, 0);

  assert.equal((await call(`/api/events/${id}/notifications/confirm`, { method: 'POST', body: { token } })).status, 200);
  assert.equal((await call(`/api/events/${id}/notifications/confirm`, { method: 'POST', body: { token } })).status, 400);

  // Now a response triggers an email with an unsubscribe link.
  sent = [];
  const lee = await call(`/api/events/${id}/participants`, {
    method: 'POST',
    body: { name: 'Lee', availability: { [slot]: 1 } },
  });
  assert.equal(emails().length, 1);
  const mail = emails()[0].body;
  assert.equal(mail.subject, 'Lee responded to “Design review”');
  assert.match(mail.text, /Best time so far: Wed, Nov 4, 3:00 PM – 4:00 PM EST \(2 of 2 can make it\)/);
  assert.match(mail.headers['List-Unsubscribe'], /#unsubscribe=/);

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
  assert.equal(settings.emailConfirmed, true);
  assert.equal(settings.lastDelivery.email.ok, true);
  const pub = JSON.stringify((await call(`/api/events/${id}`)).data);
  assert.doesNotMatch(pub, /sam@example\.com|unsubscribe|confirm/i);

  // Unsubscribing stops the emails.
  const unsub = mail.text.match(/#unsubscribe=(\w+)/)[1];
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

test('email is refused when the server has no email service', async () => {
  const bare = createApp({ env: {} });
  await new Promise((r) => bare.listen(0, r));
  const url = `http://localhost:${bare.address().port}`;
  const res = await fetch(`${url}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...poll, notifyEmail: 'a@b.co' }),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await (await fetch(`${url}/api/config`)).json(), { email: false });
  bare.close();
});
