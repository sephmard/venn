// White-label polls (a template with `hideVenn`): guests' emails and calendar entries carry no Venn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from '../src/api.js';
import { createStore, sqliteAdapter } from '../src/store.js';
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

// The API itself, with a store the test can also write to (who keeps which poll and template),
// email through a stand-in for Resend, and the background sends awaited.
const store = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
const sent = [];
const pending = [];
const env = { RESEND_API_KEY: 're_test', EMAIL_FROM: 'Venn <notify@venn.example>', EMAIL_SIGNIN: 'off' };
const fetchImpl = async (url, init) => {
  sent.push({ url: String(url), body: JSON.parse(init.body) });
  return new Response('{}', { status: 200 });
};
async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await handleApi(
    new Request(`https://venn.day${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body && JSON.stringify(body),
    }),
    store,
    { env, fetchImpl, waitUntil: (p) => pending.push(p), clientIp: '127.0.0.1' },
  );
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  await Promise.all(pending.splice(0));
  return { status: res.status, data };
}
const emails = () => sent.filter((s) => s.url === 'https://api.resend.com/emails').map((s) => s.body);
const H = 3_600_000;
const slot = Date.UTC(2030, 0, 10, 19);

/** A poll from `brand` (or none), kept with account `organizer` (or none), answered by Ana with a copy, and picked. */
async function pickedPoll(brand, organizer) {
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
  if (organizer) await store.addOwner('poll', data.id, organizer, 1);
  const path = `/api/events/${data.id}`;
  const ans = await call(`${path}/participants`, {
    method: 'POST',
    body: { name: 'Ana', email: 'ana@example.com', copyTo: 'ana@example.com', availability: { [slot]: YES } },
  });
  assert.equal(ans.status, 201);
  await call(`${path}/finalize`, { method: 'POST', body: { start: slot }, headers: { 'x-admin-token': data.adminToken } });
  return { id: data.id, path };
}
const guestMail = () => emails().filter((m) => m.to?.[0] === 'ana@example.com');
// Calendar links carry their text URL-encoded.
const readable = (m) => m.subject + [m.text, m.html].map((t) => decodeURIComponent(t.replace(/\+/g, ' '))).join('');

/** A white-label template kept with account u-owner, shared with u-member as a user. */
async function whiteLabelTemplate() {
  const brand = (await call('/api/brands', { method: 'POST', body: { name: 'Acme', hideVenn: true } })).data.id;
  await store.addOwner('brand', brand, 'u-owner', 1);
  await store.setBrandMember(brand, 'u-member', 'user', 1);
  return brand;
}

test('white label, organizer is the template’s owner or member: the answer copy, the date email and its calendar links carry no Venn', async () => {
  const brand = await whiteLabelTemplate();
  for (const organizer of ['u-owner', 'u-member']) {
    sent.length = 0;
    await pickedPoll(brand, organizer);
    const mail = guestMail();
    assert.equal(mail.length, 2, 'the answer copy and the date email');
    for (const m of mail) {
      assert.equal(vennOutsideLink(readable(m)), null, `${organizer}: ${m.subject}`);
      assert.match(m.html, />Acme<\/div>/);
      assert.match(m.html, /Sent for the organizer of “Book club”\./);
      // From the template's name, at the server's own address.
      assert.equal(m.from, '"Acme via Venn" <notify@venn.example>', `${organizer}: ${m.subject}`);
    }
  }
});

test('white label, organizer is not one of the template’s people (or signed out): the emails keep Venn', async () => {
  const brand = await whiteLabelTemplate();
  for (const organizer of ['u-stranger', null]) {
    sent.length = 0;
    await pickedPoll(brand, organizer);
    const mail = guestMail();
    assert.equal(mail.length, 2);
    for (const m of mail) {
      assert.match(m.text, /Planned with Venn\. No sign-up needed/, `${organizer}: ${m.subject}`);
      assert.doesNotMatch(m.html, /Sent for the organizer/);
      assert.equal(m.from, 'Venn <notify@venn.example>', `${organizer}: ${m.subject}`);
    }
  }
});

test('the .ics follows the template alone: no "Planned with Venn" on any white-label poll, signed on others', async () => {
  const brand = await whiteLabelTemplate();
  const { id, path } = await pickedPoll(brand, null);
  const ics = await call(`${path}/event.ics`);
  assert.equal(ics.status, 200);
  assert.doesNotMatch(ics.data, /Planned with Venn/);
  assert.match(ics.data.replace(/\r\n /g, ''), new RegExp(`DESCRIPTION:https://venn.day/e/${id}`));
  const plain = await pickedPoll(null, null);
  assert.match((await call(`${plain.path}/event.ics`)).data, /Planned with Venn/);
  const date = guestMail().find((m) => m.subject.startsWith("It's happening"));
  assert.match(readable(date), /details=Planned with Venn: /);
});

test('no white-label guest email links to the "Text the poll" page, whose title says Venn', () => {
  for (const [name, [fn, args]] of Object.entries(builders)) {
    const m = fn({ ...args, whiteLabel: { name: 'Acme', title: args.title } });
    assert.doesNotMatch(m.text + m.html, /\/sms\b|sms:/, name);
  }
});

test('a white-label vote: the decision email to a guest who asked carries no Venn, only when the organizer is the template’s', async () => {
  const brand = await whiteLabelTemplate();
  for (const organizer of ['u-member', 'u-stranger']) {
    const { data } = await call('/api/events', {
      method: 'POST',
      body: { title: 'Where to?', timezone: 'UTC', mode: 'topic', options: ['Park', 'Beach'], brand },
    });
    await store.addOwner('poll', data.id, organizer, 1);
    const path = `/api/events/${data.id}`;
    const ana = (await call(`${path}/participants`, { method: 'POST', body: { name: 'Ana', availability: { 1: YES } } })).data;
    const asked = await call(`${path}/participants/${ana.id}`, {
      method: 'PUT',
      body: { email: 'ana@example.com' },
      headers: { 'x-edit-token': ana.editToken },
    });
    assert.equal(asked.status, 200);
    sent.length = 0;
    await call(`${path}/finalize`, { method: 'POST', body: { option: 1 }, headers: { 'x-admin-token': data.adminToken } });
    const m = guestMail().find((e) => e.subject.startsWith('Decided'));
    assert.ok(m, `${organizer}: the decision email`);
    if (organizer === 'u-member') {
      assert.equal(vennOutsideLink(readable(m)), null);
      assert.match(m.html, />Acme<\/div>/);
      assert.equal(m.from, '"Acme via Venn" <notify@venn.example>');
    } else {
      assert.match(m.text, /Planned with Venn\. No sign-up needed/);
      assert.equal(m.from, 'Venn <notify@venn.example>');
    }
  }
});

test('white-label From name: on mail to guests who answered, never on invitations or reminders', () => {
  const whiteLabel = { name: 'Acme', title: 'Book club' };
  for (const name of ['answerCopyEmail', 'dateSetEmail']) {
    const [fn, args] = builders[name];
    assert.equal(fn({ ...args, whiteLabel }).fromName, 'Acme', name);
    assert.equal('fromName' in fn(args), false, name);
  }
  // Anyone can name a template anything, so mail nobody asked for keeps the server's own name.
  for (const name of ['inviteEmail', 'deadlineReminderEmail']) {
    const [fn, args] = builders[name];
    assert.equal('fromName' in fn({ ...args, whiteLabel }), false, name);
  }
});
