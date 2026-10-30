import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { b64url, checkSubscription, encrypt, fromB64url, pushEnabled, sendPush, vapidAuth, vapidKeys } from '../src/push.js';

const { subtle } = globalThis.crypto;

/** A browser's side of a subscription: its key pair and auth secret, as the push service sees them. */
async function browserKeys() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, keys: { p256dh: b64url(await subtle.exportKey('raw', pair.publicKey)), auth: b64url(auth) } };
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** What the browser does with a pushed message (RFC 8291), written out from the RFC, not from src. */
async function decrypt(body, { pair, keys }) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, pair.privateKey, 256));
  const uaPublic = fromB64url(keys.p256dh);
  const info = new Uint8Array([...new TextEncoder().encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(fromB64url(keys.auth), shared, info, 32);
  const cek = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed));
  assert.equal(plain.at(-1), 2, 'the last record ends with 0x02');
  return { rs, idlen, text: new TextDecoder().decode(plain.slice(0, -1)) };
}

test('push: a message is encrypted so only the subscribed browser can read it (RFC 8291)', async () => {
  const browser = await browserKeys();
  const message = JSON.stringify({ title: 'Dinner', body: 'Ana answered', url: 'https://venn.day/e/abc' });
  const body = await encrypt(message, browser.keys);
  const { rs, idlen, text } = await decrypt(body, browser);
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);
  assert.equal(text, message);
  // Each message has its own salt and key: the same words never look the same twice.
  assert.notDeepEqual(await encrypt(message, browser.keys), body);
  // Another browser can't read it.
  await assert.rejects(decrypt(body, { ...(await browserKeys()), keys: browser.keys }));
});

test('push: requests are signed with the server key, for that push service, for 12 hours (VAPID)', async () => {
  const env = { ...(await vapidKeys()), VAPID_SUBJECT: 'mailto:hello@example.com' };
  env.VAPID_PUBLIC_KEY = env.publicKey;
  env.VAPID_PRIVATE_KEY = env.privateKey;
  assert.ok(pushEnabled(env));
  assert.ok(!pushEnabled({}));
  const now = Date.UTC(2030, 0, 1);
  const auth = await vapidAuth('https://web.push.apple.com/abc123', env, now);
  const [, t, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, env.VAPID_PUBLIC_KEY);
  const [h, p, s] = t.split('.');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromB64url(h))), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  assert.deepEqual(claims, { aud: 'https://web.push.apple.com', exp: now / 1000 + 12 * 3600, sub: 'mailto:hello@example.com' });
  const key = await subtle.importKey('raw', fromB64url(env.VAPID_PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'verify',
  ]);
  const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
  assert.ok(ok, 'the signature verifies with the public key');
});

test('push: only real push services, and well-formed keys, are accepted', async () => {
  const { keys } = await browserKeys();
  for (const endpoint of [
    'https://web.push.apple.com/QGm1',
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])
    assert.equal(checkSubscription({ endpoint, keys }).endpoint, endpoint);
  for (const endpoint of [
    'http://web.push.apple.com/x',
    'https://evil.example/x',
    'https://push.apple.com.evil.example/x',
    'nope',
  ])
    assert.throws(() => checkSubscription({ endpoint, keys }), TypeError, endpoint);
  assert.throws(() => checkSubscription({ endpoint: 'https://web.push.apple.com/x', keys: { ...keys, auth: 'AAAA' } }));
  assert.throws(() => checkSubscription({ endpoint: 'https://web.push.apple.com/x', keys: { ...keys, p256dh: 'AAAA' } }));
});

test('push: sendPush posts the encrypted message with the right headers, and says when a device is gone', async () => {
  const env = await vapidKeys().then((k) => ({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey }));
  const browser = await browserKeys();
  const sub = { endpoint: 'https://web.push.apple.com/abc', keys: browser.keys };
  let seen;
  const fetchImpl = async (url, init) => ((seen = { url, init }), new Response(null, { status: 201 }));
  assert.deepEqual(await sendPush(sub, { title: 'Dinner', body: 'Ana answered' }, env, { fetchImpl }), {
    ok: true,
    status: 201,
    gone: false,
  });
  assert.equal(seen.url, sub.endpoint);
  assert.equal(seen.init.headers['content-encoding'], 'aes128gcm');
  assert.equal(seen.init.headers.ttl, '86400');
  assert.match(seen.init.headers.authorization, /^vapid t=.+, k=/);
  assert.deepEqual(JSON.parse((await decrypt(seen.init.body, browser)).text), { title: 'Dinner', body: 'Ana answered' });
  const gone = async () => new Response(null, { status: 410 });
  assert.equal((await sendPush(sub, { title: 'x' }, env, { fetchImpl: gone })).gone, true);
});

// ---------- on the server ----------

