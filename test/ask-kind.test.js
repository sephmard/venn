// The one Use AI box: which kind of poll a request makes (src/ask-kind.js), as a pure function of
// the request and the days model's answer (shaped by days-draft.js), so no model is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choicesOfWords, fixedTime, pickKind, saidKind } from '../src/ask-kind.js';
import { shapeDays } from '../src/days-draft.js';

const today = '2026-11-04'; // a Wednesday
const day = (date) => ({ date, parts: [], from: '', to: '', ifNeeded: false });
const answer = (decide, { days = [], choices = [], question = '' } = {}) =>
  shapeDays({ title: 'Plan', timeOfDay: 'any', decide, question, choices, days }, { today, text: '' });
const kindOf = (prompt, out) => pickKind(prompt, out);

test('words in the request win over the model', () => {
  assert.deepEqual(kindOf('a vote on our next book', answer('when', { days: [day('2026-11-06')] })), {
    kind: 'vote',
    why: 'words',
  });
  assert.deepEqual(kindOf('find a date for book club: a, b or c?', answer('what', { choices: ['a', 'b', 'c'] })), {
    kind: 'date',
    why: 'words',
  });
  for (const p of [
    'Choose between Rosa’s and Luigi’s',
    'a poll about the theme',
    'which one should we read?',
    'decide where to eat',
  ])
    assert.equal(saidKind(p), 'vote', p);
  for (const p of [
    'When can we all meet?',
    'schedule a call',
    'what day works',
    'which days suit you',
    'our availability',
    'decide what day',
  ])
    assert.equal(saidKind(p), 'date', p);
  // Words the rule doesn't know fall through to the model.
  for (const p of [
    'dinner next week',
    'Italian, Thai or Mexican?',
    'pizza or tacos on Friday?',
    'votar mañana',
    'Let’s decide where and when to have dinner',
  ])
    assert.equal(saidKind(p), null, p);
});

test('what is still open decides, and choices with a time make a vote first', () => {
  assert.deepEqual(kindOf('dinner next week', answer('when', { days: [day('2026-11-10')] })), { kind: 'date', why: 'open' });
  assert.deepEqual(kindOf('Italian, Thai or Mexican?', answer('what', { choices: ['Italian', 'Thai', 'Mexican'] })), {
    kind: 'vote',
    why: 'open',
  });
  // One day set: a vote, with that day for its note.
  const friday = answer('both', { days: [day('2026-11-06')], choices: ['Pizza', 'Tacos'], question: 'Pizza or tacos?' });
  assert.deepEqual(kindOf('pizza or tacos on Friday?', friday), { kind: 'vote', why: 'both' });
  assert.equal(fixedTime(friday.days), 'Friday, Nov 6');
  // Several days: still the vote first, and the days are there for "Make it a date poll instead".
  const two = answer('both', { days: [day('2026-11-06'), day('2026-11-07')], choices: ['Pizza', 'Tacos'] });
  assert.deepEqual(kindOf('pizza or tacos, Friday or Saturday?', two), { kind: 'vote', why: 'both' });
  assert.equal(two.days.length, 2);
  assert.equal(fixedTime(two.days), '');
  // Deciding where and when with nothing named to pick from: the date poll, with its vote link.
  assert.deepEqual(kindOf('dinner somewhere new this week', answer('both', { days: [day('2026-11-06')] })).kind, 'date');
  // Nothing usable.
  assert.equal(kindOf('hmm', answer('when')), null);
});

test('with no AI, a plain choice is split on commas and "or"', () => {
  assert.deepEqual(choicesOfWords('Italian, Thai or Mexican?'), {
    question: 'Italian, Thai or Mexican?',
    options: ['Italian', 'Thai', 'Mexican'],
  });
  assert.deepEqual(choicesOfWords('Dinner: Rosa’s or Luigi’s'), { question: 'Dinner?', options: ['Rosa’s', 'Luigi’s'] });
  assert.deepEqual(choicesOfWords('vote on pizza, tacos, or sushi').options, ['Pizza', 'Tacos', 'Sushi']);
  assert.deepEqual(choicesOfWords('Book swap: yes or no?'), { question: 'Book swap?', options: [], yesNo: true });
  for (const p of [
    'pizza',
    'Italian, Thai',
    'Friday evening or Saturday afternoon',
    'tonight or tomorrow',
    'we could go somewhere nice for dinner or maybe stay in and cook',
    'a or a',
  ])
    assert.equal(choicesOfWords(p), null, p);
});
