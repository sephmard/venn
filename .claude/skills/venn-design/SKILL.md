---
name: venn-design
description: How Venn should look, read and behave, and how changes to it are made and shipped. Use before designing, building or reviewing any Venn screen (create page, poll page, results, website), and when the owner states a new preference, add it here.
---

# Venn: design preferences and how we work

These are the owner's standing preferences, learned over many rounds of review. They outrank
defaults and habits. Start with [BRAND.md](../../../BRAND.md) (the brand guidelines and standing
rules); this file holds the screen-by-screen decisions, and [DESIGN.md](../../../DESIGN.md) the tokens. **When the owner states a new preference or reverses one, update this file in
the same PR** (and CLAUDE.md if it's a rule that matters in review).

## The first principles

- **Phones first.** Design for a 375px phone, then check desktop. Desktop is secondary.
- **Create a Venn is the primary action everywhere.** Every page leads to making a poll; nothing
  else competes with it.
- **Accounts are optional.** They add a better experience for people who sign up, never a step in
  front of creating or answering.
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
  back, as ‹ › do. The calendar follows the finger with the next (or last) week or month sliding in
  beside it, like turning a page; let go past a quarter, or flick, to land on it, otherwise it springs
  back. Once a swipe is sideways the page doesn't scroll up or down with it. A press that rests first
  still draws or moves a time.
- Calendars open on **this week**: the month calendar's first page starts at this week's Monday (no
  rows of past days) and runs to the month's end, or on to next month's when under two weeks are left
  ("Oct – Nov 2026", with "Nov 1" marked, quietly). › then goes month by month.
- **Today is teal** (the accent) on every calendar: its number and ring on Days, as on the week's
  heads; picked, it keeps the ring.
- A tap goes round the same way at every level: **available, then if needed, then removed**.
- What's picked is coloured as in the key, at every level and in every look (the retro look too):
  available is green, if needed amber. Never the theme's accent.
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
- **A guest's email is theirs to give, and it invites them.** The answer form has an optional email
  ("only the organizer sees it"); once the date is picked, the organizer's Google and Apple calendar
  buttons invite everyone who gave one. Required only when the organizer asks everyone for one.
- **Guests answer on the list, always.** A poll opens on its list for the people it's sent to, with no
  calendar view; only the organizer can switch to a calendar. **Time selection is the same for every
  poll**: a row per option with Yes / If needed / No. An hours poll's rows are the stretches of time
  the organizer offered; no painting half hours, no parts of the day as well.
- Likewise, **parts of the day show on Hours** as those parts' times, whichever way you get there.
- Templates shape the calendar only while nothing is picked; they never move or remove picks. A second
  tap turns one off.
- **AI is "Use AI"** (Seph, 2026-11-02): a pill beside the section heading on every create form
  (Date, vote on a few dates, Vote), with a sparkle and a gradient edge from the accent to violet.
  Excited but elegant: no fill, no loud animation (the sparkle twinkles twice, none with reduced
  motion). It opens the describe box under the heading; it never takes over the form.
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

**Brand templates (/brand)**

- An organization's own template, **highly customizable**: its name and logo (an Upload / Change
  logo button, three sizes, and the name beside it or not); colours (buttons and links, optionally
  its own page: background, cards, text, and its own answer colours); a font for headings and one
  for text (Venn's own or eight system fonts); corners (square, soft, round) and buttons (pills or
  the corners); and what its polls start with (name, where, note). A share link for the team (`/new?brand=…`) and a private manage link, like
  a poll's organizer link.
- **For organizations needs an account** (Seph, 2026-11-01: only for people with an account),
  where sign-in is set up. **/brand** is For organizations: "Your brand on every poll", one line, one
  button and a still picture of the same poll in three organizations' looks (Northwind, Orbit, Bloom), fanned like cards (Seph, 2026-11-01: a live fake poll was confusing and scrolled oddly); with templates in this
  browser, a list of them. Signed out, the button reads **Sign in to make yours** and /brand/new is a
  sign-in card that comes back to the editor. (If a session ends while editing, Save reads **Sign in
  to save** and the draft survives the sign-in.) Templates that exist keep working by their links and can be added on
  My polls. With no sign-in on the server, anyone can save, as before.
