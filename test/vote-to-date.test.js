import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPIC_TEMPLATES } from '../public/topic-templates.js';
import { TEMPLATES, slug } from '../public/templates.js';

// topic-poll.js adds its stylesheet when it loads; a stand-in document is enough for its links.
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({}),
  head: { append: (el) => el.onload?.() },
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.matchMedia = () => ({ matches: false });
const { dateLink } = await import('../public/topic-organizer.js');
const starters = await import('../public/topic-templates.js');

// A decided vote: its question, its emoji and its options, the first one picked.
const decided = (title, emoji, labels, more = {}) => ({
  title,
  emoji,
  options: labels.map((label, i) => ({ id: i + 1, label })),
  picked: 1,
  ...more,
});
const query = (ev) => Object.fromEntries(new URL(dateLink(ev, 'abc123', starters), 'https://venn.day').searchParams);

test('find a date for it: a starter keeps what the vote was about', () => {
  assert.deepEqual(query(decided('Where should we eat?', '🍜', ['Luigi’s', 'Rosa’s'])), {
    title: 'Dinner at Luigi’s',
    after: 'abc123',
    template: 'dinner',
    where: 'Luigi’s',
  });
  assert.deepEqual(query(decided('Which book should we read next?', '📚', ['Piranesi', 'Dune'])), {
    title: 'Book club: Piranesi',
    after: 'abc123',
    template: 'book-club',
  });
  const trip = query(decided('Where should we go?', '🧭', ['Lisbon', 'Porto']));
  assert.equal(trip.title, 'Trip to Lisbon');
  assert.equal(trip.template, 'trip');
  assert.equal(trip.where, 'Lisbon');
  // What the vote was about, even if the question was reworded.
  assert.equal(query(decided('Friday: ramen or pizza?', '🍜', ['Ramen Bar'])).title, 'Dinner at Ramen Bar');
});

test('find a date for it: a vote without a starter, or one without a name for it, names the pick alone', () => {
  assert.deepEqual(query(decided('Where should we eat?', '🗳️', ['Luigi’s'])), {
    title: 'Luigi’s',
    after: 'abc123',
    where: 'Luigi’s',
  });
  assert.deepEqual(query(decided('What should we do?', '🎳', ['Bowling'])), { title: 'Bowling', after: 'abc123' });
  // Yes or no: the question is the plan.
  const yes = decided('Should we do a book swap?', '👍', ['Yes', 'No'], { single: true });
  assert.deepEqual(query(yes), { title: 'Should we do a book swap?', after: 'abc123' });
});

test('find a date for it: the pick is used as typed, the name stays in bounds, a brand keeps its own form', () => {
  // "$&" and "$'" are text here, not replacement patterns.
  assert.equal(query(decided('Where should we eat?', '🍜', ["$& $' Diner"])).title, "Dinner at $& $' Diner");
  assert.equal(query(decided('Where should we eat?', '🍜', ['x'.repeat(120)])).title.length, 120);
  const branded = query(decided('Where should we eat?', '🍜', ['Luigi’s'], { brand: { id: 'acme' } }));
  assert.equal(branded.title, 'Dinner at Luigi’s');
  assert.equal(branded.brand, 'acme');
  assert.equal(branded.template, undefined);
});

test('vote starters name real date templates, and {option} once', () => {
  const plans = new Set(TEMPLATES.map(slug));
  for (const t of TOPIC_TEMPLATES) {
    if (t.plan) assert.ok(plans.has(t.plan), t.id);
    if (t.then) assert.equal(t.then.split('{option}').length, 2, t.id);
  }
});
