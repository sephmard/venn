import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_PROVIDERS, emailProvider, parseAddress, sendEmail } from '../src/email.js';
import { emailEnabled } from '../src/notify.js';

const message = {
  to: 'host@example.com',
  subject: 'Hi',
  text: 'Hello',
  html: '<p>Hello</p>',
  headers: { 'List-Unsubscribe': '<https://venn.day/u>' },
};

/** A stand-in for Cloudflare's send_email binding. */
const binding = () => {
  const sent = [];
  return { sent, send: async (m) => (sent.push(m), { messageId: 'm1' }) };
};

test('email is off without a sender address or a provider', () => {
  assert.equal(emailProvider({}), null);
  assert.equal(emailProvider({ RESEND_API_KEY: 're_x' }), null); // no EMAIL_FROM
  assert.equal(emailProvider({ EMAIL_FROM: 'a@b.co' }), null); // no provider
  assert.equal(emailEnabled({ EMAIL_FROM: 'a@b.co', EMAIL: binding() }), true);
});

test('picks the Cloudflare binding first, or the provider EMAIL_PROVIDER names', () => {
  const env = { EMAIL_FROM: 'a@b.co', EMAIL: binding(), RESEND_API_KEY: 're_x' };
  assert.equal(emailProvider(env).name, 'cloudflare');
  assert.equal(emailProvider({ ...env, EMAIL_PROVIDER: 'Resend' }).name, 'resend');
  assert.equal(emailProvider({ ...env, EMAIL_PROVIDER: 'postmark' }), null); // named but not available
  assert.equal(emailProvider({ EMAIL_FROM: 'a@b.co', RESEND_API_KEY: 're_x' }).name, 'resend');
});

test('sends through the Cloudflare binding with a named sender', async () => {
  const EMAIL = binding();
  await sendEmail({ EMAIL_FROM: 'Venn <notify@venn.day>', EMAIL }, message);
  assert.deepEqual(EMAIL.sent, [{ from: { name: 'Venn', email: 'notify@venn.day' }, ...message }]);
});

test('sends through Resend over HTTPS, and reports its errors', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => (calls.push({ url, body: JSON.parse(init.body) }), new Response('{}', { status: 200 }));
  const env = { EMAIL_FROM: 'Venn <notify@venn.day>', RESEND_API_KEY: 're_x' };
  await sendEmail(env, message, { fetchImpl });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(calls[0].body.to, ['host@example.com']);
  await assert.rejects(sendEmail(env, message, { fetchImpl: async () => new Response('', { status: 422 }) }), /422/);
  await assert.rejects(sendEmail({}, message), /not set up/);
});

test('new providers plug in without other changes', async () => {
  const sent = [];
  const custom = { name: 'outbox', configured: (env) => !!env.OUTBOX, send: async (_env, m) => sent.push(m.to) };
  const providers = [...EMAIL_PROVIDERS, custom];
  await sendEmail({ EMAIL_FROM: 'a@b.co', OUTBOX: '1' }, message, { providers });
  assert.deepEqual(sent, ['host@example.com']);
});

test('parseAddress', () => {
  assert.deepEqual(parseAddress('"Venn Polls" <a@b.co>'), { name: 'Venn Polls', email: 'a@b.co' });
  assert.equal(parseAddress(' a@b.co '), 'a@b.co');
});
