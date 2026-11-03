// MCP's date-poll results (src/mcp.js) rank days and times exactly as the poll page does
// (rankTimes in public/core.js, as public/event.js calls it), and say ties as the page does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { rankTimes } from '../public/core.js';

let server, base;
before(async () => {
  server = createApp({ dbPath: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const post = async (path, body, headers = {}) =>
  (
    await fetch(`${base}/api/${path}`, {
      method: path.endsWith('settings') ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  ).json();
const results = async (id) =>
  JSON.parse(
    (
      await post('mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_venn_results', arguments: { poll: id } },
      })
    ).result.content[0].text,
  );

const DATES = ['2030-01-10', '2030-01-11', '2030-01-12', '2030-01-13'];
const KINDS = {
  days: { dates: DATES, startMinute: 0, endMinute: 1440, slotMinutes: 1440, durationMinutes: 1440 },
  trip: { dates: DATES, startMinute: 0, endMinute: 1440, slotMinutes: 1440, durationMinutes: 2880 },
  hours: { dates: DATES.slice(0, 1), startMinute: 18 * 60, endMinute: 22 * 60, slotMinutes: 60, durationMinutes: 120 },
  times: {
    mode: 'options',
    options: [18, 19, 20].map((h) => ({ start: Date.UTC(2030, 0, 10, h), end: Date.UTC(2030, 0, 10, h + 1) })),
  },
};

// Answers by slot index (0 = the first day or time): 2 yes, 1 if needed.
const CASES = [
  ['days', 'no answers', [], 'Nobody has answered yet.'],
  ['days', 'nobody can', [{}, {}], '2 answered, but no day works for anyone yet.'],
  ['days', 'a clear best', [{ 1: 2 }, { 1: 2, 2: 1 }], 'Fri, Jan 11 works best: everyone can make it.'],
  [
    'days',
    'a tie',
    [{ 0: 2 }, { 2: 2 }],
    'Tied: Thu, Jan 10 and Sat, Jan 12; for each, 1 of 2 can make it. No single best day yet.',
  ],
  [
    'days',
    'more people beat more yeses',
    [{ 0: 2, 1: 2 }, { 0: 2, 1: 1 }, { 1: 1 }],
    'Fri, Jan 11 works best: 3 of 3 can make it, 2 if needed.',
  ],
  ['days', 'if needed only', [{ 3: 1 }, { 3: 1 }], 'Sun, Jan 13 works best: all 2 can make it if needed.'],
  ['days', 'one answer', [{ 2: 2 }], 'Sat, Jan 12 works best: it works for the one person so far.'],
  [
    'trip',
    'the best run of days',
    [
      { 1: 2, 2: 2 },
      { 1: 2, 2: 2, 3: 2 },
    ],
    'Fri, Jan 11 – Sat, Jan 12 works best: everyone can make it.',
  ],
  [
    'trip',
    'runs as good as each other',
    [{ 0: 2, 1: 2, 2: 2, 3: 2 }],
    /works best: it works for the one person so far\. Other runs of days work as well\.$/,
  ],
  ['trip', 'no run works', [{ 0: 2, 2: 2 }], '1 answered, but no run of days works for anyone yet.'],
  [
    'hours',
    'a meeting of two hours',
    [
      { 1: 2, 2: 2 },
      { 1: 2, 2: 1, 3: 2 },
    ],
    'Thu, Jan 10, 7:00 PM – 9:00 PM works best: 2 of 2 can make it, 1 if needed.',
  ],
  [
    'times',
    'equal times',
    [{ 0: 2 }, { 2: 2 }], // The page names ties only on whole days (event.js), so equal times are noted, not listed.
    'Thu, Jan 10, 6:00 PM – 7:00 PM works best: 1 of 2 can make it. Other times work as well.',
  ],
];

for (const [kind, name, answers, summary] of CASES)
  test(`date parity: ${kind}, ${name}`, async () => {
    const { id } = await post('events', { title: 'Plan', timezone: 'UTC', ...KINDS[kind] });
    const ev0 = await (await fetch(`${base}/api/events/${id}`)).json();
    for (const [i, marks] of answers.entries())
      await post(`events/${id}/participants`, {
        name: `P${i}`,
        availability: Object.fromEntries(Object.entries(marks).map(([k, v]) => [ev0.slots[k], v])),
      });
    const ev = await (await fetch(`${base}/api/events/${id}`)).json();
    const page = rankTimes(ev, ev.slots, ev.participants, Infinity);
    const data = await results(id);
    // Same days or times, in the same order, with the same people, and nothing nobody can make.
    assert.deepEqual(
      data.best.map((b) => [Date.parse(b.start), Date.parse(b.end), b.available, b.ifNeeded, b.who]),
      page.slice(0, 5).map((r) => [r.start, r.end, r.yes.length, r.ifNeeded.length, { available: r.yes, ifNeeded: r.ifNeeded }]),
    );
    assert.ok(data.best.every((b) => b.available + b.ifNeeded > 0));
    if (summary instanceof RegExp) assert.match(data.summary, summary);
    else assert.equal(data.summary, summary);
    // What's leading is the best, and the ones tied with it.
    if (page.length) assert.equal(data.leading[0], data.best[0].when);
    else assert.deepEqual(data.leading, []);
  });

test('date results keep hidden names and hidden answers hidden', async () => {
  const made = await post('events', { title: 'Plan', timezone: 'UTC', ...KINDS.days });
  const admin = { 'x-admin-token': made.adminToken };
  const ev = await (await fetch(`${base}/api/events/${made.id}`)).json();
  await post(`events/${made.id}/participants`, { name: 'Ana', availability: { [ev.slots[0]]: 2 } });
  await post(`events/${made.id}/settings`, { hideNames: true }, admin);
  let data = await results(made.id);
  assert.equal(JSON.stringify(data).includes('Ana'), false);
  assert.equal(data.best[0].who, undefined);
  assert.equal(data.summary, 'Thu, Jan 10 works best: it works for the one person so far.');
  await post(`events/${made.id}/finalize`, { start: ev.slots[0] }, admin);
  await post(`events/${made.id}/settings`, { hideResults: true }, admin);
  data = await results(made.id);
  assert.equal(data.answers, 1);
  assert.equal(data.best, undefined);
  assert.equal(data.picked, 'Thu, Jan 10');
  assert.equal(data.summary, 'The organizer picked Thu, Jan 10. The organizer hid the answers.');
});
