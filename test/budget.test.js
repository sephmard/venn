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
  // +0.75 for answering by keyboard (arrow keys in radio groups, ui.js) and a quiet "Answer updated.".
  // +0.25 for answering a long Hours stretch in rows of about two hours (answerBlocks in core.js).
  'vote on a few dates page': ['create-pick.js', ['create.css'], 66.5], // +0.25 for a switch whose next form can't load coming back (shared create.js), +0.25 for the Date · Vote switch saying it's switching (shared create.js and create.css: the form being left goes quiet and takes no typing while the next one loads), +0.25 for a vote Use AI suggests, carried into the Vote form (the draft's note and its tap target), +0.25 for a tidy footer and create bar (the small print under a hairline, Create a Venn full width on phones, 44px link targets that keep lines tight), +0.5 for keeping people's work (a half-made poll and an unsent answer come back after a reload; their code loads after the page), +0.5 for tile styles: Venn's own backgrounds behind a poll's emoji (shared styles), +0.25 for a part of the day under its date in big type, and times that never break (keep() in ui.js), +0.25 for asking "Are you sure?" in the page instead of the browser's confirm() (the dialog's styles; its code loads when asked), +0.25 for compact rows: a day with one part is one row, the row its button (shared styles),  +1 for the website's top bar and menu on every app page (styles and markup; the menu's code loads after the page),  +0.25 for the Deadline row, for signed-in organizers on both kinds of Venn (its code loads only for them), +0.25 for the Date · Vote switch on the create forms (shared create.js and styles), +0.5 for topic polls (the router's /new/topic, the form's ?where= and ?after= for Find a date for it, and /new/topic's styles in create.css), +0.5 for a new poll's look: Classic mode in the footer (its code loads once the page is drawn), +0.25 for white label and embedding (/embed routes, the poll alone in a frame),  +0.25 for signing in: My polls' route and the account's place in the top bar (its code and styles load on demand), +0.25 for the template's live preview (the poll page in a frame, its requests answered in the browser), +0.5 for brand templates (?brand=, kept in links; the look itself loads on demand), +0.25 for the deadline's place on the form and a closed poll's styles, +0.25 for the landing pages' link-only templates, +0.25 for a guest's one-tap own poll, +0.25 for calendar day heads, +0.25 for the shared stylesheet's answers by who and the smooth timeline, +0.25 for « » on parts of the day and taps on the hour, +1 for press and hold to draw or move a time on touch, +0.5 for a buzz on iPhones when a drag begins, +0.25 for the retro look switch and its preview, +0.25 for swiping the calendars sideways, +0.5 for calendars that follow the finger when swiped and nudge once to show it, +0.75 for the next week or month sliding in under a swipe, +0.5 for the month calendar opening on this week, +2 for the retro look (retro-app.css and app-look.js) with every app page, so it's there from the first paint, +0.5 for fetching each page's code all at once and the retro sky as a layer of its own, so it opens and scrolls smoothly on phones
  // +0.25 for usage stats, +0.25 for the landing pages' templates, +0.25 for a guest's one-tap own poll
  // (template by emoji) and the day labels that fit.
  // +0.75 for answering by keyboard (arrow keys in radio groups, ui.js) and a quiet "Answer updated.".
  // +0.25 for answering a long Hours stretch in rows of about two hours (answerBlocks in core.js).
  // +0.25 for times that read right when clocks go back (1:00 – 2:00 AM across the repeated hour, core.js).
  'ask when people are available page': ['create-free.js', ['create.css'], 65.5], // +0.25 for a switch whose next form can't load coming back, with an in-page error by the switch, +0.25 for the Date · Vote switch saying it's switching (the form being left goes quiet and takes no typing while the next one loads), +0.25 for a tidy footer and create bar (the small print under a hairline, Create a Venn full width on phones, 44px link targets that keep lines tight), +0.75 for keeping people's work (a half-made poll and an unsent answer come back after a reload; their code loads after the page), +0.5 for tile styles: Venn's own backgrounds behind a poll's emoji (shared styles), +0.25 for AI filling the whole poll (the emoji and Undo hooks; ai-draft.js itself loads only where AI is on), +0.25 for a part of the day under its date in big type, and times that never break (keep() in ui.js), +0.25 for compact rows: a day with one part is one row, the row its button (shared styles),  +1 for the website's top bar and menu on every app page (styles and markup; the menu's code loads after the page),  +0.25 for "Describe it instead" above the calendar where AI is on (its code loads on demand), +0.25 for the Deadline row, for signed-in organizers on both kinds of Venn (its code loads only for them), +0.75 for topic polls (the same, and the Deciding what or where? link), +0.5 for a new poll's look: Classic mode in the footer (its code loads once the page is drawn), +0.25 for white label and embedding (/embed routes, the poll alone in a frame),  +0.25 for signing in: My polls' route and the account's place in the top bar (its code and styles load on demand), +0.25 for the template's live preview (the poll page in a frame, its requests answered in the browser), +0.5 for brand templates (?brand=, kept in links; the look itself loads on demand), +0.25 for the deadline's place on the form and a closed poll's styles, +0.5: the above, and days in a row as a switch; +0.25 for days and times mixed in one poll; +0.25 for the shared stylesheet's answers by who and the smooth timeline, +0.25 for « » on parts of the day and taps on the hour, +0.75 for press and hold to draw a time on touch, +0.25 for the parts' times on phones and the drag you can see, +0.25 for the retro look switch, +0.25 for swiping the calendars sideways, +0.25 for picks in the key's colours in every look, +0.25 for calendars that follow the finger when swiped and nudge once to show it, +0.75 for the next week or month sliding in under a swipe, +0.5 for the month calendar opening on this week, +2 for the retro look (retro-app.css and app-look.js) with every app page, so it's there from the first paint, +0.25 for the guests' notify row (shared styles), +0.5 for fetching each page's code all at once and the retro sky as a layer of its own, so it opens and scrolls smoothly on phones
  // +0.5 for big groups: "+N more" people, names behind "See who", ticks on whole best times.
  // +0.5 for the organizer's tools only on their own link, with "Organizer view" on the guest link.
  // +1 for Change the date as a list in the banner, and one question once the date is picked.
  // +0.25 for "Pick this date?" before a date goes out to everyone.
  // +0.5 for calendar days as a weekday over its number, today circled, and past days striped (shared styles).
  // +0.25 for who answered what, a line per answer, when a row in everyone's answers is open.
  // +0.25 for removing an answer from the person tapped, and the smooth timeline (shared styles).
  // +0.5 for results that tell the truth: one answer said as one, the best run of days marked, ties said.
  // +0.75 for answering by keyboard (arrow keys in radio groups, ui.js) and a quiet "Answer updated.".
  // +0.25 for answering a long Hours stretch in rows of about two hours (answerBlocks in core.js).
  // +0.25 for the organizer's page before any guest answers: one "Only your answer so far" in place of a ranking (event.js, shared).
  // +0.25 for times that read right when clocks go back (1:00 – 2:00 AM across the repeated hour, core.js).
  'poll page': ['event.js', [], 57.25], // +0.25 for the switch-and-stepper row (Days in a row, Limit spots) in shared styles, so the organizer's RSVP settings reuse it, +0.25 for RSVPs (they load their own page, rsvp-poll.js; this is the hand-off and the deadline line's word), +0.25 for a picked date's answer read as that date alone, +0.25 for the organizer's Copy link outlined, so Create a Venn is the one filled button, and saying Link copied on it, +0.25 for a tidy footer and create bar (the small print under a hairline, Create a Venn full width on phones, 44px link targets that keep lines tight), +0.5 for keeping people's work (a half-made poll and an unsent answer come back after a reload; their code loads after the page), and the organizer's keep-your-link line, +0.5 for tile styles: Venn's own backgrounds behind a poll's emoji (shared styles), +0.25 for a part of the day under its date in big type, and times that never break (keep() in ui.js), +0.25 for asking "Are you sure?" in the page instead of the browser's confirm() (the dialog's styles; its code loads when asked), +0.5 for compact rows: a day with one part is one row, the row its button,  +0.75 for the website's top bar and menu on every app page (styles and markup; the menu's code loads after the page),  +0.25 for the deadline's line in when.js and the straight-to-Deadline link from My polls, +0.5 for topic polls (they load their own page, topic-poll.js; this is the hand-off, the router and the shared core), +0.25 for the footer's Classic mode switch (shown on a new poll's page only), +0.5 for white label and embedding (no Venn on white-label polls; in a frame, it tells the website what happens, from a module loaded only there),  +0.25 for answers kept with an account (yours on any device, signed in) and Terms in the footer, +0.25 for signing in: the organizer opened from My polls, and the account's place in the top bar (loaded on demand), +0.25 for a branded poll's look and bar (loaded only for those) and the /brand route, +0.5 for when answers close, and a closed poll, +0.25 for fetching its code all at once and the retro sky as its own layer
  // Topic polls: deciding what or where (/new/topic), and their poll page, which is the poll page's
  // code plus its own (topic-poll.js, topic.css), loaded only for topic polls.
  'vote on options page': ['create-topic.js', ['create.css'], 56.5], // +0.25 for Use AI on RSVPs (the RSVP bar remembered by the switch, shared create.js), +0.25 for RSVP in the Date · Vote switch, and /new/rsvp's styles in create.css
  // +0.5 for a vote's deadline: when answers close, locked after it, and the organizer's Deadline panel.
  // +0.25 for invitations: the email an invitation's link fills in, and the Invite by email panel's place.
  // +0.5 for the poll page's results that tell the truth (shared event.js and styles).
  // +0.75 for answering by keyboard (arrow keys in radio groups, ui.js) and a quiet "Answer updated.".
  // +0.25 for answering a long Hours stretch in rows of about two hours (answerBlocks in core.js).
  // +0.25 for "Find a date for it" keeping what a starter's vote was about ("Dinner at Luigi’s"; the starters load for the organizer only).
  // +0.25 for a decided vote's one question, "Are you in?", about what was picked (as on a picked date).
  // +0.25 for the organizer's page before any guest answers (shared event.js).
  // +0.25 for times that read right when clocks go back (1:00 – 2:00 AM across the repeated hour, core.js).
  'topic poll page': [['event.js', 'topic-poll.js'], ['topic.css'], 64.75], // +0.25 for RSVPs' hand-off in the shared event.js, +0.25 for an honest leader (Favourite only with the most yeses; Everyone could go), +0.25 for a tidy footer and create bar (the small print under a hairline, Create a Venn full width on phones, 44px link targets that keep lines tight), +0.75 for keeping an unsent answer, as on a date poll, and the organizer's keep-your-link line, +0.5 for tile styles: Venn's own backgrounds behind a poll's emoji (shared styles), +0.25 for Poll not found in the visitor's look (retro unless Classic mode), +0.25 for a part of the day under its date in big type, and times that never break (keep() in ui.js), +0.25 for asking "Are you sure?" in the page instead of the browser's confirm() (the dialog's styles; its code loads when asked), +0.25 for compact rows: a day with one part is one row, the row its button (event.js),  +0.75 for the website's top bar and menu on every app page
  // RSVPs: the date is set, who's coming? (/new/rsvp), and their poll page, which is the poll page's
  // code plus its own (rsvp-poll.js, rsvp.css), loaded only for RSVPs.
  'RSVP page': ['create-rsvp.js', ['create.css'], 56.25], // +0.25 for a few words under the Date · Vote · RSVP switch saying what each is for; // +2 for picking the time on /new's own calendars (rsvp-when.js; the calendars themselves load on demand)
  'RSVP poll page': [['event.js', 'rsvp-poll.js'], ['rsvp.css'], 63.25],
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

test('page weight: a topic poll’s organizer-only code loads only for the organizer', () => {
  const guest = closure('topic-poll.js');
  for (const f of ['topic-organizer.js', 'organizer.js', 'topic-templates.js']) assert.ok(!guest.has(f), f);
  assert.match(read('topic-poll.js').toString(), /ev\.isAdmin \? import\('\.\/topic-organizer\.js'\) : null/);
});

test('page weight: an RSVP’s organizer-only code loads only for the organizer', () => {
  const guest = closure('rsvp-poll.js');
  for (const f of ['rsvp-organizer.js', 'organizer.js']) assert.ok(!guest.has(f), f);
  assert.match(read('rsvp-poll.js').toString(), /ev\.isAdmin \? import\('\.\/rsvp-organizer\.js'\) : null/);
});
