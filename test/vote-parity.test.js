// MCP's vote results (src/mcp.js) rank options exactly as the poll page does (tally and leaders
// in public/topic-poll.js), on the same answers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createApp } from '../server.js';

/**
 * The page's own ranking of a poll. topic-poll.js draws the page, so it's loaded in a child process
 * with a stub DOM, and outside coverage: its drawing code isn't what this tests.
 */
function onThePage(ev) {
  // Node passes coverage on to child processes unless the variable is set, so it's set empty.
  const env = { ...process.env, NODE_V8_COVERAGE: '' };
  const script = `
    globalThis.document = { getElementById: () => null, head: { append() {} }, createElement: () => ({}) };
    const { tally, leaders } = await import(${JSON.stringify(new URL('../public/topic-poll.js', import.meta.url).href)});
    const rows = tally(JSON.parse(process.argv[1]));
    console.log(JSON.stringify({
      leading: leaders(rows).map((r) => r.o.label),
      counts: rows.map((r) => [r.o.label, r.yes.length, r.maybe.length]),
    }));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(ev)], { env }));
}

let server, base;
before(async () => {
  server = createApp({ dbPath: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const post = async (path, body) =>
  (
    await fetch(`${base}/api/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json();

const CASES = [
  ['no answers', {}, []],
  ['no to everything', {}, [{}, {}]],
  ['a clear leader', {}, [{ 2: 2 }, { 2: 2, 3: 1 }, { 1: 2 }]],
  ['a tie on yes', {}, [{ 1: 2 }, { 3: 2 }]],
  ['if needed only', {}, [{ 2: 1 }, { 3: 1 }, { 3: 1 }]],
  ['more people beat more yeses', {}, [{ 1: 2, 2: 2 }, { 1: 2, 2: 1 }, { 2: 1 }]],
  [
    'same total, more yeses win',
    {},
    [
      { 1: 1, 2: 2 },
      { 1: 1, 2: 1 },
    ],
  ],
  ['all three tied with if needed', {}, [{ 1: 1, 2: 1, 3: 1 }]],
  ['later option leads', {}, [{ 3: 2 }, { 3: 2 }, { 1: 2 }]],
  ['pick one: a tie', { single: true }, [{ 1: 2 }, { 2: 2 }]],
  ['pick one: a leader', { single: true }, [{ 3: 2 }, { 3: 2 }, { 1: 2 }]],
];

for (const [name, extra, answers] of CASES)
  test(`vote parity: ${name}`, async () => {
    const made = await post('mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'create_venn', arguments: { title: 'Dinner', timezone: 'UTC', options: ['A', 'B', 'C'], ...extra } },
    });
    const id = JSON.parse(made.result.content[0].text).link.split('/e/')[1];
    for (const [i, availability] of answers.entries()) await post(`events/${id}/participants`, { name: `P${i}`, availability });
    const ev = await (await fetch(`${base}/api/events/${id}`)).json();
    const page = onThePage(ev);
    const mcp = await post('mcp', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_venn_results', arguments: { poll: id } },
    });
    const data = JSON.parse(mcp.result.content[0].text);
    assert.deepEqual(data.leading, page.leading);
    // Every option's counts match the page's too.
    for (const [label, yes, ifNeeded] of page.counts) {
      const o = data.options.find((x) => x.option === label);
      assert.deepEqual([o.yes, o.ifNeeded], [yes, ifNeeded]);
    }
  });
