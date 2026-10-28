import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { allowContactRequest, contactEmail, contactEnabled, contactInbox, normalizeContact } from '../src/contact.js';
import { sendEmail } from '../src/email.js';

const env = {
  RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'Venn <notify@venn.example>',
  EMAIL_REPLY_TO: 'Venn <hello@venn.example>',
  CONTACT_RATE_LIMIT: '4',
};

test('the form is on only with email and an inbox to send to', () => {
  assert.equal(contactEnabled(env), true);
  assert.equal(contactEnabled({ ...env, EMAIL_REPLY_TO: '' }), false);
  assert.equal(contactEnabled({ EMAIL_REPLY_TO: 'hello@venn.example' }), false);
  assert.equal(contactInbox(env), 'hello@venn.example');
  assert.equal(contactInbox({ EMAIL_REPLY_TO: 'hello@venn.example' }), 'hello@venn.example');
});

test('a message is checked: a kind, some words, and an email to reply to for "Contact us"', () => {
  assert.deepEqual(normalizeContact({ kind: 'feature', message: '  Dark mode toggle  ' }), {
    kind: 'feature',
    message: 'Dark mode toggle',
    email: null,
  });
  assert.equal(normalizeContact({ kind: 'contact', message: 'Hi there', email: 'Ana@Example.com' }).email, 'ana@example.com');
  assert.throws(() => normalizeContact({ kind: 'contact', message: 'Hi there' }), /email so we can reply/);
  assert.throws(() => normalizeContact({ kind: 'spam', message: 'Hi there' }), /feature request or a message/);
  assert.throws(() => normalizeContact({ kind: 'toString', message: 'Hi there' }), /feature request or a message/);
  assert.throws(() => normalizeContact({ kind: 'feature', message: ' a ' }), /Write a message/);
  assert.throws(() => normalizeContact({ kind: 'feature', message: 7 }), /Write a message/);
  assert.throws(() => normalizeContact({ kind: 'feature', message: 'x'.repeat(2001) }), /under 2000/);
  assert.throws(() => normalizeContact({ kind: 'feature', message: 'Hi there', email: 'nope' }), /Invalid email/);
  assert.throws(() => normalizeContact(null), /feature request or a message/);
});

test('the email escapes what was typed and replies go to the sender', () => {
  const msg = contactEmail({ kind: 'contact', message: '<b>Hi</b>\nsecond line', email: 'ana@example.com' }, 'https://venn.day');
  assert.equal(msg.subject, 'Message: <b>Hi</b>');
  assert.equal(msg.replyTo, 'ana@example.com');
  assert.match(msg.text, /From: ana@example\.com/);
  assert.match(msg.html, /&lt;b&gt;Hi&lt;\/b&gt;/);
  assert.doesNotMatch(msg.html, /<b>Hi/);
  const idea = contactEmail({ kind: 'feature', message: 'y'.repeat(80), email: null }, 'https://venn.day');
  assert.equal(idea.subject, `Feature request: ${'y'.repeat(57)}…`);
  assert.equal(idea.replyTo, undefined);
  assert.match(idea.text, /No email given/);
});

test("a message's own Reply-To wins over EMAIL_REPLY_TO, with Cloudflare's binding too", async () => {
  const EMAIL = { sent: [], send: async (m) => EMAIL.sent.push(m) };
  const cf = { EMAIL_FROM: 'notify@venn.day', EMAIL_REPLY_TO: 'hello@venn.day', EMAIL };
  await sendEmail(cf, { to: 'hello@venn.day', subject: 's', text: 't', replyTo: 'ana@example.com' });
  await sendEmail(cf, { to: 'x@example.com', subject: 's', text: 't' });
  assert.equal(EMAIL.sent[0].replyTo, 'ana@example.com');
  assert.equal(EMAIL.sent[1].replyTo, 'hello@venn.day');
});

test('a few messages an hour per visitor, then a wait', async () => {
  const windows = new Map();
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(await allowContactRequest({}, '1.2.3.4', now + i, windows), true);
  assert.equal(await allowContactRequest({}, '1.2.3.4', now + 10, windows), false);
  assert.equal(await allowContactRequest({}, '5.6.7.8', now + 10, windows), true);
  assert.equal(await allowContactRequest({}, '1.2.3.4', now + 3_600_001, windows), true);
  const limiter = { limit: async ({ key }) => ({ success: key === 'ok' }) };
  assert.equal(await allowContactRequest({ CONTACT_RATE_LIMITER: limiter }, 'ok', now, windows), true);
  assert.equal(await allowContactRequest({ CONTACT_RATE_LIMITER: limiter }, '', now, windows), false);
});

// ---------- through the API ----------

let server, base, sent, fail;

before(async () => {
  const fakeFetch = async (url, init) => {
    if (fail) return new Response('{}', { status: 500 });
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  };
  server = createApp({ env, fetchImpl: fakeFetch });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  sent = [];
  fail = false;
});

const post = (body) =>
  fetch(`${base}/api/contact`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('a feature request and a message reach the inbox in EMAIL_REPLY_TO', async () => {
  assert.equal((await (await fetch(`${base}/api/config`)).json()).contact, true);

  assert.equal((await post({ kind: 'feature', message: 'Recurring polls please' })).status, 204);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, ['hello@venn.example']);
  assert.equal(sent[0].body.subject, 'Feature request: Recurring polls please');
  // No sender address, so replies go to the usual inbox.
  assert.equal(sent[0].body.reply_to, 'Venn <hello@venn.example>');

  sent = [];
  assert.equal((await post({ kind: 'contact', message: 'Can I self-host?', email: 'ana@example.com' })).status, 204);
  assert.equal(sent[0].body.reply_to, 'ana@example.com');

  // Mistakes are explained, and don't count against the limit.
  const bad = await post({ kind: 'contact', message: 'No address' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /email/);

  // A bot that fills in the hidden field is told it worked, and nothing is sent.
  sent = [];
  assert.equal((await post({ kind: 'feature', message: 'Buy now', website: 'spam.example' })).status, 204);
  assert.equal(sent.length, 0);

  // If the email service is down, people are told to try again.
  fail = true;
  const down = await post({ kind: 'feature', message: 'Dark mode' });
  assert.equal(down.status, 502);
  assert.match((await down.json()).error, /didn't send/);

  // The limit (4 an hour here): two sent and one failed so far.
  fail = false;
  assert.equal((await post({ kind: 'feature', message: 'One more' })).status, 204);
  const limited = await post({ kind: 'feature', message: 'And another' });
  assert.equal(limited.status, 429);
});

test('without EMAIL_REPLY_TO there is no form and no endpoint', async () => {
  const off = createApp({ env: { ...env, EMAIL_REPLY_TO: '' } });
  await new Promise((r) => off.listen(0, r));
  try {
    const url = `http://localhost:${off.address().port}`;
    assert.equal((await (await fetch(`${url}/api/config`)).json()).contact, false);
    const res = await fetch(`${url}/api/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'feature', message: 'Hello there' }),
    });
    assert.equal(res.status, 404);
  } finally {
    off.close();
  }
});
