import { test } from 'node:test';
import assert from 'node:assert/strict';

// ui.js looks up the page's elements when it loads; a stand-in document is enough for these helpers.
globalThis.document ??= { getElementById: () => null };
const { chipLevel, ownHours, partsWindows, syncHours, timedDays, zoom } = await import('../public/paint.js');

// What's picked at each level on the create page, as create-free.js keeps it.
const state = () => {
  const s = { days: new Set(), parts: new Set(), hours: new Set(), defaultParts: new Set(['morning', 'afternoon', 'evening']) };
  s.maybe = { days: new Set(), parts: new Set(), hours: new Set() };
  return s;
};
const D = '2030-01-10';
const draw = (s, from, to) => {
  for (let m = from; m < to; m += 30) s.hours.add(`${D}|${m}`);
};

test("times drawn in hours are a day's own; the whole day or its parts are not", () => {
  const s = state();
  draw(s, 1140, 1200);
  assert.deepEqual(ownHours(s, D), [{ date: D, start: 1140, end: 1200 }]);
  s.hours.clear();
  draw(s, 1080, 1320); // the evening, exactly
  assert.equal(ownHours(s, D), null);
});

test('a day with times of its own keeps them through days and parts of the day', () => {
  const s = state();
  draw(s, 1140, 1200);
  zoom(s, 'hours', 'days');
  assert.deepEqual(timedDays(s, 'hours').get(D), [{ date: D, start: 1140, end: 1200 }]);
  zoom(s, 'days', 'parts');
  assert.deepEqual([...s.parts], [`${D}|1080`]); // its evening is lit
  assert.deepEqual(partsWindows(s), [{ date: D, start: 1140, end: 1200 }]);
  assert.deepEqual(timedDays(s, 'parts').get(D), [{ date: D, start: 1140, end: 1200 }]);
  assert.equal(chipLevel(s, 'parts', 'parts', `${D}|1140|1200`), 'hours');
});

test('on parts of the day, a part made if needed or taken away does the same to its times', () => {
  const s = state();
  draw(s, 1140, 1200);
  s.parts.add(`${D}|1080`);
  const was = new Set(s.parts);
  s.maybe.parts.add(`${D}|1080`);
  syncHours(s, was, new Set());
  assert.deepEqual([...s.maybe.hours].sort(), [`${D}|1140`, `${D}|1170`]);
  s.parts.delete(`${D}|1080`);
  syncHours(s, was, new Set(s.maybe.parts));
  assert.equal(s.hours.size, 0);
});

test('on days, a whole day chip is the day; times follow the last time level', () => {
  const s = state();
  s.days.add(D);
  assert.equal(chipLevel(s, 'days', 'parts', `${D}|540|1320`), 'days');
  assert.equal(chipLevel(s, 'days', 'parts', `${D}|1080|1320`), 'parts');
});
