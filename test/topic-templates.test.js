import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPIC_TEMPLATES, topicTemplate } from '../public/topic-templates.js';
import { TEMPLATES, slug } from '../public/templates.js';
import { LIMITS } from '../public/core.js';
import { isEmoji } from '../public/emoji.js';
import { cleanUsage, planOf } from '../src/usage.js';
import { cleanFormDraft } from '../public/drafts.js';

test('vote starters: six, each with a question, a kind of answer and hints', () => {
  assert.deepEqual(
    TOPIC_TEMPLATES.map((t) => t.label),
    ['Where to eat', 'What to do', 'Next book', 'Team decision', 'Trip destination', 'Yes or no'],
  );
  for (const t of TOPIC_TEMPLATES) {
    assert.match(t.id, /^[a-z]+(-[a-z]+)*$/, t.id);
    assert.ok(isEmoji(t.emoji), t.id);
    assert.ok(t.label && t.card, t.id);
    assert.ok(t.question.length <= LIMITS.title, t.id);
    // A question to fill in, or (yes or no) a hint for one; a hint for each option unless there are none.
    assert.ok(t.question || t.ask, t.id);
    assert.ok(t.yesNo ? !t.hint : t.hint, t.id);
  }
});

test('vote starters: their own names, never a date template’s; their emoji count as plans', () => {
  const ids = TOPIC_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(TOPIC_TEMPLATES.map((t) => t.emoji)).size, ids.length);
  const dates = new Set(TEMPLATES.map(slug));
  for (const id of ids) assert.ok(!dates.has(id), id);
  for (const t of TOPIC_TEMPLATES) {
    assert.notEqual(planOf({ emoji: t.emoji }), 'other', t.id);
    assert.ok(cleanUsage('poll.created', { plan: planOf({ emoji: t.emoji }) }), t.id);
  }
});

test('vote starters: words only, never options, votes, names or dates', () => {
  const allowed = ['id', 'emoji', 'label', 'question', 'ask', 'hint', 'yesNo', 'card'];
  for (const t of TOPIC_TEMPLATES) {
    for (const k of Object.keys(t)) assert.ok(allowed.includes(k), `${t.id}.${k}`);
    for (const s of [t.question, t.hint ?? '']) assert.doesNotMatch(s, /\d/, t.id);
  }
});

test('vote starters: a link or a draft finds one by its name, in any case', () => {
  assert.equal(topicTemplate('where-to-eat').question, 'Where should we eat?');
  assert.equal(topicTemplate('WHERE-TO-EAT').id, 'where-to-eat');
  for (const v of ['nope', '', null, undefined, 'constructor', 'book-club']) assert.equal(topicTemplate(v), null, String(v));
});

test('a vote draft keeps the starter pressed, and nothing that isn’t a name', () => {
  const d = (starter) => cleanFormDraft({ title: 'x', options: ['a'], starter }, '2026-11-03').starter;
  assert.equal(d('next-book'), 'next-book');
  for (const bad of [undefined, 3, '<b>', 'Next Book', '-x', 'a'.repeat(60) + '-']) assert.equal(d(bad), '', String(bad));
});
