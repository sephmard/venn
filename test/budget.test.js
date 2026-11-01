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
const SHELL = ['app.html', 'styles.css', 'retro-app.css', 'app-look.js', 'app.js'];
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
  // Days / Parts of day / Hours, the optional length and the quick fills (Weekdays, your own times).
  // +0.5 each for the shared stylesheet's picked date (its row says Picked, and Change the date) and the
  // organizer's Pick: an open row and its button as one card.
  // +0.25 each for switching lengths keeping the days, and the week's fills that show when they're on.
  // +0.25 for the shared stylesheet's change-the-date list and one-question answer.
  'vote on a few dates page': ['create-pick.js', ['create.css'], 61.25], // +0.25 for the Date · Vote switch on the create forms (shared create.js and styles), +0.5 for topic polls (the router's /new/topic, the form's ?where= and ?after= for Find a date for it, and /new/topic's styles in create.css), +0.5 for a new poll's look: Classic mode in the footer (its code loads once the page is drawn), +0.25 for white label and embedding (/embed routes, the poll alone in a frame),  +0.25 for signing in: My polls' route and the account's place in the top bar (its code and styles load on demand), +0.25 for the template's live preview (the poll page in a frame, its requests answered in the browser), +0.5 for brand templates (?brand=, kept in links; the look itself loads on demand), +0.25 for the deadline's place on the form and a closed poll's styles, +0.25 for the landing pages' link-only templates, +0.25 for a guest's one-tap own poll, +0.25 for calendar day heads, +0.25 for the shared stylesheet's answers by who and the smooth timeline, +0.25 for « » on parts of the day and taps on the hour, +1 for press and hold to draw or move a time on touch, +0.5 for a buzz on iPhones when a drag begins, +0.25 for the retro look switch and its preview, +0.25 for swiping the calendars sideways, +0.5 for calendars that follow the finger when swiped and nudge once to show it, +0.75 for the next week or month sliding in under a swipe, +0.5 for the month calendar opening on this week, +2 for the retro look (retro-app.css and app-look.js) with every app page, so it's there from the first paint, +0.5 for fetching each page's code all at once and the retro sky as a layer of its own, so it opens and scrolls smoothly on phones
  // +0.25 for usage stats, +0.25 for the landing pages' templates, +0.25 for a guest's one-tap own poll
  // (template by emoji) and the day labels that fit.
  'ask when people are available page': ['create-free.js', ['create.css'], 60], // +0.25 for "Describe it instead" above the calendar where AI is on (its code loads on demand), +0.75 for topic polls (the same, and the Deciding what or where? link), +0.5 for a new poll's look: Classic mode in the footer (its code loads once the page is drawn), +0.25 for white label and embedding (/embed routes, the poll alone in a frame),  +0.25 for signing in: My polls' route and the account's place in the top bar (its code and styles load on demand), +0.25 for the template's live preview (the poll page in a frame, its requests answered in the browser), +0.5 for brand templates (?brand=, kept in links; the look itself loads on demand), +0.25 for the deadline's place on the form and a closed poll's styles, +0.5: the above, and days in a row as a switch; +0.25 for days and times mixed in one poll; +0.25 for the shared stylesheet's answers by who and the smooth timeline, +0.25 for « » on parts of the day and taps on the hour, +0.75 for press and hold to draw a time on touch, +0.25 for the parts' times on phones and the drag you can see, +0.25 for the retro look switch, +0.25 for swiping the calendars sideways, +0.25 for picks in the key's colours in every look, +0.25 for calendars that follow the finger when swiped and nudge once to show it, +0.75 for the next week or month sliding in under a swipe, +0.5 for the month calendar opening on this week, +2 for the retro look (retro-app.css and app-look.js) with every app page, so it's there from the first paint, +0.25 for the guests' notify row (shared styles), +0.5 for fetching each page's code all at once and the retro sky as a layer of its own, so it opens and scrolls smoothly on phones
  // +0.5 for big groups: "+N more" people, names behind "See who", ticks on whole best times.
  // +0.5 for the organizer's tools only on their own link, with "Organizer view" on the guest link.
  // +1 for Change the date as a list in the banner, and one question once the date is picked.
  // +0.25 for "Pick this date?" before a date goes out to everyone.
  // +0.5 for calendar days as a weekday over its number, today circled, and past days striped (shared styles).
  // +0.25 for who answered what, a line per answer, when a row in everyone's answers is open.
  // +0.25 for removing an answer from the person tapped, and the smooth timeline (shared styles).
  'poll page': ['event.js', [], 51], // +0.5 for topic polls (they load their own page, topic-poll.js; this is the hand-off, the router and the shared core), +0.25 for the footer's Classic mode switch (shown on a new poll's page only), +0.5 for white label and embedding (no Venn on white-label polls; in a frame, it tells the website what happens, from a module loaded only there),  +0.25 for answers kept with an account (yours on any device, signed in) and Terms in the footer, +0.25 for signing in: the organizer opened from My polls, and the account's place in the top bar (loaded on demand), +0.25 for a branded poll's look and bar (loaded only for those) and the /brand route, +0.5 for when answers close, and a closed poll, +0.25 for fetching its code all at once and the retro sky as its own layer
  // Topic polls: deciding what or where (/new/topic), and their poll page, which is the poll page's
  // code plus its own (topic-poll.js, topic.css), loaded only for topic polls.
  'vote on options page': ['create-topic.js', ['create.css'], 56],
  'topic poll page': [['event.js', 'topic-poll.js'], ['topic.css'], 57.75],
};

for (const [name, [entry, css, PAGE_KB]] of Object.entries(PAGES)) {
  test(`page weight: ${name} stay within budget (gzipped)`, () => {
    const seen = new Set();
    for (const e of [entry].flat()) closure(e, seen);
    const files = [...SHELL, ...css, ...seen];
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

test('app-look.js fetches each page’s modules up front: exactly the ones the page imports', () => {
  const src = read('app-look.js').toString();
  const lists = [...src.matchAll(/\[('[\w.-]+\.js'(?:, '[\w.-]+\.js')*)\]/g)].map((m) =>
    m[1].split(', ').map((s) => s.slice(1, -1)),
  );
  assert.equal(lists.length, 3);
  const [topic, create, poll] = lists;
  assert.deepEqual(new Set(topic), new Set([...closure('create-topic.js'), 'retro-look.js']));
  // The create page's, and the look it applies before drawing (app.js).
  assert.deepEqual(new Set(create), new Set([...closure('create-free.js'), 'retro-look.js']));
  assert.deepEqual(new Set(poll), closure('event.js'));
});
