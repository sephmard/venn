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
- **Concise copy: the strongest line, once.** Drop a heading that only restates the sentence under
  it; the concrete line ("Free, with no trial, no paid plan and no catch.") is the message. The
  website's "good stuff" list is those lines alone, with no bold titles.
- **Elegant and intuitive over clever.** Fewer controls, fewer choices, one obvious way.
- **Think as the user.** Walk the real journey (organizer creating, guest answering, organizer
  picking, changing their mind) on a phone before calling something done.
- **Consistent everywhere.** The same thing looks, reads and behaves the same in every place: across
  Days / Parts of day / Hours, across poll types, across create and results.

## Specific decisions (keep them)

**Time**

- Times are always in the viewer's own device time zone, everywhere: hours, parts of the day (a
  morning in New York reads as its own times in London) and picked dates. No time-zone picker or
  notes. Don't get clever. Whole days are dates and read as plain dates.

**Creating a poll (/new)**

- One row picks the level: **Days · Parts of day · Hours**. Days in a row (trips) disables the other
  two.
- Parts of day and Hours show **the week only**, on phones too: no Week / Day switch.
- Both use the same navigation: **« ‹ › »** (a month, a week), never before this week.
- **Swipe sideways** on any calendar (Days, Parts of day, Hours; organizers and guests) to go on or
  back, as ‹ › do. Only a quick swipe: a press that rests first still draws or moves a time.
- Calendars open on **today's month and week**, even at the very end of a month.
- A tap goes round the same way at every level: **available, then if needed, then removed**.
- Parts of day and Hours are **one calendar**: the same head, the same slim time column (the part's
  name runs up its row), the same height, so switching between them moves nothing, not even for a
  frame (the calendar on show stays until the next is ready).
- Every part of the day shows its times in its cell ("9a / 12p" on phones), so what's picked is plain
  on the calendar itself. Hours open at 11 AM.
- **Only Hours is dragged**: press and hold, then drag, to draw a time, or hold a time and drag to
  move it (a quick swipe still scrolls; a mouse just drags). Days and parts of the day are tapped.
  Once a drag is on it's plain to see and feel: a light buzz (iPhones too), the calendar ringed, the
  time lifted. On touch: hold a time to move it; drag the grip in its bottom to stretch it (no hold).
  A tap counts where the finger was: beside a time it adds a half hour (next to it, the time grows),
  never changes the time it was near.
- Hours has **no length to choose**: a tap adds the half hour tapped, a drag draws longer, and polls
  look for any overlap. No "Mark many as if needed": a second tap makes something if needed.
- A whole day is one **"All day"** at every level, never split into parts or hours with gaps. On
  Hours it fills every hour the calendar shows, 7 AM to midnight.
- **"Guests choose from" reads the same on every level**: each day (or run of days) with its chips,
  "All day", "Morning 9 AM – 12 PM" or the times, whatever level is showing and however days, parts
  and hours are mixed. No notes beside it.
- **Times drawn in hours stay as drawn on every level.** The list shows them on Days and Parts of day
  too; on Parts of day their part is lit, and tapping it acts on those times. The poll asks about
  them wherever Create is pressed.
- **Guests answer on the list, always.** A poll opens on its list for the people it's sent to, with no
  calendar view; only the organizer can switch to a calendar. **Time selection is the same for every
  poll**: a row per option with Yes / If needed / No. An hours poll's rows are the stretches of time
  the organizer offered; no painting half hours, no parts of the day as well.
- Likewise, **parts of the day show on Hours** as those parts' times, whichever way you get there.
- Templates shape the calendar only while nothing is picked; they never move or remove picks. A second
  tap turns one off.
- **Create Venn sits at the end of the form**, never stuck to the bottom of the screen.
- **Clear all has Undo** in its place. No pop-up tips over the calendar.
- With nothing picked, every level says the same: **"Pick at least one day to create the poll"**.
- Days in a row: a run that fits shows just its length; only a short one says "too short".
- Turning on Days in a row when some days have their own times asks first, in the page, listing
  the times that become all day. "Keep my times" leaves it off.
- No empty space at the end of any page (app and website): the footer follows the content straight
  on; cards end at their last line.

**Answering and results**

- Guests always open on **Your answer**; the organizer (on their link) opens on the group.
- Once a date is picked, a new guest gets one question ("Can you make it?"), not the whole poll.
- Results say each thing once: the best date, then everyone's answers. No "Also good" repeats.
- The key is only **Available · If needed · Unavailable** (green · amber · pink). Unavailable is never
  red, and nothing else goes in the key.
- An open row lists **who answered what**, a labelled line per answer, coloured as in the key.
- A row everyone can make, but some only if needed, is **amber** and says **"Everyone, if needed"**,
  never "2 of 2" or green: "✓ Everyone" and green are only for everyone available.
- Hours results: one smooth track a day on a shared time scale; on phones, no timeline, just each
  day's best stretches. Calm tints, never solid slabs.
- No × on every person's name: the organizer taps a person, then removes their answer.

**Picking and changing the date (organizer)**

- Every Pick asks first, in the page ("Pick this time?" with the date in big type and who can make
  it): picking tells everyone. **Never `confirm()`**: in-app browsers block it.
- **Change** sits right under the picked date; changing lists the next best dates.
- No "It's set" pop-up after a first pick: the picked date is right there. A change or a clear still
  says so.
- Organizer tools start closed, and their closed line always reads **Organizer tools**, the same
  before and after a date is picked (a note like "Check your inbox" goes under it). Sharing comes first: **Copy link** is the main button (after creating
  and on the poll), with **Share** (the phone's share sheet) beside it.

**Website (venn.day)**

- Simple and sexy. Four values, framed as benefits (what people get), not features.
- **Retro is the default, for the website and for new polls.** The site's menu has **Classic mode**
  (a switch, off) for the classic look, remembered in the browser. The home page's address says
  which: `venn.day` for retro, `venn.day/classic` for classic, so a copied link previews the look
  it shows. A new poll's **Retro look** starts on (off for someone who chose Classic mode); the
  organizer can switch it off. Retro: a synthwave night of stars and scanlines, chrome Orbitron headlines
  with a sunset gradient on the key words, neon cyan and magenta, arcade pixel labels, a striped sun
  on a moving grid, a neon logo (`logo-retro.svg`) and Finn stickers on neon circles
  (`img/stickers/retro/`; Finn stays smooth, never chunky pixels). Off, the usual look and logo.
  DESIGN.md has both.
- A poll can have the **Retro look** too (the organizer's switch, off by default; on the create page,
  and on top of the poll): its page in neon
  for everyone, its "Your Venn is ready!", arcade toasts, retro Finn, neon emails, and a retro link preview
  (Venn's retro image, or its own picture's card drawn in neon). Picking it shows it on the create page at
  once; it starts on when the site is retro. Available stays green, if needed amber,
  unavailable pink.
- The hero Venn tells the story in motion, **from noise to a plan**: a group chat's messages bounce
  around, fly to the three friends, the circles drift together and the day that works pops out, then
  they keep floating, unhurried (the messages drift slowly enough to read, but only for about 3 seconds before they fly to their friends, then the circles snap together (0.7 seconds) and the day that works pops out the moment all three overlap: the payoff is fast, the noise is slow (about 24 seconds a loop)) so each step can be followed. It plays while in view. Tap replays it; press and hold a circle (a mouse just
  drags) to pull a friend away, and the ✓ follows the overlap. Still for reduced motion.
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