- **Only polls are branded.** The website, /brand and the create page keep Venn's own look (retro
  by default); /brand shows a **live preview** (Seph, 2026-11-01: he wants to see the template change while he makes it): the real poll page with a sample poll in a frame, as a Guest or the Organizer, updated with every edit, clickable, nothing saved; beside the form on desktop, pinned over it on phones, and the create page shows whose template
  it is (logo and name). The menu has "For organizations"; the home page has **no** brand
  section (Seph, 2026-11-01: keep the website simple).
- **The editor is a click-through, not a scroll** (Seph, 2026-11-01: only the top of the preview
  changed, so he couldn't tell what a setting did). Nine steps in the poll page's order: Name and
  logo, Starting look, Colours, Answers, Headings, Text, Corners and buttons, White label, Poll details
  (a saved template opens on Share first). One step shows at a time with Back / Next; the steps are a
  list beside it on desktop and a menu over it on phones, and any step can be opened. While a step is
  open the preview goes to the part of the poll it changes and rings it (dashed magenta), and rings
  it again with every change; Answers opens the group's results. **Starting looks** (Venn,
  Editorial, Midnight, Playful, Tech, Forest, and the logo's own colour once there's a logo) set
  everything in one tap. The logo's colours are offered beside the accent picker. **Compare**, held,
  shows Venn's own look. **Phones** (Seph, 2026-11-01: "very poor on
  mobile"): one screen, nothing slides: Guest / Organizer and Compare in a slim row, the preview
  taking all the room the step leaves, the step's settings on the page (no card, no heading: the bar
  names it) and as tall as they need (scrolling past half the screen), and one bar: **Back · "3/9
  Colours" · Next**, where the step's name opens every step. Starting looks are one row, swiped
  sideways. Signing in to save is the whole screen, with "Back to your template".
- Colours are made readable (WCAG AA) rather than refused. Answers are green, amber and pink unless the template picks its own. On a branded poll the brand's look replaces retro.
- **Always the Venn retro logo** (Seph, 2026-11-01): the header shows the retro logo in every look, classic included; the organization's logo sits beside the poll, never in place of Venn's.
- Its polls show the logo and name above the poll for everyone. Deleted, they're plain Venn again.
- **White label and embedding** (Seph, 2026-11-01: Venn should be white-labelable and embeddable in other apps through the API). The editor's **White label** step (before Poll details): a **Hide Venn's name and logo** switch, off by default (the one exception to "always the Venn retro logo": on, its polls have no Venn top bar, footer, make-your-own links or Finn), and **Your websites that show its polls**, one a line. Only those websites can frame its polls, at `/embed/<poll>`: the poll alone, no Venn bar, a small "Made with Venn" link unless hidden. Details in docs/EMBED.md.

**Accounts (My polls, /me)**

