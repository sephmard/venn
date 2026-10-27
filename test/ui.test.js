import { test } from 'node:test';
import assert from 'node:assert/strict';

// ui.js looks up the page's elements when it loads; a stand-in document is enough for these helpers.
const toastEl = { hidden: true, textContent: '' };
globalThis.document = { getElementById: (id) => (id === 'toast' ? toastEl : null) };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
globalThis.matchMedia = () => ({ matches: true });
const ui = await import('../public/ui.js');
const when = await import('../public/when.js');
const { api, toast } = ui;

const respond = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

async function failure(fetchImpl) {
  const real = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await api('events/abc');
  } catch (e) {
    return e;
  } finally {
    globalThis.fetch = real;
  }
  assert.fail('expected the request to fail');
}

test("api: a network failure says Venn can't be reached, not that the poll is missing", async () => {
  const e = await failure(async () => {
    throw new TypeError('Failed to fetch');
  });
  assert.equal(e.message, "Can't reach Venn. Check your connection and try again.");
  assert.equal(e.status, 0);
  assert.equal(e.cause.message, 'Failed to fetch');
});

test('api: errors keep their status, so a 404 can be told apart from the rest', async () => {
  const notFound = await failure(respond(404, { error: 'Poll not found' }));
  assert.equal(notFound.status, 404);
  assert.equal(notFound.message, 'Poll not found');
  assert.equal((await failure(respond(400, ''))).message, 'Request failed (400)');
});

test('api: server errors read as our problem, but a 503 keeps its reason', async () => {
  for (const [status, body] of [
    [500, { error: 'Something went wrong' }],
    [502, '<html>Bad gateway</html>'],
  ]) {
    const e = await failure(respond(status, body));
    assert.equal(e.message, 'Something went wrong on our side. Try again.');
    assert.equal(e.status, status);
  }
  const busy = await failure(respond(503, { error: 'The AI is busy right now. Try again in a minute.' }));
  assert.equal(busy.message, 'The AI is busy right now. Try again in a minute.');
});

test('api: a successful request returns its JSON', async () => {
  const real = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return new Response('{"ok":true}', { status: 200 });
  };
  try {
    assert.deepEqual(await api('events', { method: 'POST', body: { a: 1 } }), { ok: true });
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(seen.url, '/api/events');
  assert.equal(seen.init.headers['content-type'], 'application/json');
  assert.equal(seen.init.body, '{"a":1}');
});

test('toast: the status region is emptied, then filled, so the same message is announced again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  toastEl.hidden = true; // as the router leaves it after opening a page
  toastEl.textContent = 'Link copied';
  toast('Link copied');
  assert.equal(toastEl.hidden, false);
  assert.equal(toastEl.textContent, '');
  t.mock.timers.tick(50);
  assert.equal(toastEl.textContent, 'Link copied');
  t.mock.timers.tick(3200);
  assert.equal(toastEl.textContent, '', 'empty again, which hides it, but it stays on the page');
  assert.equal(toastEl.hidden, false);
});

test("saved answers and the visitor's name and email are kept in local storage", () => {
  assert.deepEqual(ui.saved('p1'), {});
  ui.save('p1', { adminToken: 'a', participantId: 'b' });
  ui.save('p1', { editToken: 'c' });
  assert.deepEqual(ui.saved('p1'), { adminToken: 'a', participantId: 'b', editToken: 'c' });
  ui.forget('p1', 'participantId', 'editToken');
  assert.deepEqual(ui.saved('p1'), { adminToken: 'a' });
  store.set('venn:p2', '{not json');
  assert.deepEqual(ui.saved('p2'), {});
  assert.equal(ui.lastName(), '');
  ui.rememberName('Priya');
  assert.equal(ui.lastName(), 'Priya');
  assert.equal(ui.lastEmail(), '');
  ui.rememberEmail('priya@example.com');
  assert.equal(ui.lastEmail(), 'priya@example.com');
});

test('copy puts the text on the clipboard and says so, or asks the person to copy it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clip;
  const clipboard = { writeText: async (s) => (clip = s) };
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true });
  await ui.copy('https://venn.day/e/abc', 'Invite link copied');
  t.mock.timers.tick(50);
  assert.equal(clip, 'https://venn.day/e/abc');
  assert.equal(toastEl.textContent, 'Invite link copied');
  let asked;
  globalThis.prompt = (msg, text) => (asked = text);
  clipboard.writeText = async () => {
    throw new Error('denied');
  };
  await ui.copy('x');
  assert.equal(asked, 'x');
});

test('config is fetched once, and an unreachable server means no optional features', async () => {
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError('Failed to fetch');
  };
  try {
    assert.deepEqual(await ui.getConfig(), {});
    assert.deepEqual(await ui.getConfig(), {});
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(calls, 1);
});

