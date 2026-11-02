// The store's setup: how a cold server makes its tables before its first query.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStore, d1Adapter, sqliteAdapter } from '../src/store.js';

/** A database that counts round trips, and can fail its first batch. */
function counting({ failFirst = false } = {}) {
  const sqlite = sqliteAdapter(new DatabaseSync(':memory:'));
  const calls = { batch: 0, run: 0 };
  let fail = failFirst;
  return {
    calls,
    db: {
      ...sqlite,
      run: (sql, params) => (calls.run++, sqlite.run(sql, params)),
      async batch(sqls) {
        calls.batch++;
        if (fail) {
          fail = false;
          throw new Error('D1 unavailable');
        }
        for (const sql of sqls) await sqlite.run(sql, []);
      },
    },
  };
}

test('a cold server makes every table in one batch, once', async () => {
  const { db, calls } = counting();
  const store = createStore(db);
  await Promise.all([store.getEvent('nope'), store.getEvent('nope2'), store.getSessionUser('x', Date.now())]);
  assert.equal(calls.batch, 1);
  assert.equal(calls.run, 0);
});

test('when making the tables fails, the next request tries again', async () => {
  const { db, calls } = counting({ failFirst: true });
  const store = createStore(db);
  await assert.rejects(store.getEvent('nope'), /D1 unavailable/);
  assert.equal(await store.getEvent('nope'), null);
  assert.equal(calls.batch, 2);
});

test('the D1 adapter sends a batch as prepared statements in one call', async () => {
  const seen = [];
  const d1 = { prepare: (sql) => ({ sql }), batch: async (stmts) => seen.push(stmts.map((s) => s.sql)) };
  await d1Adapter(d1).batch(['CREATE TABLE a (x)', 'CREATE TABLE b (y)']);
  assert.deepEqual(seen, [['CREATE TABLE a (x)', 'CREATE TABLE b (y)']]);
});
