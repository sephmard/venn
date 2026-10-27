import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { googlePlace, photonPlace, placesProvider, placesQuery } from '../src/places.js';
import { handleApi } from '../src/api.js';

// place-search.js runs in the browser; ui.js, which it imports, looks up the page when it loads.
globalThis.document ??= { getElementById: () => null };
const { notAPlace } = await import('../public/place-search.js');

// The place search providers are never called: each test hands the server a fake fetch.

const photonBody = {
  type: 'FeatureCollection',
  features: [
    {
      properties: {
        name: "Rosa's Pizza",
        street: 'Metropolitan Avenue',
        housenumber: '374',
        city: 'New York',
        district: 'Brooklyn',
        countrycode: 'US',
        country: 'United States',
      },
    },
    { properties: { name: 'Café Einstein', street: 'Kurfürstenstraße', housenumber: '58', city: 'Berlin', countrycode: 'DE' } },
    { properties: { name: 'Paris', state: 'Ile-de-France', country: 'France', countrycode: 'FR' } },
    // The same place again once written short, and one with no name at all: both left out.
    { properties: { name: 'Paris', country: 'France', countrycode: 'FR' } },
    { properties: {} },
    { properties: { street: 'Baker Street', housenumber: '221B', city: 'London', countrycode: 'GB' } },
    { properties: { name: 'A' } },
    { properties: { name: 'B' } },
  ],
};

const googleBody = {
  suggestions: [
    {
      placePrediction: {
        text: { text: 'Blue Bottle Coffee, Mint Plaza, San Francisco, CA, USA' },
        structuredFormat: {
          mainText: { text: 'Blue Bottle Coffee' },
          secondaryText: { text: 'Mint Plaza, San Francisco, CA, USA' },
        },
      },
    },
    { placePrediction: { text: { text: 'Somewhere only text' } } },
    { queryPrediction: { text: { text: 'coffee near me' } } },
  ],
};

/** A fake fetch that records each request and answers with `body` (or fails). */
function fakeFetch(body, { status = 200, fail = null } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (fail) throw fail;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  f.calls = calls;
  return f;
}

async function withServer(env, fetchImpl, fn) {
  const server = createApp({ env, fetchImpl });
  await new Promise((r) => server.listen(0, r));
  try {
    const get = async (path, headers = {}) => {
      const res = await fetch(`http://localhost:${server.address().port}${path}`, { headers });
      return { status: res.status, headers: res.headers, data: await res.json() };
    };
    await fn(get);
  } finally {
    server.close();
  }
}

test('place search: which provider, from the settings', () => {
  assert.equal(placesProvider({}), null);
  assert.equal(placesProvider({ PLACES_PROVIDER: 'photon' }), 'photon');
  assert.equal(placesProvider({ PLACES_PROVIDER: ' Photon ' }), 'photon');
  assert.equal(placesProvider({ GOOGLE_PLACES_API_KEY: 'k' }), 'google');
  assert.equal(placesProvider({ PLACES_PROVIDER: 'google', GOOGLE_PLACES_API_KEY: 'k' }), 'google');
  // An explicit choice wins, and Google without its key is off.
  assert.equal(placesProvider({ PLACES_PROVIDER: 'photon', GOOGLE_PLACES_API_KEY: 'k' }), 'photon');
  assert.equal(placesProvider({ PLACES_PROVIDER: 'google' }), null);
  assert.equal(placesProvider({ PLACES_PROVIDER: 'mapquest' }), null);
});

test('place search: the query is checked', () => {
  const q = (s) => placesQuery(new URLSearchParams(s));
  assert.deepEqual(q('q=  rosa%27s   pizza  &lang=en-US'), { q: "rosa's pizza", lang: 'en', near: null, session: '' });
  assert.deepEqual(q('q=cafe&near=52.5163,13.3777').near, { lat: 52.5, lon: 13.4 });
  assert.equal(q('q=cafe&lang=1x').lang, '');
  assert.equal(q('q=cafe&session=0b8e7c1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e').session, '0b8e7c1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e');
  assert.throws(() => q('q=a'), /2 to 100/);
  assert.throws(() => q('q=%20%20a%20'), /2 to 100/);
  assert.throws(() => q(`q=${'x'.repeat(101)}`), /2 to 100/);
  assert.throws(() => q('q=cafe&near=200,1'), /lat,lon/);
  assert.throws(() => q('q=cafe&near=nope'), /lat,lon/);
  assert.throws(() => q('q=cafe&session=no%20spaces'), /session/);
});

