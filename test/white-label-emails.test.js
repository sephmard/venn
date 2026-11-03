// White-label polls (a template with `hideVenn`): guests' emails and calendar entries carry no Venn.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApp } from '../server.js';
import { YES } from '../public/core.js';
import { answerCopyEmail, dateSetEmail, deadlineReminderEmail, inviteEmail } from '../src/notify.js';

const pollUrl = 'https://venn.day/e/abc';
const builders = {
  answerCopyEmail: [
    answerCopyEmail,
    { title: 'Book club', name: 'Ana', lines: [{ label: 'Fri', answer: 'Yes' }], pollUrl, editUrl: `${pollUrl}#edit=x.y` },
  ],
  dateSetEmail: [
    dateSetEmail,
    { title: 'Book club', when: 'Fri, Nov 6', location: 'Rosa’s', pollUrl, calendars: [['Google Calendar', 'https://g']] },
  ],
  inviteEmail: [
    inviteEmail,
    { title: 'Book club', organizer: 'Sam', closes: 'Fri', pollUrl, unsubscribeUrl: `${pollUrl}#unsubscribe=1.2` },
  ],
  deadlineReminderEmail: [
    deadlineReminderEmail,
    { title: 'Book club', organizer: 'Sam', closes: 'Fri', pollUrl, unsubscribeUrl: `${pollUrl}#unsubscribe=1.2` },
  ],
};

// What each email was, byte for byte, before white label existed (main at 669894e), plain and retro.
const BEFORE = {
  answerCopyEmail: [
    '7e0ed1a29c2881d6e281c3436854d11bb38cb37a479207ffd471852d50aa8827',
    '460aea50d715322fb36b32c9206fc5754b266cd30c9f7558be9b1c5a16109b5f',
  ],
  dateSetEmail: [
    '114b1f735285cee361acb89a3c9111996e1af6eb6774748c3c767cdc0ec30ec9',
    '306b9cdc069e791bb6135f4d60a7119e97ba66d3643aafb3bda5ba5b0a9f5dc1',
  ],
  inviteEmail: [
    '084a06d8c8b0674fa270f07fb1895c704ed2a6f37745d34225201e9b61028ffa',
    'a6daa73d63b2ff8230a783afc3fb7be982936211cd3615a29b37f89cb309a324',
  ],
  deadlineReminderEmail: [
    '06de7b2a6d89aae45098441175a72b1d2d561dc37ed6085ce500a3476dacc6e3',
    'ac290b4438cbe007a1b063017faee32346a591c2d51a5cdfdb6aa4f38c09211c',
  ],
};
const hash = (m) => createHash('sha256').update(JSON.stringify(m)).digest('hex');

// "venn" anywhere but the poll link's host, which stays venn.day until custom domains exist.
const vennOutsideLink = (s) => s.split('https://venn.day').join('').match(/venn/i);

test('guest emails are unchanged, byte for byte, when the poll is not white label', () => {
  for (const [name, [fn, args]] of Object.entries(builders))
    for (const [i, retro] of [false, true].entries()) {
      assert.equal(hash(fn({ ...args, retro })), BEFORE[name][i], `${name}, retro ${retro}`);
      assert.equal(hash(fn({ ...args, retro, whiteLabel: false })), BEFORE[name][i], `${name}, retro ${retro}`);
    }
});

test('white-label guest emails: no Venn and no dog, the template’s name on top, signed for the organizer', () => {
  for (const [name, [fn, args]] of Object.entries(builders))
    for (const retro of [false, true]) {
      const m = fn({ ...args, retro, whiteLabel: { name: 'Acme <Co>', title: args.title } });
      for (const part of ['subject', 'text', 'html']) assert.equal(vennOutsideLink(m[part]), null, `${name} ${part}`);
      assert.doesNotMatch(m.html, /<img|venn-dog|Finn/, name);
      assert.doesNotMatch(m.text + m.html, /make your own/, name);
      assert.ok(m.html.includes('Book club'), `${name} still says what it's about`);
      assert.ok(m.html.includes('>Acme &lt;Co&gt;</div>'), `${name}: the template's name, as plain text`);
      assert.ok(m.html.includes('Sent for the organizer of “Book club”.'), `${name} signature`);
    }
});

// ---------- through the API ----------

let server, base, sent;
before(async () => {
  sent = [];
  const fakeFetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  };
  const env = { RESEND_API_KEY: 're_test', EMAIL_FROM: 'Venn <notify@venn.example>', EMAIL_SIGNIN: 'off' };
  server = createApp({ dbPath: ':memory:', env, fetchImpl: fakeFetch });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  await server.settled();
  return { status: res.status, data };
}
const emails = () => sent.filter((s) => s.url === 'https://api.resend.com/emails').map((s) => s.body);
const H = 3_600_000;
const slot = Date.UTC(2030, 0, 10, 19);

async function pickedPoll(brand) {
  const { data } = await call('/api/events', {
    method: 'POST',
    body: {
      title: 'Book club',
      timezone: 'Europe/London',
      mode: 'options',
      options: [{ start: slot, end: slot + H }],
      requireEmail: true,
      ...(brand && { brand }),
    },
  });
  const path = `/api/events/${data.id}`;
  const ans = await call(`${path}/participants`, {
    method: 'POST',
    body: { name: 'Ana', email: 'ana@example.com', copyTo: 'ana@example.com', availability: { [slot]: YES } },
  });
  assert.equal(ans.status, 201);
  await call(`${path}/finalize`, { method: 'POST', body: { start: slot }, headers: { 'x-admin-token': data.adminToken } });
  return { id: data.id, path };
}

test('a white-label poll: the answer copy, the date email, its calendar links and the .ics carry no Venn', async () => {
  const brand = (await call('/api/brands', { method: 'POST', body: { name: 'Acme', hideVenn: true } })).data.id;
  sent.length = 0;
  const { id, path } = await pickedPoll(brand);
  const mail = emails().filter((m) => m.to === 'ana@example.com' || m.to?.[0] === 'ana@example.com');
  assert.equal(mail.length, 2, 'the answer copy and the date email');
  const link = (s) => s.split(base).join('https://venn.day');
  for (const m of mail) {
    // Calendar links carry their text URL-encoded: decoded, they say only the poll's link.
    const body = decodeURIComponent(link(m.text).replace(/\+/g, ' ')) + link(m.html);
    assert.match(m.html, /Acme/);
    assert.equal(vennOutsideLink(m.subject + body), null, m.subject);
  }
  const ics = await call(`${path}/event.ics`);
  assert.equal(ics.status, 200);
  assert.doesNotMatch(ics.data, /Planned with Venn/);
  assert.match(ics.data.replace(/\r\n /g, ''), new RegExp(`DESCRIPTION:${base}/e/${id}`));
});

test('a poll that is not white label still signs its date email, calendar links and .ics', async () => {
  sent.length = 0;
  const { path } = await pickedPoll(null);
  const date = emails().find((m) => m.subject.startsWith("It's happening"));
  assert.match(decodeURIComponent(date.text.replace(/\+/g, ' ')), /details=Planned with Venn: /);
  assert.match(date.text, /Planned with Venn\. No sign-up needed/);
  assert.match((await call(`${path}/event.ics`)).data, /Planned with Venn/);
});
