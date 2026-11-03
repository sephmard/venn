// The home page's head tags (decision E1 in the sprint, O5): the search description may mention
// votes, but the link preview stays short, as Seph asked in #145.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const content = (attr, name) => {
  const all = [...html.matchAll(new RegExp(`<meta\\s+${attr}="${name}"\\s+content="([^"]*)"`, 'g'))];
  assert.equal(all.length, 1, name);
  return all[0][1];
};

test('home: the description says dates and votes, and stays under 160 characters', () => {
  const description = content('name', 'description');
  assert.equal(description, 'Find a day that works for everyone, or vote on what to do. Free, no sign-up.');
  assert.ok(description.length < 160);
});

test('home: the link preview keeps its short title and description', () => {
  assert.equal(content('property', 'og:title'), 'Venn: find the day that works');
  assert.equal(content('property', 'og:description'), 'Free group polls. No sign-up.');
});
