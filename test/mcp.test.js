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
    available: 2,
    ifNeeded: 0,
    who: { available: ['Bo', 'Cy'], ifNeeded: [] },
  });
  assert.equal(data.options.length, 3);
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