async function serve(t, env, status = () => 201) {
  const pushes = [];
  const fetchImpl = async (url, init) => {
    pushes.push({ url: String(url), init });
    return new Response(null, { status: status(String(url)) });
  };
  const app = createApp({ env, fetchImpl });
  await new Promise((r) => app.listen(0, r));
  t.after(() => app.close());
  const base = `http://localhost:${app.address().port}`;
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body && JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    await app.settled();
    return { status: res.status, data };
  };
  return { call, pushes };
}

const poll = {
  title: 'Dinner',
  timezone: 'UTC',
  mode: 'options',
  options: [{ start: Date.UTC(2030, 0, 4, 19), end: Date.UTC(2030, 0, 4, 21) }],
};

test("the organizer's phone gets a first notification, then one per answer, and a gone device is forgotten", async (t) => {
  const keys = await vapidKeys();
  const env = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };
  let gone = false;
  const { call, pushes } = await serve(t, env, () => (gone ? 410 : 201));
  assert.equal((await call('/api/config')).data.push, keys.publicKey);

  const { data } = await call('/api/events', { method: 'POST', body: poll });
  const admin = { 'x-admin-token': data.adminToken };
  const phone = await browserKeys();
  const sub = { endpoint: 'https://web.push.apple.com/QGm1abc', keys: phone.keys };

  // Only the organizer, and only a real push service.
  assert.equal((await call(`/api/events/${data.id}/notifications`, { method: 'PUT', body: { push: sub } })).status, 403);
  const bad = { ...sub, endpoint: 'https://evil.example/x' };
  assert.equal(
    (await call(`/api/events/${data.id}/notifications`, { method: 'PUT', body: { push: bad }, headers: admin })).status,
    400,
  );
  assert.equal(pushes.length, 0);

  const on = await call(`/api/events/${data.id}/notifications`, { method: 'PUT', body: { push: sub }, headers: admin });
  assert.equal(on.status, 200);
  assert.equal(on.data.pushAvailable, true);
  assert.equal(on.data.pushDevices, 1);
  assert.equal(JSON.stringify(on.data).includes(sub.endpoint), false, "the device's address stays on the server");
  const read = async (p) => JSON.parse((await decrypt(p.init.body, phone)).text);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].url, sub.endpoint);
  const hello = await read(pushes[0]);
  assert.deepEqual(
    { ...hello, url: undefined },
    {
      title: 'Dinner',
      body: "You'll get a notification here when someone answers.",
      url: undefined,
      tag: data.id,
    },
  );
  assert.match(hello.url, new RegExp(`/e/${data.id}$`));

  // Adding the same device again doesn't count it twice.
  await call(`/api/events/${data.id}/notifications`, { method: 'PUT', body: { push: sub }, headers: admin });
  assert.equal((await call(`/api/events/${data.id}/notifications`, { headers: admin })).data.pushDevices, 1);

  pushes.length = 0;
  await call(`/api/events/${data.id}/participants`, {
    method: 'POST',
    body: { name: 'Ana', availability: { [poll.options[0].start]: 2 } },
  });
  assert.equal(pushes.length, 1);
  const msg = await read(pushes[0]);
  assert.equal(msg.title, 'Dinner');
  assert.match(msg.body, /^Ana answered · \d of \d can make the best time so far$/);

  // The phone unsubscribed: the push service says it's gone, and Venn stops trying.
  gone = true;
  await call(`/api/events/${data.id}/participants`, { method: 'POST', body: { name: 'Lee', availability: {} } });
  assert.equal((await call(`/api/events/${data.id}/notifications`, { headers: admin })).data.pushDevices, 0);

  // Turning it off on a device drops it.
  gone = false;
  await call(`/api/events/${data.id}/notifications`, { method: 'PUT', body: { push: sub }, headers: admin });
  const off = await call(`/api/events/${data.id}/notifications`, {
    method: 'PUT',
    body: { pushRemove: sub.endpoint },
    headers: admin,
  });
  assert.equal(off.data.pushDevices, 0);
});

test('without a key pair, phone notifications are off and say so', async (t) => {
  const { call } = await serve(t, {});
  assert.equal((await call('/api/config')).data.push, false);
  const { data } = await call('/api/events', { method: 'POST', body: poll });
  const admin = { 'x-admin-token': data.adminToken };
  assert.equal((await call(`/api/events/${data.id}/notifications`, { headers: admin })).data.pushAvailable, false);
  const phone = await browserKeys();
  const res = await call(`/api/events/${data.id}/notifications`, {
    method: 'PUT',
    body: { push: { endpoint: 'https://web.push.apple.com/x', keys: phone.keys } },
    headers: admin,
  });
  assert.equal(res.status, 400);
});

