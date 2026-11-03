// The curl examples in the docs run against the real API, so the docs can't drift from it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../server.js';

let server, base;
before(async () => {
  server = createApp({ dbPath: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

/** Every ```sh block that runs curl: its method, path, headers and JSON body. */
function curls(file) {
  const md = readFileSync(new URL(`../docs/${file}`, import.meta.url), 'utf8');
  return [...md.matchAll(/```sh\n([\s\S]*?)```/g)]
    .map((m) => m[1].replace(/\\\n\s*/g, ' '))
    .filter((cmd) => /^curl /.test(cmd))
    .map((cmd) => ({
      cmd,
      method: /-X (\w+)/.exec(cmd)?.[1] ?? 'GET',
      path: /https:\/\/venn\.day(\/\S+)/.exec(cmd)[1],
      headers: Object.fromEntries([...cmd.matchAll(/-H '([^:]+): ([^']+)'/g)].map((h) => [h[1], h[2]])),
      body: /-d '([^']+)'/.exec(cmd)?.[1],
    }));
}

for (const file of ['API.md', 'MCP.md'])
  test(`the curl examples in docs/${file} work`, async () => {
    const examples = curls(file);
    assert.ok(examples.length, `no curl examples found in docs/${file}`);
    for (const { cmd, method, path, headers, body } of examples) {
      if (body) JSON.parse(body); // the example itself is valid JSON
      const res = await fetch(base + path, { method, headers, body });
      assert.ok(res.ok, `${cmd}\n→ ${res.status} ${await res.clone().text()}`);
      const data = await res.json();
      // An MCP tool call that went wrong still answers 200, with isError.
      assert.notEqual(data.result?.isError, true, `${cmd}\n→ ${JSON.stringify(data)}`);
    }
  });
