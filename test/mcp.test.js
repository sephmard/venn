import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

// Venn as an MCP server (/api/mcp): an assistant makes a Venn and reads its answers.
let server, base;
before(async () => {
  server = createApp({ env: {} });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

let nextId = 1;
async function rpc(method, params, { id = nextId++ } = {}) {
  const res = await fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', ...(id != null && { id }), method, ...(params && { params }) }),
  });
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
}
const tool = async (name, args) => {
  const { body } = await rpc('tools/call', { name, arguments: args });
  return { ...body.result, data: body.result.isError ? body.result.content[0].text : JSON.parse(body.result.content[0].text) };
};

test('initialize, the initialized notification, and the tools on offer', async () => {
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal(init.body.result.serverInfo.name, 'venn');
  assert.deepEqual(init.body.result.capabilities, { tools: { listChanged: false } });
  // A version it doesn't know gets the newest it does.
  assert.equal((await rpc('initialize', { protocolVersion: '1999-01-01' })).body.result.protocolVersion, '2025-11-25');
  assert.equal((await rpc('notifications/initialized', null, { id: null })).status, 202);
  const { body } = await rpc('tools/list');
  assert.deepEqual(
    body.result.tools.map((t) => t.name),
    ['create_venn', 'get_venn_results'],
  );
  assert.equal((await rpc('nope')).body.error.code, -32601);
  assert.equal((await fetch(`${base}/api/mcp`)).status, 405);
  assert.equal((await fetch(`${base}/api/mcp`, { method: 'POST', body: '{' })).status, 400);
});