test('place search: Photon and Google results, written short', () => {
  assert.deepEqual(photonPlace(photonBody.features[0]), {
    name: "Rosa's Pizza",
    detail: '374 Metropolitan Avenue, New York',
    label: "Rosa's Pizza, 374 Metropolitan Avenue, New York",
  });
  assert.equal(photonPlace(photonBody.features[1]).label, 'Café Einstein, Kurfürstenstraße 58, Berlin');
  assert.equal(photonPlace(photonBody.features[2]).label, 'Paris, France');
  assert.equal(photonPlace(photonBody.features[5]).label, '221B Baker Street, London');
  // A street on its own, and a name that repeats the city, aren't said twice.
  assert.equal(photonPlace({ properties: { name: 'Berlin', city: 'Berlin', country: 'Germany' } }).label, 'Berlin, Germany');
  assert.equal(photonPlace({ properties: { name: 'Main St', street: 'Main St', city: 'Ames' } }).label, 'Main St, Ames');
  assert.equal(photonPlace({ properties: {} }), null);
  assert.equal(photonPlace(), null);
  assert.deepEqual(googlePlace(googleBody.suggestions[0]), {
    name: 'Blue Bottle Coffee',
    detail: 'Mint Plaza, San Francisco, CA, USA',
    label: 'Blue Bottle Coffee, Mint Plaza, San Francisco, CA, USA',
  });
  assert.equal(googlePlace(googleBody.suggestions[1]).label, 'Somewhere only text');
  assert.equal(googlePlace(googleBody.suggestions[2]), null);
  assert.equal(googlePlace(), null);
});

test('place search: off without settings, and /api/config says so', async () => {
  const f = fakeFetch(photonBody);
  await withServer({}, f, async (get) => {
    assert.equal((await get('/api/config')).data.places, false);
    const res = await get('/api/places?q=cafe');
    assert.equal(res.status, 404);
    assert.match(res.data.error, /isn't turned on/);
  });
  assert.equal(f.calls.length, 0);
});

test('place search with Photon: mapped, capped, cached, and said who is asking', async () => {
  const f = fakeFetch(photonBody);
  await withServer({ PLACES_PROVIDER: 'photon' }, f, async (get) => {
    assert.equal((await get('/api/config')).data.places, 'photon');
    const res = await get('/api/places?q=pizza&lang=en&near=40.71,-73.95');
    assert.equal(res.status, 200);
    assert.equal(res.data.places.length, 5);
    assert.deepEqual(
      res.data.places.map((p) => p.label),
      [
        "Rosa's Pizza, 374 Metropolitan Avenue, New York",
        'Café Einstein, Kurfürstenstraße 58, Berlin',
        'Paris, France',
        '221B Baker Street, London',
        'A',
      ],
    );
    assert.match(res.headers.get('cache-control'), /^public, max-age=600$/);
    assert.ok(res.headers.get('content-security-policy'));
    const url = new URL(f.calls[0].url);
    assert.equal(url.origin + url.pathname, 'https://photon.komoot.io/api/');
    assert.equal(url.searchParams.get('q'), 'pizza');
    assert.equal(url.searchParams.get('lang'), 'en');
    assert.equal(url.searchParams.get('lat'), '40.7');
    assert.equal(url.searchParams.get('lon'), '-73.9');
    assert.equal(url.searchParams.get('limit'), '8');
    assert.match(f.calls[0].init.headers['user-agent'], /^Venn place search \(\+http:\/\/localhost:\d+\)$/);
    assert.ok(f.calls[0].init.signal, 'it times out');
    // The same search again (any case or spacing) comes from the cache.
    await get('/api/places?q=%20PIZZA%20&lang=en&near=40.71,-73.95');
    assert.equal(f.calls.length, 1);
    // Languages Photon doesn't know are left out, so it answers in each place's own language.
    await get('/api/places?q=pizza&lang=ja');
    assert.equal(new URL(f.calls[1].url).searchParams.get('lang'), null);
    // Bad searches never reach Photon.
    assert.equal((await get('/api/places?q=p')).status, 400);
    assert.equal(f.calls.length, 2);
  });
});

test('place search: your own Photon server', async () => {
  const f = fakeFetch({ features: [] });
  await withServer({ PLACES_PROVIDER: 'photon', PHOTON_URL: 'https://photon.example.org' }, f, async (get) => {
    assert.deepEqual((await get('/api/places?q=cafe')).data, { places: [] });
    assert.equal(new URL(f.calls[0].url).origin, 'https://photon.example.org');
  });
});

test('place search with Google: the key stays on the server, nothing is cached', async () => {
  const f = fakeFetch(googleBody);
  await withServer({ GOOGLE_PLACES_API_KEY: 'g-secret' }, f, async (get) => {
    assert.equal((await get('/api/config')).data.places, 'google');
    const config = JSON.stringify((await get('/api/config')).data);
    assert.doesNotMatch(config, /g-secret/);
    const res = await get('/api/places?q=blue%20bottle&lang=en&near=37.78,-122.4&session=abc-123');
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.data.places.map((p) => p.label),
      ['Blue Bottle Coffee, Mint Plaza, San Francisco, CA, USA', 'Somewhere only text'],
    );
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const { url, init } = f.calls[0];
    assert.equal(url, 'https://places.googleapis.com/v1/places:autocomplete');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['x-goog-api-key'], 'g-secret');
    assert.match(init.headers['x-goog-fieldmask'], /structuredFormat/);
    assert.deepEqual(JSON.parse(init.body), {
      input: 'blue bottle',
      languageCode: 'en',
      sessionToken: 'abc-123',
      locationBias: { circle: { center: { latitude: 37.8, longitude: -122.4 }, radius: 50000 } },
    });
    await get('/api/places?q=blue%20bottle');
    assert.equal(f.calls.length, 2);
    assert.deepEqual(JSON.parse(f.calls[1].init.body), { input: 'blue bottle' });
  });
});

