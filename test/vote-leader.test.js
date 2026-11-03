import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IF_NEEDED, YES } from '../public/core.js';

// topic-poll.js adds its stylesheet when it loads; a stand-in document is enough for its tally.
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({}),
  head: { append: (el) => el.onload?.() },
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.matchMedia = () => ({ matches: false });
const { leaderLabel, tally } = await import('../public/topic-poll.js');

// A poll from answers: { name: { option: YES | IF_NEEDED } }.
const poll = (answers, single = false) => ({
  single,
  options: ['Rosa’s', 'Luigi’s', 'Taco Spot'].map((label, id) => ({ id: String(id), label })),
  participants: Object.entries(answers).map(([name, a]) => ({ name, availability: a })),
});
const label = (answers, single) => {
  const ev = poll(answers, single);
  return leaderLabel(tally(ev), { single, total: ev.participants.length });
};

test('the leader is "Favourite" only when it has the most yeses too', () => {
  // Rosa's: 2 yes. A favourite.
  assert.equal(label({ Ana: { 0: YES }, Ben: { 0: YES, 1: YES } }), 'Favourite so far');
  // The leader by "would go" has 1 yes, another has 2: not a favourite.
  assert.equal(
    label({ Ana: { 0: YES, 2: YES }, Ben: { 0: YES, 2: IF_NEEDED }, Cy: { 2: IF_NEEDED }, Di: { 1: YES } }),
    'Works for the most so far',
  );
});

test('a leader on "if needed" alone isn’t anyone’s favourite (the bug: 0 yes, called Favourite)', () => {
  // Taco Spot: both would go, if needed. Rosa's and Luigi's: 1 yes each.
  const answers = { Ana: { 0: YES, 2: IF_NEEDED }, Ben: { 1: YES, 2: IF_NEEDED } };
  const ev = poll(answers);
  assert.equal(tally(ev)[0].o.label, 'Taco Spot'); // the ranking stays
  assert.equal(label(answers), 'Everyone could go');
  // Not everyone: it works for the most.
  assert.equal(label({ Ana: { 2: IF_NEEDED }, Ben: {}, Cy: {} }), 'Works for the most so far');
});

test('ties and one-pick polls keep their words', () => {
  assert.equal(label({ Ana: { 0: YES }, Ben: { 1: YES } }), 'Tied');
  assert.equal(label({ Ana: { 0: YES }, Ben: { 0: YES } }, true), 'Most picked so far');
});