test('text helpers: escaping, plurals, lengths and the DOM shortcuts', () => {
  assert.equal(ui.esc(`<a href="x">Rosa's & co</a>`), '&lt;a href=&quot;x&quot;&gt;Rosa&#39;s &amp; co&lt;/a&gt;');
  assert.equal(ui.esc(null), '');
  assert.equal(ui.plural(1, 'person', 'people'), '1 person');
  assert.equal(ui.plural(3, 'option'), '3 options');
  assert.equal(ui.lengthLabel(30), '30 min');
  assert.equal(ui.lengthLabel(60), '1 hour');
  assert.equal(ui.lengthLabel(150), '2 hr 30 min');
  assert.equal(ui.lengthLabel(1440), '1 day');
  assert.equal(ui.lengthLabel(2880), '2 days');
  assert.equal(ui.reducedMotion(), true);
  const root = { querySelector: (s) => `one ${s}`, querySelectorAll: (s) => [s, s] };
  assert.equal(ui.$('.a', root), 'one .a');
  assert.deepEqual(ui.$$('.b', root), ['.b', '.b']);
});

test('avatars: escaped initials in a colour from the name, and stacks that say how many more', () => {
  const a = ui.avatar('Priya Patel', 'av-sm');
  assert.match(a, /class="av av-sm"/);
  assert.match(a, />PP</);
  assert.match(a, /aria-hidden="true"/);
  assert.equal(a, ui.avatar('Priya Patel', 'av-sm')); // the same colour every time
  assert.match(ui.avatar('<b>'), />&lt;</);
  assert.match(ui.avatar('   '), />\?</);
  assert.equal(ui.avatarStack([]), '');
  const stack = ui.avatarStack(['Ana', 'Lee', 'Marcus'], 2);
  assert.equal(stack.match(/class="av /g).length, 3);
  assert.match(stack, /\+1</);
});

test('dates and times read naturally', () => {
  assert.match(ui.todayStr(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(+ui.dateParts('2030-01-08'), Date.UTC(2030, 0, 8));
  assert.match(ui.dayLabel('2030-01-08'), /Tue/);
  assert.match(ui.shortTime(19 * 60), /7/);
  assert.match(ui.shortTime(19 * 60 + 30), /7:30/);
  assert.match(ui.shortRange(18 * 60, 22 * 60), /6.*10/);
  assert.match(ui.shortRange(19 * 60 + 30, 21 * 60), /7:30.*9:00/);
  assert.match(ui.shortRange(20 * 60, 1440), /midnight$/);
  const day = Date.UTC(2030, 0, 8);
  const h = 3_600_000;
  assert.match(when.fmtWhen(day + 18 * h, day + 20 * h, 'UTC'), /Tue.*Jan.*8/);
  assert.match(when.fmtWhen(day, day + 24 * h, 'UTC'), /all day$/);
  assert.match(when.fmtWhen(day, day + 72 * h, 'UTC'), /Jan.*8.*10/);
  assert.equal(when.fmtTimeRange(day, day + 24 * h, 'UTC'), 'All day');
  assert.match(when.fmtTimeRange(day, day + 48 * h, 'UTC'), /Jan/);
  assert.match(when.fmtTimeRange(day + 18 * h, day + 20 * h, 'UTC'), /6:00.*8:00/);
});

test('a time range across midnight names its days, in the poll’s time zone, not in numbers', () => {
  const h = 3_600_000;
  // Fri Nov 13 2026, 11 PM to 1 AM in New York (UTC-5): Sat 04:00 to 06:00 UTC.
  const fri11pm = Date.UTC(2026, 10, 14, 4);
  const range = when.fmtTimeRange(fri11pm, fri11pm + 2 * h, 'America/New_York');
  assert.match(range, /^Fri 11:00\sPM\s– Sat 1:00\sAM$/);
  assert.doesNotMatch(range, /\d\/\d/);
  // The same instants in London are one day: no day names.
  assert.match(when.fmtTimeRange(fri11pm, fri11pm + 2 * h, 'Europe/London'), /^4:00\s–\s6:00\sAM$/);
  // Ending at midnight stays on its day.
  assert.match(when.fmtTimeRange(fri11pm - 2 * h, fri11pm + h, 'America/New_York'), /^9:00\sPM\s– 12:00\sAM$/);
  // Across a DST change (US clocks go back on Sun Nov 1 2026): the day names follow local time.
  const sat11pm = Date.UTC(2026, 10, 1, 3); // Sat Oct 31, 11 PM EDT (UTC-4)
  assert.match(when.fmtTimeRange(sat11pm, sat11pm + 4 * h, 'America/New_York'), /^Sat 11:00\sPM\s– Sun 2:00\sAM$/);
  // The start time alone, as the group's table shows it.
  assert.match(when.fmtTimeRange(sat11pm, sat11pm, 'America/New_York'), /^11:00\sPM$/);
});

test('time zones and relative times', () => {
  assert.ok(ui.tzName('America/New_York').length > 3);
  assert.equal(ui.tzName('Not/A_Zone'), 'Not/A Zone');
  const opts = ui.tzOptions('Europe/London');
  assert.match(opts, /<option value="Europe\/London" selected>Europe\/London<\/option>/);
  assert.match(opts, /value="UTC"/);
  const now = Date.now();
  assert.match(ui.ago(now - 5 * 60_000), /5 minutes ago/);
  assert.match(ui.ago(now - 3 * 3_600_000), /3 hours ago/);
  assert.match(ui.ago(now - 2 * 86_400_000), /2 days ago/);
});