test('place search: a provider that fails or is slow gives a 502, with nothing typed in the log', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')));
  const timeout = Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' });
  for (const f of [fakeFetch({}, { status: 503 }), fakeFetch({}, { fail: timeout })]) {
    await withServer({ PLACES_PROVIDER: 'photon' }, f, async (get) => {
      const res = await get('/api/places?q=secret%20hideout');
      assert.equal(res.status, 502);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    });
  }
  await withServer({ GOOGLE_PLACES_API_KEY: 'k' }, fakeFetch({}, { status: 403 }), async (get) => {
    assert.equal((await get('/api/places?q=secret%20hideout')).status, 502);
  });
  assert.equal(errors.length, 3);
  assert.ok(errors.every((e) => !/secret|hideout/.test(e)));
  assert.match(errors[1], /timed out/);
});

test('place search: rate limited per visitor', async () => {
  const f = fakeFetch(photonBody);
  await withServer({ PLACES_PROVIDER: 'photon', PLACES_RATE_LIMIT: '2' }, f, async (get) => {
    const statuses = [];
    for (const q of ['aa', 'bb', 'cc']) statuses.push((await get(`/api/places?q=${q}`)).status);
    assert.deepEqual(statuses, [200, 200, 429]);
  });
});

test("place search: Cloudflare's rate limiting binding, and the Worker's shared state", async () => {
  const keys = [];
  const env = {
    PLACES_PROVIDER: 'photon',
    PLACES_RATE_LIMITER: { limit: async ({ key }) => (keys.push(key), { success: false }) },
  };
  const res = await handleApi(new Request('https://venn.test/api/places?q=cafe'), null, { env, clientIp: '203.0.113.9' });
  assert.equal(res.status, 429);
  assert.deepEqual(keys, ['203.0.113.9']);
  // No IP: one shared key.
  await handleApi(new Request('https://venn.test/api/places?q=cafe'), null, { env });
  assert.equal(keys[1], 'unknown');
  // Without a per-server state, the Worker's own (one per isolate) is used.
  const f = fakeFetch({ features: [{ properties: { name: 'Café' } }] });
  const ok = await handleApi(new Request('https://venn.test/api/places?q=cafe'), null, {
    env: { PLACES_PROVIDER: 'photon' },
    fetchImpl: f,
  });
  assert.deepEqual(await ok.json(), { places: [{ name: 'Café', detail: '', label: 'Café' }] });
});

test('place search: the cache keeps the newest 500 searches', async () => {
  const f = fakeFetch({ features: [] });
  await withServer({ PLACES_PROVIDER: 'photon', PLACES_RATE_LIMIT: '10000' }, f, async (get) => {
    for (let i = 0; i < 501; i++) await get(`/api/places?q=q${i}`);
    await get('/api/places?q=q500'); // still cached
    assert.equal(f.calls.length, 501);
    await get('/api/places?q=q0'); // pushed out
    assert.equal(f.calls.length, 502);
  });
});

test('place search in the browser: links and numbers are never searched', () => {
  for (const s of [
    'https://zoom.us/j/123',
    'http://example.com',
    'www.example.com',
    'zoom.us/j/9876',
    'meet.google.com/abc-defg-hij',
    'teams.microsoft.com/l/meetup-join/x',
    'webex://meet',
    '12345',
    ' 555-0100 ',
  ])
    assert.ok(notAPlace(s), s);
  for (const s of ["Rosa's Pizza", '10 Downing Street', 'St. Paul', 'Café Einstein', 'Dr. Smith’s office', 'Zürich HB'])
    assert.ok(!notAPlace(s), s);
});