- **Optional, always** (Seph, 2026-11-01): sign in with Google (Microsoft, GitHub when set up) to see and manage your polls on any device. Nothing else needs an account (saving a new brand template is the one exception); every poll and template keeps its links.
- **Creating a Venn comes first, always** (Seph, 2026-11-01); accounts make it better for people who sign in, never get in the way. **Create a Venn** stays the main button in every bar; **Sign in** sits after it as plain text. On the website's phone bar there's no room for more (Seph, 2026-11-01: the person icon felt bulky), so on phones Sign in is first in the menu.
- The app's top bar: **Sign in** (not on poll pages, which are for answering), or the person's **initial** with My polls, Account settings and Sign out. The website: Sign in in the bar when signed out (in the menu on phones); signed in, the menu starts with the name, My polls, Account settings and Sign out.
- **The website's menu is short** (Seph, 2026-11-01): the account (Sign in on phones, or the signed-in name and links), a thin line, then For organizations, For developers and Contact. **Classic mode** is in the footer (Seph, 2026-11-01), not the menu. Privacy, Terms, Docs and GitHub are in the footer only.
- **The sign-in page never jumps** (Seph, 2026-11-01): a browser that isn't signed in gets the sign-in page at once, with the ways in the server offered last time (redrawn only if they changed), never My polls' outline first; Sign in in the bar is drawn at once from what the server said last time too.
- **Sign-in screen** (Seph, 2026-11-01, after Cloudflare's): Finn, "Sign in to Venn", one line on what it's for, the buttons, "No account needed to make or answer a poll.", and under everything **"By continuing, you agree to Venn's Terms and Privacy policy."** (`/terms`, `/privacy`; also under the brand page's sign-in). **Only Google and email** for now; no SSO. A sign-in that fails says so in the page, above the buttons. A tapped button shows it's on its way and can't be tapped twice.
- **My polls** (Seph, 2026-11-01: see polls created and completed, sort, group, search, templates; best on mobile): three tabs, **Created · Answered · Templates**, each with its count. Answered is every poll answered while signed in (or whose edit link this browser remembers); its row says whether they're in on the picked date (You're in / If needed / Can't make it, in the key's colours), and the answer is theirs on any device while signed in. Search, and beside it **one Sort button** (it reads how the list is sorted) that opens a **bottom sheet** in Venn's style: Sort (Newest, Oldest, Date picked, Name) and Group by (Status: Coming up, Waiting on a date, Past; Month; None), applied as they're tapped, then Done (Seph, 2026-11-01: the phone's own pickers looked janky). Shown once a list has two or more. **A few at a time** (Seph: 60+ polls felt overwhelming): five per group, then "Show N more"; Past starts folded; a search shows every match. Rows tell polls apart (many share a name): picked date, answers and where under the name, when it was made in the corner. **⋯ on every poll** opens the same kind of sheet to manage it (Seph): Open, Copy link, Remind the group (the phone's share sheet with a ready nudge; while waiting on a date), Email invitees who haven't answered (when the poll has an invite list and email is on; at most every 12 hours), Email it to people / Invite more by email (while open, email on), Add a deadline / Change the deadline (while open), Remove from My polls, and Delete poll, which asks first in the sheet. The tab, sort and group are remembered. Templates: a row opens it, **New poll** starts one with it, **+ New template** at the end. The account (who, Account settings, Sign out) is a card at the end.
- **No pasting links into My polls** (Seph, 2026-11-01: the "Add a poll from its link" box was confusing). Things join the account on their own: made or answered while signed in, held by this browser when signing in, or opened by their private link (organizer, manage, change-your-answer) while signed in, with a toast "Added to My polls". A guest's plain link never adds anything. Under each list a quiet **Missing a poll? / Missing a template?** opens a sheet saying how it gets here (sign in on the other device, or open its private link on this one); pasting is the last line, and it says plainly what a wrong link is (a guest link, a template's poll link). Template sharing says what people can do: **Copy link to use / Copy link to edit**, roles **Can use / Can edit**.
- **Sign in · Create account** (Seph, 2026-11-01: creating an account must be easy to find): a two-way switch under the line on what it's for; the heading follows it ("Sign in to Venn" / "Create your account"), and `/me#signup` opens on Create account. Continue with Google does both.
- **Email and password** sits between the provider buttons and the hint, after an "or", in the switch's mode; Sign in has Forgot password? under it. Making an account or resetting ends in one "Check your inbox" card; emailed links open a page with one button.
- **Account settings** (/me/settings, from My polls' account card): email, password, connect Google, devices (sign out others, sign out), and Delete account, which needs the password (if any) and a second press; polls stay.

**Website (venn.day)**

- Simple and sexy. Four values, framed as benefits (what people get), not features. No feature
  promo sections on the home page (the brand-template section was taken off for this).
- **Retro is the default, for the website and for new polls.** The site's footer has **Classic mode**
  (a switch, off) for the classic look, remembered in the browser. The home page's address says
  which: `venn.day` for retro, `venn.day/classic` for classic, so a copied link previews the look
  it shows. A new poll is in the look its page is in: retro, or classic for someone who chose Classic
  mode; the organizer can switch it on the poll later. Retro: a synthwave night of stars and scanlines, chrome Orbitron headlines
  with a sunset gradient on the key words, neon cyan and magenta, arcade pixel labels, a striped sun
  on a moving grid, a neon logo (`logo-retro.svg`, **always shown in the top bar, in either look and on branded polls**) and Finn stickers on neon circles
  (`img/stickers/retro/`; Finn stays smooth, never chunky pixels). Off, the usual look (the logo stays neon).
  DESIGN.md has both.
- The **README and the developer docs** (docs.venn.day, `site-src/site.css`) are always retro and
  short: the README opens on the retro link-preview banner and the docs on their quickstart, retro screenshots (`npm run screenshots`), then only what a
  developer needs, longer detail folded away or left to the docs.
- A poll in the **Retro look** (a new poll's look when the site is retro; it keeps it: **no look switch
  on the poll page**, not even for the organizer, Seph 2026-11-02: "The style is defined by the poll creator"): its page in neon
  for everyone, its "Your Venn is ready!", arcade toasts, retro Finn, neon emails, and a retro link preview
  (Venn's retro image, or its own picture's card drawn in neon). Available stays green, if needed amber,
  unavailable pink.
- **No look switch on the create form** (Seph, 2026-11-01: "Is it needed here?"). It sat in About you,
  which is about the organizer, and it repeated the site's own choice. A new poll takes the page's look;
  the create page's footer has **Classic mode** like the website's (hidden for a brand template's poll).
  **No Look row either** (Seph, 2026-11-01: "I don't like having look in the poll"): a template's poll
  starts from the template (New poll in My polls' Templates, or its share link `/new?brand=`). Retro and
  classic are never account-gated: accounts add, never remove. Retro and Classic are always in My polls'
  Templates ("Built in") as starting points: **Duplicate** opens `/brand/new?look=retro|classic`, a new
  template already in that look (Retro: the night colours, neon answers and Orbitron headings), to
  change and then use (Seph: "the point is to duplicate and then edit to make their own").
- **Sharing a template** (Seph, 2026-11-01: "admin rights or user rights"): its owner's Share step has
  **Copy admin invite** and **Copy user invite** (links `/brand/<id>#join=…`; the same link again until
  turned off), who has it with an Admin / User picker and Remove, and "N invite links work · Turn them
  off". **Admins** change the template (no delete, no sharing, a Leave instead); **users** have it in
  their templates, see the template page with "In your templates" and can leave. Opening an
  invite signed out asks to sign in first, then comes back. Templates rows say "Shared with you · Admin/User".
- The hero Venn tells the story in motion, **from noise to a plan**: a group chat's messages bounce
  around, fly to the three friends, the circles drift together and the day that works pops out, then
  they keep floating, unhurried (the messages drift slowly enough to read, but only for about 3 seconds before they fly to their friends, then the circles snap together (0.7 seconds) and the day that works pops out the moment all three overlap: the payoff is fast, the noise is slow (about 24 seconds a loop); once the day has popped, the messages float out of the friends again, faint so the day still reads, and grow loud again as the next round's noise begins) so each step can be followed. It plays while in view. Tap replays it; press and hold a circle (a mouse just
  drags) to pull a friend away, and the ✓ follows the overlap. Still for reduced motion.
- **Email it to people, with an account** (Seph, 2026-11-02: add emails once a poll is made so Venn sends it,
  reminders use them, easy to add many at once): a collapsed **Email it to people** row under About you,
  just above Deadline, signed in and email on only. One box takes a pasted list from anywhere (commas,
  semicolons, spaces, new lines, "Name <email>"); each address becomes a chip with ×, repeats are dropped
  and counted, anything that isn't an email stays in the box flagged "Check this: …" and Create says so.
  Listing anyone turns on asking guests' emails. The Deadline row's reminder choice shows only once
  someone's listed. After the poll: Organizer tools → **Invite by email** (paste more, Send to N people,
  the list with Emailed / Answered / Stopped emails and Remove); the Deadline panel only sets the date and
  how often. The email is from the organizer's name with one button, and its link fills in their email.
- **A deadline, with an account** (Seph, 2026-11-01: deadlines and reminders only for people with an
  account; date polls and votes). Signed in (or on a server without sign-in), both create forms have a
  collapsed **Deadline** row under About you: "Answers close" with quick picks (Tomorrow, In 3 days,
  In a week, at 6 PM) and, when the server sends email, "Remind who hasn't answered" (pasted emails)
  and how often (every day, 2 or 3 days, or only the day before). A deadline alone needs no guest
  emails; listing invitees turns on asking for them (that's how Venn knows who answered). Signed out,
  the form shows nothing; Organizer tools → **Deadline** says "Sign in to close answers on a set day
  and remind who hasn't answered", one quiet line. Guests see "⏳ Answers close …"; after it, their
  answer stays in view, locked. The organizer gets one email at the deadline with the best time (or
  the favourite option), to the email they gave or their account's. The Deadline panel also lists each
  invitee: Answered, Waiting, or Stopped reminders. My polls rows say "Closes Wed, Nov 4" (or
  "Closed") while open, and ⋯ has **Add a deadline** / **Change the deadline**, straight to the panel.
- The same top bar on every page: logo, Create a Venn, (Sign in,) menu. GitHub lives in the footer,
  not the bar or the menu. No floating buttons.
- **Developers** (Seph, 2026-11-01: highlight the GitHub repo and dev docs more, encourage developers
  to use Venn). Menu: **For developers** → docs.venn.day, after For organizations. Every website
  footer opens with a "Build on Venn." row: **Developer docs** and **GitHub** pill buttons. The home
  page's open-source benefit links "read the code" and "build on it"; no developer section on the home
  page. docs.venn.day opens on "Build with Venn": three cards (API, embedding, self-hosting) and a
  three-step quickstart; its bar shows GitHub as a button with the mark. The README has a "Build with
  Venn" section right after "What it does".

**Topic polls (deciding what or where, /new/topic)**

- The owner asked (2026-11) for a second kind of poll: voting on options that aren't times (a
  place, the next book, yes or no), that leads into a date poll. It's still **a Venn**: same Create
  button, same "Create a Venn" heading.
- **No chooser screen.** /new stays the date poll. Under "Create a Venn", both forms have the same
  small **📅 Date · 🗳️ Vote** switch (links, so Back goes between them; a brand template's ?brand=
  stays), in the same place, and nothing else: no intro paragraph, no "Deciding what or where?" or
  "Pick a date instead" links (the owner, 2026-11: "the same between polls, and elegant. Not
  verbose"). The switch is hidden when editing or copying a poll.
- **The question comes first** (the owner, 2026-11: "you can't put in the actual question"): the
  first card, "What are you deciding?", has **Pick from options · Yes or no**, then **Your question**,
  empty (no "Get-together" name), its example fitting the kind ("Where should we eat?" / "Should we
  do a book swap?"). No date-poll templates (Friendsgiving…) and a 🗳️ tile instead of the calendar.
  Yes or no shows its fixed answers as **Yes** / **No** chips ("Everyone answers"), never as boxes,
  and hides the options card. A topic poll can't be created without its question.
- Options are answered with the date polls' **Yes · If needed · No** rows and colours (everyone
  ticks every option they'd go with). **One pick each** is a switch; **Yes or no** is a one-pick
  poll with the options Yes and No.
- The group sees **Favourite so far** (or **Tied**) and every option with a green and amber bar. The
  organizer picks with the same in-page "Go with …?" check; the banner says **Decided**, with **Find
  a date for it**: a date poll named after the pick (its Where too, for "Where…" questions) that
  follows on from the topic poll, so "Bring the group back" invites the same people.
- In **My polls** (the owner asked, 2026-11) a topic poll is a **Vote**: a 🗳️ mark (unless its
  occasion has an emoji), "Vote · …" under its name, and open ones group as **Waiting on a pick**
  (decided ones go to Past, "Decided: …"). Answered rows say **Your pick** / **Not your pick**. When
  a list has both kinds, the sort sheet becomes **Show and sort** with All · Dates · Votes on top
  (remembered); the sort button then names the kind, "Votes", not a truncated sort.
- Not yet: guests suggesting options, ranked choice, AI features.

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
- Look at it: screenshot at 375–390px, light and dark, before saying it's done. **Every UI PR's
  description shows phone (390px) and desktop (1200px) screenshots** of each changed screen.
- Keep the repo clean: screenshots and scratch scripts go outside it; never commit them.
- Report plainly: what changed for users, what was tested, what's still open and needs a decision.
