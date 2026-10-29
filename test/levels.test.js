import { test } from 'node:test';
import assert from 'node:assert/strict';

// ui.js looks up the page's elements when it loads; a stand-in document is enough for these helpers.
globalThis.document ??= { getElementById: () => null };
const {
  chipLevel,
  dropDays,
  ownHours,
  partsWindows,
  syncHours,
  tidy,
  timedDays,
  toWindows,
  windowKeys,
  windowList,
  windowWhat,
  windowsAt,
  zoom,
} = await import('../public/levels.js');

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
  assert.equal(chipLevel(s, 'days', 'parts', `${D}|420|1440`), 'days');
  assert.equal(chipLevel(s, 'days', 'parts', `${D}|1080|1320`), 'parts');
});

test('parts of the day carry into hours, by way of days too, if needed and all', () => {
  const s = state();
  s.days.add(D);
  s.parts.add(`${D}|720`).add(`${D}|1080`);
  s.maybe.parts.add(`${D}|1080`);
  zoom(s, 'parts', 'days');
  zoom(s, 'days', 'hours');
  const ws = windowsAt(s, 'hours').map((w) => [w.start, w.end, !!w.maybe]);
  assert.deepEqual(ws, [
    [720, 1020, false],
    [1080, 1320, true],
  ]);
});

test('hours go up to parts of the day and back, keeping what was drawn and painting the rest', () => {
  const s = state();
  draw(s, 1140, 1200);
  zoom(s, 'hours', 'parts');
  assert.deepEqual([...s.parts], [`${D}|1080`]);
  s.parts.add(`${D}|540`); // the morning, added on parts of the day
  zoom(s, 'parts', 'hours');
  assert.deepEqual(toWindows(s.hours), [
    { date: D, start: 540, end: 720 },
    { date: D, start: 1140, end: 1200 },
  ]);
  // Every part: the whole day, 7 AM to midnight.
  const w = state();
  for (const m of [540, 720, 1080]) w.parts.add(`${D}|${m}`);
  zoom(w, 'parts', 'hours');
  assert.deepEqual(toWindows(w.hours), [{ date: D, start: 420, end: 1440 }]);
  // A new day on parts of the day gets the usual parts; days back from hours are the days drawn on.
  const n = state();
  n.days.add(D);
  zoom(n, 'days', 'parts');
  assert.equal(n.parts.size, 3);
  zoom(n, 'parts', 'days');
  assert.deepEqual([...n.days], [D]);
});

test('removing from the list: a day or part left without times goes; a day taken away takes its times', () => {
  const s = state();
  s.days.add(D);
  draw(s, 1140, 1200);
  s.parts.add(`${D}|1080`).add(`${D}|540`);
  for (const k of windowKeys('hours', `${D}|1140|1200`)) s.hours.delete(k);
  tidy(s, 'parts', 'hours', [D]);
  assert.equal(s.parts.size, 0);
  tidy(s, 'days', 'hours', [D]);
  assert.equal(s.days.size, 0);
  const t = state();
  draw(t, 1140, 1200);
  t.parts.add(`${D}|1080`);
  dropDays(t, new Set([D]));
  assert.equal(t.hours.size + t.parts.size, 0);
});

test('the list: a chip a time, days alike together, and what a × asks', () => {
  const chip = (flip, rm, text, label, m) => `[${text}${m ? '?' : ''}]`;
  const range = (ds) => ds.join('+');
  const next = '2030-01-11';
  const ws = [
    { date: D, start: 1140, end: 1200 },
    { date: next, start: 1140, end: 1200 },
    ...[540, 720, 1080].map((m, i) => ({ date: '2030-01-13', start: m, end: [720, 1020, 1320][i], maybe: true })),
  ];
  const html = windowList(ws, chip, range);
  assert.match(html, /2030-01-10\+2030-01-11<\/span><span class="chips">\[7\s–\s8\sPM\]/);
  assert.match(html, /\[All day\?\]/);
  assert.deepEqual(windowKeys('parts', `${D},${next}|1080|1320`), [`${D}|1080`, `${next}|1080`]);
  assert.equal(windowWhat('parts', `${D},${next}|1080|1320`), 'these 2 evenings');
  assert.equal(windowWhat('parts', `${D},${next}|420|1440`), 'these 2 days');
  assert.match(windowWhat('hours', `${D},${next}|1140|1200`), /^7\s–\s8\sPM on these 2 days$/);
});
