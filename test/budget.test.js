import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// Venn has to load fast on phones over slow connections. These budgets fail the build if what the
// browser downloads for a page grows a lot; raise them deliberately, in review, if a feature needs it.
const PER_FILE_KB = 25;

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url));
const kb = (f) => gzipSync(read(f)).length / 1024;

/** A module and everything it imports statically (dynamic imports load later, per page). */
function closure(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const [, dep] of read(entry)
    .toString()
    .matchAll(/^import\b[^'"]*['"]\.\/([\w.-]+\.js)['"]/gm))
    closure(dep, seen);
  return seen;
}

// The app shell plus the code each kind of page loads.
const SHELL = ['app.html', 'styles.css', 'app.js'];
// Each page: its code, its own stylesheet, and its budget in KB. Guests open polls on their phones
// from a group chat, so the poll page is the tightest. The create pages carry their own stylesheet
// (create.css), so guests never download it, and each kind of poll loads only its own code.
const PAGES = {
  // +1.25 each for templates (templates.js and the cards); their notes and surprises load on demand.
  // +0.5 each for the poll's own icon button; the picture tools load when it's tapped.
  // +0.5 each for the "tap again: if needed" key and tip, the same on every calendar.
  // +0.25 on the second for the shared stylesheet's organizer-page styles.
  // +0.25 on the first for the Where field's address search hook (the search itself loads on focus).
  // +0.5 each for the calendar's « » a month at a time, and a phone's week that fits seven days.
  // +0.5 each for the calendars' Month / Week and Week / Day switches; +0.75 more on the Venn page for
  // Dates only / Date and time, the optional length and the quick fills (Weekdays, your own times).
  // +0.25 each for switching lengths keeping the days, and the week's fills that show when they're on.
  'vote on a few dates page': ['create-pick.js', ['create.css'], 50.5], // +0.25 for the landing pages' link-only templates, +0.25 for a guest's one-tap own poll
  // +0.25 for usage stats, +0.25 for the landing pages' templates, +0.25 for a guest's one-tap own poll
  // (template by emoji) and the day labels that fit.
  'ask when people are available page': ['create-free.js', ['create.css'], 49.75], // +0.5: the above, and days in a row as a switch
  // +0.5 for big groups: "+N more" people, names behind "See who", ticks on whole best times.
  // +0.5 for the organizer's tools only on their own link, with "Organizer view" on the guest link.
  'poll page': ['event.js', [], 46],
};

for (const [name, [entry, css, PAGE_KB]] of Object.entries(PAGES)) {
  test(`page weight: ${name} stay within budget (gzipped)`, () => {
    const files = [...SHELL, ...css, ...closure(entry)];
    let total = 0;
    for (const f of files) {
      total += kb(f);
      assert.ok(kb(f) <= PER_FILE_KB, `public/${f} is ${kb(f).toFixed(1)} KB gzipped (budget ${PER_FILE_KB} KB)`);
    }
    assert.ok(
      total <= PAGE_KB,
      `the ${name} download ${total.toFixed(1)} KB gzipped (budget ${PAGE_KB} KB): ${files.join(', ')}`,
    );
  });
}

test('page weight: the router loads pages on demand, not up front', () => {
  assert.doesNotMatch(read('app.js').toString(), /^import\b/m);
});
