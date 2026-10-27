# Venn developer docs

[Venn](https://venn.day) is a free, open-source poll for finding a date for dinners, book clubs, trips and other get-togethers. Someone suggests a few dates or asks when people are free, shares one link, and Venn finds where everyone overlaps. These docs are for people who run, change or build on it. To use Venn, go to [venn.day](https://venn.day).

## Run it locally

You need [Node.js](https://nodejs.org) 22.13 or newer.

```sh
git clone https://github.com/sephmard/venn.git
cd venn
npm install
npm start     # http://localhost:8787
```

Polls are saved to `data/venn.db` (SQLite). Optional features (email, calendars, AI) switch on when their settings exist; without them, everything else works.

| Command                 | What it does                                       |
| ----------------------- | -------------------------------------------------- |
| `npm start`             | Run the Node server                                |
| `npm run dev:worker`    | Run the Cloudflare Worker locally with Wrangler    |
| `npm run check`         | Lint, formatting, docs links, unit and API tests   |
| `npm run test:e2e`      | Browser and accessibility tests, desktop and phone |
| `npm run test:coverage` | Unit tests with the coverage floor                 |
| `npm run site`          | Build these docs into `site/`                      |

## How it's built

No framework and no build step: plain HTML, CSS and JavaScript in the browser, a small JSON API, and SQLite. The same API code runs on two hosts: a Cloudflare Worker with a D1 database, and a Node server with `node:sqlite`. The only runtime dependency is the Anthropic SDK, used on the server for the optional AI features.

```
public/            the whole front end, served as-is
  index.html       landing page (/); privacy.html and 404.html sit beside it
  app.html         app shell, served for /new and /e/:id
  og.png, og-set.png  link-preview images: asking, and once the date is picked
  app.js           router
  chooser.js       the chooser (/new): which kind of poll
  create.js        the create pages' shared form parts
  create-pick.js   "vote on a few dates", loaded only on that page
  create-free.js   "ask when people are available", loaded only on that page
  event.js         the poll page: answering, the group's results, organizer tools
  organizer.js     the organizer's tools, Notifications and Privacy panels and AI summary, loaded only for organizers
  add-to-calendar.js  "Add to your calendar", loaded once a date is picked
  ai-answer.js     "Answer for me" with AI, loaded when a guest opens it
  day-parts.js     answering hours polls by mornings, afternoons and evenings, and "All day"
  day-answer.js    guests' month calendar for whole-day polls (tap: available, again: if needed), loaded when shown
  when.js          how a poll's times read ("Fri 11:00 PM – Sat 1:00 AM"), only on the poll page
  celebrate.js     the "Poll created!" celebration
  picker.js        the calendar views: week, day and month, for organizers and guests
  block-edit.js    dragging and removing options on the week, loaded only on the create pages
  paint.js         the organizer's painter for hours and parts of the day, loaded only on the create pages
  half-day.js      half-day options (mornings, afternoons, evenings) on "vote on a few dates", loaded when picked
  lengths.js       how long a poll's options are, for editing, duplicating and the AI draft
  edit-poll.js     editing or duplicating a poll on the create pages, loaded only for those links
  ai-draft.js      "describe it, and AI fills in the form", loaded only when AI is switched on
  day-nav.js       the organizer's day strip, « » and jump-to-a-day month, loaded after the create page
  day-window.js    the days that strip offers
  ui.js            shared UI helpers: formatting, avatars, storage, API calls
  core.js          shared logic: time zones, ranking, calendar import
  calendar-export.js  the .ics file and Google Calendar and Outlook links, for a picked date
  calendars.js     Google / Outlook free-busy, in the browser
  styles.css       the app's light and dark themes
  site.css         landing page styles (see DESIGN.md)
src/
  api.js           JSON API on web-standard Request/Response
  store.js         SQL storage for Cloudflare D1 and node:sqlite
  notify.js        email and webhook notifications
  ai.js            AI features (Claude)
  routes.js        which paths the app handles
  preview.js       each poll's link preview (title, date, image), put into the app shell for /e/:id
  worker.js        Cloudflare Worker entry point
server.js          Node server entry point
test/              unit and API tests (node:test)
e2e/               browser tests (Playwright, desktop and mobile)
docs/              these docs, as Markdown
scripts/           screenshots, link-preview images, the docs site build, link checks
```

## How data is protected

- **No accounts, cookies or analytics.** The server stores only what people type into a poll: its title and details, names and answers, plus the organizer's notification settings if they add any.
- **Organizers can keep things private.** They can hide names or everyone's answers from guests, and ask for emails that only they see. The server enforces this: hidden data is never sent to guests.
- **Link previews show only what the link already shows.** A poll's preview in a chat app has its title, the organizer's name and, once picked, the date and how many can make it. Hidden names or answers leave those out, and it never has anyone's name or email.
- **Links are the keys.** The organizer link and each person's edit link carry a secret after the `#`, which browsers never send to the server. The server stores only a SHA-256 hash of each secret, so a database leak doesn't let anyone edit polls.
- **Calendars stay in the browser.** Google and Outlook are asked only for busy/free times, the sign-in token never reaches the server, and calendar files are never uploaded. See [Calendars](CALENDARS.md).
- **Strict headers.** Every response carries a Content Security Policy, no-referrer and no-framing headers, from `src/security-headers.js`.

Found a security issue? Please report it privately: see [Security](../SECURITY.md).

## Where next

- [Self-hosting](SELF-HOSTING.md): deploy to Cloudflare or any Node server, and turn on optional features.
- [API](API.md): every endpoint, with request and response shapes.
- [Notifications](NOTIFICATIONS.md), [Calendars](CALENDARS.md), [AI features](AI.md) and [Usage stats](USAGE-STATS.md): setup for each optional feature.
- [Contributing](../CONTRIBUTING.md): setup, tests and how pull requests are reviewed.