test('create a Venn of whole days, answer it, and read the results', async () => {
  const made = await tool('create_venn', {
    title: 'Book club',
    timezone: 'Europe/London',
    days: ['2030-01-10', '2030-01-11', '2030-01-12'],
    organizer: 'Ana',
  });
  assert.equal(made.isError, undefined);
  const id = made.data.link.match(/\/e\/(\w+)$/)[1];
  assert.match(made.data.organizerLink, new RegExp(`/e/${id}#admin=\\w+$`));
  const ev = await (await fetch(`${base}/api/events/${id}`)).json();
  assert.deepEqual(ev.dates, ['2030-01-10', '2030-01-11', '2030-01-12']);
  const [fri, sat] = ev.slots.slice(1);
  for (const [name, availability] of [
    ['Bo', { [fri]: 2, [sat]: 1 }],
    ['Cy', { [fri]: 2 }],
  ])
    await fetch(`${base}/api/events/${id}/participants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, availability }),
    });
  const { data } = await tool('get_venn_results', { poll: made.data.link });
  assert.equal(data.title, 'Book club');
  assert.equal(data.answers, 2);
  assert.deepEqual(data.best[0], {
    when: 'Fri, Jan 11',
    start: new Date(fri).toISOString(),
    end: new Date(sat).toISOString(),
    available: 2,
    ifNeeded: 0,
    who: { available: ['Bo', 'Cy'], ifNeeded: [] },
  });
  assert.equal(data.options.length, 3);
  // Ranked as on the page, and only days someone can make.
  assert.deepEqual(
    data.best.map((b) => b.when),
    ['Fri, Jan 11', 'Sat, Jan 12'],
  );
  assert.deepEqual(data.leading, ['Fri, Jan 11']);
  assert.equal(data.summary, 'Fri, Jan 11 works best: everyone can make it.');
});

test('create a Venn of specific times; mistakes come back as tool errors', async () => {
  const made = await tool('create_venn', {
    title: 'Call',
    timezone: 'UTC',
    times: [{ start: '2030-01-10T18:00:00Z', end: '2030-01-10T19:00:00Z' }],
  });
  const id = made.data.link.match(/\/e\/(\w+)$/)[1];
  const ev = await (await fetch(`${base}/api/events/${id}`)).json();
  assert.equal(ev.mode, 'options');
  assert.deepEqual(ev.slots, [Date.UTC(2030, 0, 10, 18)]);
  assert.equal((await tool('create_venn', { title: 'x', timezone: 'UTC' })).isError, true);
  assert.equal(
    (await tool('create_venn', { title: 'x', timezone: 'UTC', times: [{ start: 'soon', end: 'later' }] })).isError,
    true,
  );
  const bad = await tool('create_venn', { title: 'x', timezone: 'Mars/Base', days: ['2030-01-10'] });
  assert.equal(bad.isError, true);
  assert.match(bad.data, /time zone/i);
  assert.equal((await tool('get_venn_results', { poll: 'https://venn.day/e/nothere' })).isError, true);
  assert.equal((await tool('get_venn_results', { poll: '' })).isError, true);
});

// A vote (topic poll): options instead of dates.
const post = (path, body, headers = {}) =>
  fetch(`${base}/api/${path}`, {
    method: path.endsWith('settings') ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
async function vote(args) {
  const made = await tool('create_venn', { title: 'Dinner', timezone: 'Europe/London', ...args });
  assert.equal(made.isError, undefined, made.data);
  const id = made.data.link.match(/\/e\/(\w+)$/)[1];
  const admin = { 'x-admin-token': made.data.organizerLink.split('#admin=')[1] };
  const answer = (name, availability) => post(`events/${id}/participants`, { name, availability });
  const results = async () => (await tool('get_venn_results', { poll: id })).data;
  return { id, admin, answer, results };
}

test('create a vote from options, and its results say plainly where things stand', async () => {
  const { id, admin, answer, results } = await vote({ options: [' Italian ', 'Thai', 'Mexican'] });
  const ev = await (await fetch(`${base}/api/events/${id}`)).json();
  assert.equal(ev.mode, 'topic');
  assert.deepEqual(ev.options, [
    { id: 1, label: 'Italian' },
    { id: 2, label: 'Thai' },
    { id: 3, label: 'Mexican' },
  ]);
  assert.equal(ev.single, undefined);

  // Nobody yet: no leader, no dates from 1970.
  let data = await results();
  assert.equal(data.kind, 'vote');
  assert.equal(data.answers, 0);
  assert.equal(data.summary, 'Nobody has answered yet.');
  assert.deepEqual(data.leading, []);
  assert.deepEqual(data.options[0], { option: 'Italian', yes: 0, ifNeeded: 0, who: { yes: [], ifNeeded: [] } });
  assert.doesNotMatch(JSON.stringify(data), /1970/);

  // Answered, but no to everything.
  await answer('Ana', {});
  data = await results();
  assert.match(data.summary, /^1 answered, but nobody said yes or if needed/);
  assert.deepEqual(data.leading, []);

  // A tie.
  await answer('Bo', { 1: 2, 2: 2 });
  data = await results();
  assert.deepEqual(data.leading, ['Italian', 'Thai']);
  assert.equal(data.summary, 'Tied: Italian and Thai, 1 of 2 would go to each. No single favourite yet.');

  // A clear leader, with names.
  await answer('Cy', { 2: 2, 3: 1 });
  data = await results();
  assert.deepEqual(data.leading, ['Thai']);
  assert.equal(data.summary, 'Thai leads: 2 of 3 would go.');
  assert.deepEqual(data.options[1], { option: 'Thai', yes: 2, ifNeeded: 0, who: { yes: ['Bo', 'Cy'], ifNeeded: [] } });
  assert.deepEqual(data.options[2], { option: 'Mexican', yes: 0, ifNeeded: 1, who: { yes: [], ifNeeded: ['Cy'] } });
  assert.equal(data.picked, undefined);

  // Picked, and names hidden.
  assert.equal((await post(`events/${id}/finalize`, { option: 2 }, admin)).status, 200);
  assert.equal((await post(`events/${id}/settings`, { hideNames: true }, admin)).status, 200);
  data = await results();
  assert.equal(data.picked, 'Thai');
  assert.match(data.summary, /^The organizer picked Thai\. Thai leads/);
  assert.equal(JSON.stringify(data).includes('"Bo"'), false);
  assert.equal(data.options[1].who, undefined);

  // Answers hidden: only the count and what was picked.
  assert.equal((await post(`events/${id}/settings`, { hideResults: true }, admin)).status, 200);
  data = await results();
  assert.equal(data.answers, 3);
  assert.equal(data.options, undefined);
  assert.equal(data.summary, 'The organizer picked Thai. The organizer hid the answers.');
});

test('a pick-one vote counts picks, and a tie with if-needed says so', async () => {
  const one = await vote({ options: ['Yes', 'No'], single: true });
  await one.answer('Ana', { 1: 2 });
  await one.answer('Bo', { 2: 2 });
  let data = await one.results();
  assert.equal(data.single, true);
  assert.equal(data.summary, 'Tied: Yes and No, with 1 of 2 picks each. No single favourite yet.');
  await one.answer('Cy', { 1: 2 });
  data = await one.results();
  assert.equal(data.summary, 'Yes leads: 2 of 3 picked it.');
  assert.match(
    (await vote({ options: ['A', 'B'] }).then((v) => v.answer('Di', { 1: 1 }).then(v.results))).summary,
    /\(1 if needed\)/,
  );
  const many = await vote({ options: ['A', 'B', 'C'] });
  await many.answer('Ed', { 1: 1, 2: 1, 3: 1 });
  assert.equal(
    (await many.results()).summary,
    'Tied: A, B and C, 1 of 1 would go to each (1 if needed). No single favourite yet.',
  );
});

test('create_venn takes exactly one of days, times or options, and says what to fix', async () => {
  const err = async (args) => {
    const r = await tool('create_venn', { title: 'x', timezone: 'UTC', ...args });
    assert.equal(r.isError, true, JSON.stringify(args));
    return r.data;
  };
  assert.match(await err({}), /exactly one of days, times or options/);
  assert.match(await err({ days: ['2030-01-10'], options: ['A'] }), /exactly one/);
  assert.match(
    await err({ times: [{ start: '2030-01-10T18:00:00Z', end: '2030-01-10T19:00:00Z' }], options: ['A'] }),
    /exactly one/,
  );
  assert.match(await err({ options: [] }), /exactly one/);
  assert.match(await err({ times: 'tonight' }), /ISO 8601/);
  assert.match(await err({ days: ['2030-01-10'], single: true }), /single only applies to options/);
  assert.match(await err({ options: 'A, B' }), /must be a list/);
  assert.match(await err({ options: ['A', 3] }), /non-empty text label/);
  assert.match(await err({ options: ['A', '  '] }), /non-empty text label/);
  assert.match(await err({ options: ['A', 'x'.repeat(121)] }), /at most 120 characters/);
  assert.match(await err({ options: ['Thai', 'thai '] }), /"thai" is in the options twice/);
  assert.match(await err({ options: Array.from({ length: 21 }, (_, i) => `O${i}`) }), /at most 20 options \(21 given\)/);
  assert.match(await err({ options: ['Only'], single: true }), /at least two options/);
  // The API's own checks still come back as tool errors.
  assert.match(await err({ title: '', options: ['A', 'B'] }), /Title is required/);
  // One option, and single: false with days, are fine.
  assert.equal((await tool('create_venn', { title: 'Go?', timezone: 'UTC', options: ['Yes'] })).isError, undefined);
  assert.equal(
    (await tool('create_venn', { title: 'x', timezone: 'UTC', days: ['2030-01-10'], single: false })).isError,
    undefined,
  );
});

test('a date poll with hidden answers still says how many answered', async () => {
  const made = await tool('create_venn', { title: 'Lunch', timezone: 'UTC', days: ['2030-02-01'] });
  const id = made.data.link.match(/\/e\/(\w+)$/)[1];
  const admin = { 'x-admin-token': made.data.organizerLink.split('#admin=')[1] };
  const ev = await (await fetch(`${base}/api/events/${id}`)).json();
  await post(`events/${id}/participants`, { name: 'Ana', availability: { [ev.slots[0]]: 2 } });
  await post(`events/${id}/settings`, { hideResults: true }, admin);
  const { data } = await tool('get_venn_results', { poll: id });
  assert.equal(data.answers, 1);
  assert.equal(data.note, 'The organizer hid the answers.');
  assert.equal(data.best, undefined);
});

test('the tools tell an assistant when to vote and when to find a date', async () => {
  const { body } = await rpc('tools/list');
  const create = body.result.tools.find((t) => t.name === 'create_venn');
  assert.deepEqual(Object.keys(create.inputSchema.properties).slice(2, 6), ['days', 'times', 'options', 'single']);
  assert.match(create.description, /exactly one of/);
  assert.match(create.description, /options/);
});
