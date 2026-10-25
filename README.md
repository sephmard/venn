# Venn

[![CI](https://github.com/sephmard/venn/actions/workflows/ci.yml/badge.svg)](https://github.com/sephmard/venn/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Free scheduling polls for finding a time to meet. Everyone's availability is a circle; Venn finds where they overlap. Propose some times, share one link, and everyone marks what works. Venn shows the best time straight away.

Two kinds of poll:

- **Propose specific times** (default): you suggest exact times, like "Tue 2pm, Wed 10am". Invitees answer each one with _Yes_, _If needed_ or _No_, like a survey.
- **Open time range**: you pick days and an hours window, and people paint when they're free on a grid.

## Why Venn

- **Free, with no accounts and no ads.** Nobody signs up, not even the organizer.
- **Fast to set up.** Pick dates on a calendar, add times with one click, and copy a day's times to every day.
- **Easy to answer.** Big _Yes_ / _If needed_ / _No_ buttons for each time with live tallies, or click-and-drag painting for range polls. Works well on phones.
- **Time zones handled.** Everyone sees times in their own zone, and can switch zones.
- **Picks the best time for you.** Ranks options by how many people can make the _whole_ meeting.
- **Private calendar check.** Check a calendar export (`.ics`) against the proposed times. The file never leaves your browser.
- **Ready for calendars.** Once a time is picked, everyone gets Google, Outlook and Apple calendar links.
- **Yours to host.** Run it free on Cloudflare or on any Node server.

## How it works

1. **Create**: name the poll and pick dates on the calendar.
   - _Specific times_: add the times you want to propose for each date. "Use these times on every day" copies them across.
   - _Open range_: set the daily window, slot size (15/30/60 min) and meeting length.
2. **Share**: send the link. People enter their name and answer each time (or paint the grid). They can also check against a calendar file. They don't need an account.
3. **Decide**: **Best times** ranks options by how many people can make it, then by firm yeses. The **Everyone** table shows who answered what, with the most popular times highlighted.
4. **Finalize**: the organizer picks a time. The poll then shows add-to-calendar buttons for everyone.

Secrets for the organizer and for each participant's edits live in the URL _fragment_, which is never sent to the server, and in the browser's local storage. Only their SHA-256 hashes are stored on the server. Personal "edit links" let people edit their response from another device.

## Run locally

Requires Node 22.13+. No dependencies to install.

```sh
npm install        # dev tools only, the app has no runtime dependencies
npm start          # http://localhost:8787, data saved in ./data/venn.db
npm test           # unit + API tests
npm run test:e2e   # browser tests (desktop + mobile)
```

`server.js` also works for self-hosting on any VPS (`PORT` and `DB_PATH` env vars).

## Deploy free on Cloudflare (Workers + D1)

The free tier is plenty for personal and small-team use.

```sh
npx wrangler login
npx wrangler d1 create venn     # copy the database_id into wrangler.toml
npx wrangler deploy
```

Tables are created automatically on the first request. To try the Worker locally, run `npx wrangler dev`.

**Automatic deploys:** `.github/workflows/deploy.yml` deploys `main` to Cloudflare once you enable it. Set the repo variables `CLOUDFLARE_DEPLOY=true` and `D1_DATABASE_ID`, and the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. It's off by default so forks never try to deploy.

## Project layout

```
public/          static front end, no build step
  index.html
  app.js         UI: create page, availability grid, group heatmap, best times
  core.js        shared logic: time zones, slots, ranking, .ics import/export
  styles.css     light + dark themes
src/
  api.js         JSON API (web-standard Request/Response)
  store.js       SQL storage, adapters for D1 and node:sqlite
  worker.js      Cloudflare Worker entry
server.js        Node server (local / self-hosting)
test/            unit + API tests (node:test)
e2e/             browser tests (Playwright, desktop + mobile)
```

### API

| Method           | Path                                | Notes                                                                                                           |
| ---------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `POST`           | `/api/events`                       | Create a poll → `{ id, adminToken }`. Specific times: `{ mode: "options", options: [{ start, end }] }` (UTC ms) |
| `GET`            | `/api/events/:id`                   | Poll + responses (`x-admin-token` header sets `isAdmin`)                                                        |
| `DELETE`         | `/api/events/:id`                   | Organizer only                                                                                                  |
| `POST`           | `/api/events/:id/participants`      | `{ name, availability }` → `{ id, editToken }`                                                                  |
| `PUT` / `DELETE` | `/api/events/:id/participants/:pid` | `x-edit-token` (delete also allows organizer)                                                                   |
| `POST`           | `/api/events/:id/finalize`          | `{ start }` or `{ start: null }`, organizer only                                                                |
| `GET`            | `/api/events/:id/event.ics`         | Calendar file for the final time                                                                                |

`availability` maps an option or slot start (UTC ms) → `2` (yes) or `1` (if needed). Anything missing means no.

## Ideas for next steps

- Email/webhook notifications when someone responds
- Recurring "general week" polls (days of week, not dates)
- Live Google/Microsoft calendar overlay via OAuth (currently `.ics` file import)
- Rate limiting (e.g. Cloudflare's rate-limit binding) before wide public use

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines, and please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