test("a guest's phone is told when the date is picked and when it changes, and only theirs", async (t) => {
  const keys = await vapidKeys();
  const env = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };
  const { call, pushes } = await serve(t, env);
  const two = { ...poll, options: [...poll.options, { start: Date.UTC(2030, 0, 5, 19), end: Date.UTC(2030, 0, 5, 21) }] };
  const { data } = await call('/api/events', { method: 'POST', body: two });
  const admin = { 'x-admin-token': data.adminToken };
  const ana = (await call(`/api/events/${data.id}/participants`, { method: 'POST', body: { name: 'Ana', availability: {} } }))
    .data;
  const phone = await browserKeys();
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/ana', keys: phone.keys };
  const path = `/api/events/${data.id}/participants/${ana.id}/push`;
  const read = async (p) => JSON.parse((await decrypt(p.init.body, phone)).text);

  // Only Ana, with her own edit token.
  assert.equal((await call(path, { method: 'PUT', body: { push: sub } })).status, 403);
  assert.equal((await call(path, { method: 'PUT', body: { push: sub }, headers: { 'x-edit-token': 'nope' } })).status, 403);
  const mine = { 'x-edit-token': ana.editToken };
  assert.equal((await call(path, { method: 'PUT', body: { push: sub }, headers: mine })).status, 200);
  assert.equal(pushes.length, 1);
  assert.equal((await read(pushes[0])).body, "You'll get a notification here when the date is picked.");
  // The organizer's settings don't show it, and the organizer isn't notified of it.
  const view = (await call(`/api/events/${data.id}/notifications`, { headers: admin })).data;
  assert.equal(JSON.stringify(view).includes(sub.endpoint), false);
  assert.equal(view.pushDevices, 0);

  pushes.length = 0;
  await call(`/api/events/${data.id}/finalize`, { method: 'POST', body: { start: two.options[0].start }, headers: admin });
  assert.equal(pushes.length, 1);
  assert.deepEqual(await read(pushes[0]), {
    title: 'Dinner',
    body: 'The date is picked. Tap to see it.',
    url: (await read(pushes[0])).url,
    tag: data.id,
  });
  assert.match((await read(pushes[0])).url, new RegExp(`/e/${data.id}$`));
  // Picking the same again says nothing; a different date says it changed.
  pushes.length = 0;
  await call(`/api/events/${data.id}/finalize`, { method: 'POST', body: { start: two.options[0].start }, headers: admin });
  assert.equal(pushes.length, 0);
  await call(`/api/events/${data.id}/finalize`, { method: 'POST', body: { start: two.options[1].start }, headers: admin });
  assert.equal((await read(pushes[0])).body, 'The date changed. Tap to see it.');

  // Once Ana has removed her answer, her phone isn't told any more.
  await call(`/api/events/${data.id}/participants/${ana.id}`, { method: 'DELETE', headers: mine });
  pushes.length = 0;
  await call(`/api/events/${data.id}/finalize`, { method: 'POST', body: { start: two.options[0].start }, headers: admin });
  assert.equal(pushes.length, 0);
});

test('a guest can turn it off, and a gone phone is forgotten', async (t) => {
  const keys = await vapidKeys();
  const env = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };
  let status = 201;
  const { call, pushes } = await serve(t, env, () => status);
  const two = { ...poll, options: [...poll.options, { start: Date.UTC(2030, 0, 5, 19), end: Date.UTC(2030, 0, 5, 21) }] };
  const { data } = await call('/api/events', { method: 'POST', body: two });
  const admin = { 'x-admin-token': data.adminToken };
  const answer = async (name) =>
    (await call(`/api/events/${data.id}/participants`, { method: 'POST', body: { name, availability: {} } })).data;
  const [ana, lee] = [await answer('Ana'), await answer('Lee')];
  const subOf = async (who) => ({ endpoint: `https://web.push.apple.com/${who}`, keys: (await browserKeys()).keys });
  const [anaSub, leeSub] = [await subOf('ana'), await subOf('lee')];
  const put = (p, body) =>
    call(`/api/events/${data.id}/participants/${p.id}/push`, { method: 'PUT', body, headers: { 'x-edit-token': p.editToken } });
  await put(ana, { push: anaSub });
  await put(lee, { push: leeSub });
  // Lee turns it off: only Ana hears.
  await put(lee, { pushRemove: leeSub.endpoint });
  pushes.length = 0;
  await call(`/api/events/${data.id}/finalize`, { method: 'POST', body: { start: two.options[0].start }, headers: admin });
  assert.deepEqual(
    pushes.map((p) => p.url),
    [anaSub.endpoint],
  );
  // Ana's phone has unsubscribed: it's dropped, and not tried again.
  status = 410;
  await call(`/api/events/${data.id}/finalize`, { method: 'POST', body: { start: two.options[1].start }, headers: admin });
  status = 201;
  pushes.length = 0;
  await call(`/api/events/${data.id}/finalize`, { method: 'POST', body: { start: two.options[0].start }, headers: admin });
  assert.equal(pushes.length, 0);
});
