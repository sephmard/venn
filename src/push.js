// Web Push: a notification on the organizer's phone or computer when someone answers. On only when
// the server has a VAPID key pair (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, from `npm run vapid`).
// No dependencies: the message is encrypted (RFC 8291, aes128gcm) and the request signed (RFC 8292,
// VAPID) with WebCrypto, which both Node and Workers have.

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

export const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
export const fromB64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
};

export const pushEnabled = (env) => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

/** Most devices a poll's organizer can be notified on: their phone, laptop and a couple more. */
export const MAX_PUSH_DEVICES = 5;
/** Most devices told when a poll's date is picked: its guests', a few each. */
export const MAX_GUEST_DEVICES = 200;

// The push services browsers use. A subscription's endpoint must be one of them, so the server never
// posts to an address someone made up.
const PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'];

/** A browser's push subscription ({ endpoint, keys: { p256dh, auth } }), checked; throws if it isn't one. */
export function checkSubscription(sub) {
  let url;
  try {
    url = new URL(sub?.endpoint);
  } catch {
    throw new TypeError('Not a push subscription');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) || sub.endpoint.length > 1024)
    throw new TypeError('Not a push service this server knows');
  let p256dh, auth;
  try {
    p256dh = fromB64url(sub.keys?.p256dh);
    auth = fromB64url(sub.keys?.auth);
  } catch {
    throw new TypeError('Not a push subscription');
  }
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) throw new TypeError('Not a push subscription');
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

/** A new VAPID key pair, as base64url: the public key (65 bytes, uncompressed) and the private one (32). */
export async function vapidKeys() {
  const pair = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await subtle().exportKey('jwk', pair.privateKey);
  return { publicKey: b64url(await subtle().exportKey('raw', pair.publicKey)), privateKey: jwk.d };
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** The payload encrypted for one subscription (RFC 8291): one aes128gcm record, with its header. */
export async function encrypt(payload, { p256dh, auth }) {
  const uaPublic = fromB64url(p256dh);
  const local = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await subtle().exportKey('raw', local.publicKey));
  const uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(fromB64url(auth), shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // The payload, then 0x02: this is the last (and only) record.
  const data = concat(enc.encode(payload), Uint8Array.of(2));
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, key, data));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096); // record size
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

/** The VAPID Authorization header for a push service (RFC 8292): a signed token good for 12 hours. */
export async function vapidAuth(endpoint, env, now) {
  const pub = fromB64url(env.VAPID_PUBLIC_KEY);
  const jwk = { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)) };
  const key = await subtle().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (o) => b64url(enc.encode(JSON.stringify(o)));
  const body = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'https://venn.day',
  })}`;
  const sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(body));
  return `vapid t=${body}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/**
 * Send one notification ({ title, body, url }) to one subscription. Resolves to { ok, status, gone }:
 * gone means the device has unsubscribed (404 or 410), so the subscription can be forgotten.
 */
export async function sendPush(sub, message, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidAuth(sub.endpoint, env, now),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '86400',
      urgency: 'normal',
    },
    body: await encrypt(JSON.stringify(message), sub.keys),
    signal: AbortSignal.timeout(5000),
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
