---
name: venn-design
description: How Venn should look, read and behave, and how changes to it are made and shipped. Use before designing, building or reviewing any Venn screen (create page, poll page, results, website), and when the owner states a new preference, add it here.
---

# Venn: design preferences and how we work

These are the owner's standing preferences, learned over many rounds of review. They outrank
defaults and habits. **When the owner states a new preference or reverses one, update this file in
the same PR** (and CLAUDE.md if it's a rule that matters in review).

## The first principles

- **Phones first.** Design for a 375px phone, then check desktop. Desktop is secondary.
- **The UI explains itself; words don't.** If something needs a sentence to be understood, change the
  UI instead. Cut helper text, hints and labels that restate what the screen already shows. Every
  word must earn its place. ("Webhooks for Slack…", "what your guests will mark" and "long enough"
  were all cut for this.)
- **Elegant and intuitive over clever.** Fewer controls, fewer choices, one obvious way.
- **Think as the user.** Walk the real journey (organizer creating, guest answering, organizer
  picking, changing their mind) on a phone before calling something done.
- **Consistent everywhere.** The same thing looks, reads and behaves the same in every place: across
  Days / Parts of day / Hours, across poll types, across create and results.

## Specific decisions (keep them)

**Time**

- Times are always in the viewer's own device time zone. No time-zone picker or notes. Don't get
  clever. Dates-only polls read as plain dates.

**Creating a poll (/new)**

- One row picks the level: **Days · Parts of day · Hours**. Days in a row (trips) disables the other
  two.
- Parts of day and Hours show **the week only**, on phones too: no Week / Day switch.
- Both use the same navigation: **« ‹ › »** (a month, a week), never before this week.
- A tap goes round the same way at every level: **available, then if needed, then removed**.
- Parts of day and Hours look alike: a plain head, times filling their day's column edge to edge.
- Drag works on both: drag across parts of the day to paint them; on Hours, **press and hold, then
  drag** to draw a time, or hold a time and drag to move it (a quick swipe still scrolls).
- A tap on Hours gives **the hour tapped**, as the labels read (half hours only with a 30-min length).
- A whole day is one **"All day"** at every level, never split into parts or hours with gaps.
- Templates shape the calendar only while nothing is picked; they never move or remove picks. A second
  tap turns one off. A template's length shows where lengths are chosen, never set out of sight.
- **Clear all has Undo** in its place. No pop-up tips over the calendar.
- With nothing picked, every level says the same: **"Pick at least one day to create the poll"**.
- Days in a row: a run that fits shows just its length; only a short one says "too short".
- No empty space at the end of the page; cards end at their last line.

**Answering and results**

- Guests always open on **Your answer**; the organizer (on their link) opens on the group.
- Once a date is picked, a new guest gets one question ("Can you make it?"), not the whole poll.
- Results say each thing once: the best date, then everyone's answers. No "Also good" repeats.
- The key is only **Available · If needed · Unavailable** (green · amber · pink). Unavailable is never
  red, and nothing else goes in the key.
- An open row lists **who answered what**, a labelled line per answer, coloured as in the key.
- Hours results: one smooth track a day on a shared time scale; on phones, no timeline, just each
  day's best stretches. Calm tints, never solid slabs.
- No × on every person's name: the organizer taps a person, then removes their answer.

**Picking and changing the date (organizer)**

- Every Pick asks first, in the page ("Pick this time?" with the date in big type and who can make
  it): picking tells everyone. **Never `confirm()`**: in-app browsers block it.
- **Change** sits right under the picked date; changing lists the next best dates.
- Organizer tools start closed; sharing comes first: **Copy link** is the main button (after creating
  and on the poll), with **Share** (the phone's share sheet) beside it.

**Website (venn.day)**

- Simple and sexy. Four values, framed as benefits (what people get), not features.
- The same top bar on every page: logo, Create a Venn, menu. GitHub lives in the menu and footer, not
  the bar. No floating buttons.

**Never**

- Never put the owner's name in the product, the website or the docs.
- Don't change LICENSE (the owner keeps the copyright). No secrets in the repo.
- Never send real emails to arbitrary addresses in checks.
- venn.day's own share image (og.png) has no Finn; in the app, Finn stays prominent.

## How we make changes

- **One PR at a time** on the designated branch; open it, watch CI, fix what it flags, and once it's
  merged verify the change is live on venn.day (curl the changed file), then reset the branch to main.
- Every change gets tests: logic in `test/`, flows in `e2e/` (desktop and phone projects). Update
  tests that describe old behaviour rather than working around them.
- Run `npm run check` and the browser tests before pushing. Page-weight budgets in
  `test/budget.test.js`: trim first (comments count, as there's no build step); raise only with a note.
- Look at it: screenshot at 375–390px, light and dark, before saying it's done.
- Keep the repo clean: screenshots and scratch scripts go outside it; never commit them.
- Report plainly: what changed for users, what was tested, what's still open and needs a decision.
