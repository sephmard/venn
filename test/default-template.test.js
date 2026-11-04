// Which template a new poll's form starts in (sprint D, G2), and what the defaults are called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFormDraft, defaultFor, defaultPill, formDraftHasWork, savedText, startingTemplate } from '../public/drafts.js';

const acme = { id: 'acme1', name: 'Acme' };
const book = { id: 'book1', name: 'Book club' };
const defaults = { date: acme, vote: book };
const draft = (more = {}) => cleanFormDraft({ title: 'Picnic', ...more }, '2030-01-01');

test('a template link wins over everything; ?brand=none means none, this once', () => {
  assert.deepEqual(startingTemplate({ link: 'other1', draft: draft({ brand: 'acme1' }), defaults, format: 'date' }), {
    id: 'other1',
    from: 'link',
  });
  assert.equal(startingTemplate({ link: 'none', defaults, format: 'date' }), null);
  assert.equal(startingTemplate({ link: 'none', draft: draft({ brand: 'acme1' }), defaults, format: 'vote' }), null);
});

test('a draft being picked up keeps what it started in, even none, over the default', () => {
  assert.deepEqual(startingTemplate({ draft: draft({ brand: 'acme1' }), defaults, format: 'vote' }), {
    id: 'acme1',
    from: 'draft',
  });
  // Started with no template (or before defaults existed): still none, though there's a default now.
  assert.equal(startingTemplate({ draft: draft(), defaults, format: 'date' }), null);
  assert.equal(draft().brand, null);
});

test('otherwise the default for this kind of poll, and with none, Venn’s look', () => {
  assert.deepEqual(startingTemplate({ defaults, format: 'date' }), { id: 'acme1', name: 'Acme', from: 'default' });
  assert.deepEqual(startingTemplate({ defaults, format: 'vote' }), { id: 'book1', name: 'Book club', from: 'default' });
  // A default the server found gone comes back as null; signed out there are none at all.
  assert.equal(startingTemplate({ defaults: { date: null, vote: book }, format: 'date' }), null);
  assert.equal(startingTemplate({ defaults: null, format: 'vote' }), null);
});

test('a draft keeps only a template id that could be one', () => {
  assert.equal(draft({ brand: 'acme1' }).brand, 'acme1');
  for (const bad of ['../me', 'a b', '', 7, 'x'.repeat(33), null]) assert.equal(draft({ brand: bad }).brand, null);
  // A template alone isn't work to pick up: the default applies again.
  assert.equal(formDraftHasWork(cleanFormDraft({ title: '', brand: 'acme1' }, '2030-01-01')), false);
});

test('what a template is the default for, as its row and the toasts say it', () => {
  assert.deepEqual(defaultFor(defaults, 'acme1'), ['date']);
  assert.deepEqual(defaultFor({ date: acme, vote: acme }, 'acme1'), ['date', 'vote']);
  assert.deepEqual(defaultFor(null, 'acme1'), []);
  assert.equal(defaultPill({ date: acme, vote: acme }, 'acme1'), 'Default');
  assert.equal(defaultPill(defaults, 'book1'), 'Default for votes');
  assert.equal(defaultPill(defaults, 'acme1'), 'Default for date polls');
  assert.equal(defaultPill(defaults, 'zzz'), '');
  assert.equal(savedText({ date: acme, vote: null }, ['date']), 'New date polls start with Acme.');
  assert.equal(savedText({ date: acme, vote: null }, ['vote']), 'New votes start with no template.');
  assert.equal(savedText({ date: acme, vote: acme }, ['date', 'vote']), 'New date polls and votes start with Acme.');
  assert.equal(savedText({ date: null, vote: null }, ['date', 'vote']), 'New date polls and votes start with no template.');
  assert.equal(savedText(defaults, ['date', 'vote']), 'New date polls start with Acme. New votes start with Book club.');
});

test('a draft still in the default’s template says it is the default', () => {
  assert.deepEqual(startingTemplate({ draft: draft({ brand: 'acme1' }), defaults, format: 'date' }), {
    id: 'acme1',
    name: 'Acme',
    from: 'default',
  });
  // The default changed since: the draft keeps its own, and isn't called the default.
  assert.deepEqual(startingTemplate({ draft: draft({ brand: 'acme1' }), defaults: { date: book }, format: 'date' }), {
    id: 'acme1',
    from: 'draft',
  });
});
