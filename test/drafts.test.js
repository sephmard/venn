import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IF_NEEDED, YES } from '../public/core.js';
import {
  answerDraftKey,
  cleanAnswerDraft,
  cleanFormDraft,
  dropStored,
  formDraftHasWork,
  formDraftKey,
  readStored,
  writeStored,
} from '../public/drafts.js';

/** A stand-in for localStorage / sessionStorage. */
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('stored drafts round-trip, and broken or missing storage is no draft', () => {
  const s = memory();
  writeStored(s, 'k', { a: 1 });
  assert.deepEqual(readStored(s, 'k'), { a: 1 });
  dropStored(s, 'k');
  assert.equal(readStored(s, 'k'), null);
  s.setItem('bad', '{not json');
  assert.equal(readStored(s, 'bad'), null);
  s.setItem('list', '[1,2]');
  assert.equal(readStored(s, 'list'), null);
  const broken = {
    getItem() {
      throw new Error('off');
    },
    setItem() {
      throw new Error('off');
    },
    removeItem() {
      throw new Error('off');
    },
  };
  assert.equal(readStored(broken, 'k'), null);
  writeStored(broken, 'k', 1); // doesn't throw
  dropStored(broken, 'k');
  assert.equal(readStored(undefined, 'k'), null);
  assert.equal(formDraftKey('free'), 'venn:draft:free');
  assert.equal(answerDraftKey('abc'), 'venn:answer-draft:abc');
});

test('a date poll draft keeps its picks, drops past days and bad values', () => {
  const d = cleanFormDraft(
    {
      title: 'Dinner',
      occasion: 3,
      location: 'Rosa’s',
      desc: '',
      organizer: 'Sam',
      privacy: [true, 'yes', false],
      picks: { days: ['2026-11-01', '2026-11-12', 7], parts: ['2026-11-12|1080'], hours: 'nope' },
      maybe: { days: ['2026-11-12'] },
      level: 'parts',
      timeLevel: 'parts',
      span: 3,
    },
    '2026-11-02',
  );
  assert.deepEqual(d.picks, { days: ['2026-11-12'], parts: ['2026-11-12|1080'], hours: [] });
  assert.deepEqual(d.maybe, { days: ['2026-11-12'], parts: [], hours: [] });
  assert.equal(d.level, 'parts');
  assert.equal(d.timeLevel, 'parts');
  assert.equal(d.span, 3);
  assert.equal(d.occasion, 3);
  assert.deepEqual(d.privacy, [true, false, false]);
  assert.equal(formDraftHasWork(d), true);

  const odd = cleanFormDraft({ title: 5, occasion: -1, picks: {}, level: 'weeks', timeLevel: 'days', span: 1.5 }, '2026-11-02');
  assert.equal(odd.title, '');
  assert.equal(odd.occasion, null);
  assert.equal(odd.level, 'days');
  assert.equal(odd.timeLevel, null);
  assert.equal(odd.span, 1);
  assert.equal(formDraftHasWork(odd), false);
  assert.equal(cleanFormDraft(null, '2026-11-02'), null);
  assert.equal(formDraftHasWork(null), false);
});

test('a vote draft keeps its options and kind', () => {
  const d = cleanFormDraft({ title: '', options: ['Rosa’s', '', 3], kind: 'yesno', single: true }, '2026-11-02');
  assert.deepEqual(d.options, ['Rosa’s', '']);
  assert.equal(d.kind, 'yesno');
  assert.equal(d.single, true);
  assert.equal(formDraftHasWork(d), true);
  const blank = cleanFormDraft({ title: '  ', options: ['', ' '], kind: 'x' }, '2026-11-02');
  assert.equal(blank.kind, 'options');
  assert.equal(formDraftHasWork(blank), false);
  // Only the name: Venn remembers that anyway, so it's not a draft worth bringing back.
  assert.equal(formDraftHasWork(cleanFormDraft({ organizer: 'Sam' }, '2026-11-02')), false);
});

test('a guest draft keeps only answers for the poll’s current times, for two weeks', () => {
  const now = Date.UTC(2026, 10, 2);
  const slots = [100, 200, 300];
  const d = cleanAnswerDraft(
    { mine: { 100: YES, 200: IF_NEEDED, 300: 9, 400: YES }, touched: ['100', '300', '999', 5], name: 'Zed', at: now - 1000 },
    slots,
    now,
  );
  assert.deepEqual(d, { mine: { 100: YES, 200: IF_NEEDED }, touched: ['100', '300'], declined: false, name: 'Zed' });
  // "None of these work" counts as an answer.
  assert.equal(cleanAnswerDraft({ mine: {}, declined: true, at: now }, slots, now).declined, true);
  // Too old, from the future, empty, or nothing at all: no draft.
  assert.equal(cleanAnswerDraft({ mine: { 100: YES }, at: now - 15 * 864e5 }, slots, now), null);
  assert.equal(cleanAnswerDraft({ mine: { 100: YES }, at: now + 1000 }, slots, now), null);
  assert.equal(cleanAnswerDraft({ mine: { 400: YES }, at: now }, slots, now), null);
  assert.equal(cleanAnswerDraft({ mine: { 100: YES } }, slots, now), null);
  assert.equal(cleanAnswerDraft(null, slots, now), null);
  assert.equal(cleanAnswerDraft({ mine: 'x', touched: ['100'], at: now }, slots, now).touched[0], '100');
});

test('a note typed with an unsent answer stays when the page saves the rest, and goes with it', () => {
  const box = new Map();
  const storage = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => box.set(k, v), removeItem: (k) => box.delete(k) };
  writeStored(storage, 'k', { mine: { 1: 2 }, at: 1 });
  writeStored(storage, 'k', { ...readStored(storage, 'k'), note: 'Can only stay till 9' });
  writeStored(storage, 'k', { mine: { 1: 1 }, at: 2 });
  assert.deepEqual(readStored(storage, 'k'), { mine: { 1: 1 }, at: 2, note: 'Can only stay till 9' });
  // Emptied on purpose, it stays empty.
  writeStored(storage, 'k', { mine: { 1: 1 }, at: 3, note: '' });
  writeStored(storage, 'k', { mine: { 1: 1 }, at: 4 });
  assert.equal(readStored(storage, 'k').note, '');
  dropStored(storage, 'k');
  assert.equal(readStored(storage, 'k'), null);
});
