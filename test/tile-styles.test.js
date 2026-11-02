// A poll's tile style: one of Venn's own backgrounds behind its emoji, stored as a key, never drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TILE_KEYS, isTileStyle } from '../public/tile-styles.js';
import { normalizeEventInput } from '../src/validate.js';

const poll = (tile) =>
  normalizeEventInput({
    title: 'Dinner',
    timezone: 'UTC',
    dates: ['2030-01-10'],
    startMinute: 0,
    endMinute: 1440,
    slotMinutes: 1440,
    tile,
  });

test('tile styles: only the known keys are kept on a poll', () => {
  for (const key of TILE_KEYS) assert.equal(poll(key).tile, key);
  assert.equal(poll('').tile, undefined); // the plain tile
  assert.equal(poll(undefined).tile, undefined);
  for (const bad of ['neon', '__proto__', '<svg onload=alert(1)>', 'url(https://x)', 3, {}])
    assert.throws(() => poll(bad), /Unknown tile style/);
  assert.equal(isTileStyle('toString'), false);
});

test('tile styles: each one has its colour, mixed with the page so it fits every look', () => {
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  for (const key of TILE_KEYS) assert.match(styles, new RegExp(`\\[data-tile='${key}'\\] \\{\\s*--h: #[0-9a-f]{6};`), key);
  assert.match(styles, /--ta: color-mix\(in srgb, var\(--h\) \d+%, var\(--surface\)\)/);
});
