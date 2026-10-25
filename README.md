<p align="center">
  <img src="docs/logo.svg" width="120" alt="">
</p>

<h1 align="center">Venn</h1>

<p align="center">
  <strong>Get the group together.</strong><br>
  Free polls for dinners, book clubs, game nights and trips. Suggest a few dates or ask when people are free, share one link, and see which day works for everyone.<br>
  No ads. No tracking.
</p>

<p align="center">
  <a href="https://github.com/sephmard/venn/actions/workflows/ci.yml"><img src="https://github.com/sephmard/venn/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0b7a5c.svg" alt="MIT license"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-0b7a5c.svg" alt="PRs welcome"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/sephmard/venn"><img src="https://api.scorecard.dev/projects/github.com/sephmard/venn/badge" alt="OpenSSF Scorecard"></a>
</p>

<p align="center">
  <a href="https://venn.day"><strong>Try it at venn.day</strong></a> ·
  <a href="https://docs.venn.day">Docs</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#self-hosting">Self-hosting</a> ·
  <a href="#privacy">Privacy</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img src="docs/demo.gif" width="880" alt="Creating a dinner poll, answering it, and picking the evening everyone can make">
</p>

## Why Venn

Everyone's availability is a circle. Venn finds where they overlap.

- **Free, with no accounts.** Nobody signs up, not even the organizer. There are no ads and no trackers.
- **Two ways to plan.** Vote on a few dates you suggest, or ask when people are free and let Venn find the overlap, even three days in a row for a trip.
- **Fast to set up.** Pick a kind of plan (dinner, drinks, book club, trip…), tap dates on a calendar, and tap the times. No dropdowns.
- **Easy to answer, especially on a phone.** Big _Yes_ / _If needed_ / _No_ buttons for each option, with who's in shown as faces.
- **Time zones handled.** Everyone sees times in their own time zone automatically.
- **Picks the best time for you.** Options are ranked by how many people can make it, then by how many gave a firm yes.
- **Check your calendar.** Fill in your answers from Google Calendar, Outlook or a calendar file. Only busy/free times are read, in your browser, and nothing is stored on the server.
- **AI when you want it.** Describe a meeting in words and get a ready-to-check poll, let AI fill in your answers from your preferences, or get a summary and a suggested time. Optional; powered by Claude.
- **Know when people answer.** Get an email, or a message in Slack, Discord or any webhook, whenever someone responds.
- **Straight into calendars.** Once the time is picked, everyone gets Google, Outlook and Apple calendar links.
- **Accessible.** Works with a keyboard and screen readers, with WCAG AA contrast in light and dark mode. Checked automatically on every change.
- **Yours to run.** Host it free on Cloudflare, or on any server that runs Node.

## A quick tour

### 1. Suggest some dates

Choose the kind of plan, tap the dates, tap the times, and share the link. Or ask when people are free, and they mark the days (or hours) that work.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/create-dark.png">
  <img src="docs/screenshots/create-light.png" alt="Creating a dinner poll: picking dates on a calendar and choosing 7:00 and 7:30 PM">
</picture>

### 2. Everyone answers, on any device

People enter their name and tap what works. No app, no account.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/mobile-dark.png">
    <img src="docs/screenshots/mobile-light.png" width="320" alt="Answering a poll on a phone with Yes, If needed and No buttons">
  </picture>
</p>

### 3. See the overlap and pick

**Best options** ranks every option and shows who's in. **Everyone's answers** shows who said what. Anyone can check how it's going; the organizer picks one, and everyone can add it to their calendar.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/results-dark.png">
  <img src="docs/screenshots/results-light.png" alt="A dinner poll: answers on the left; the best options and everyone's answers on the right">
</picture>

### Two kinds of poll

|                              | How it works                                                                                                                                 | Good for                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Vote on a few dates**      | You suggest dates, with times, all day, or several days long. People answer each one with _Yes_, _If needed_ or _No_.                        | Dinners, book clubs, parties      |
| **Ask when people are free** | You pick a range of days. People mark the days they're free (Venn can look for several in a row), or paint the hours they're free on a grid. | Trips, or when any day could work |

## Quick start

You need [Node.js](https://nodejs.org) 22.13 or newer.

```sh
git clone https://github.com/sephmard/venn.git
cd venn
npm install   # the browser code has no dependencies; the server uses the Anthropic SDK for optional AI
npm start     # http://localhost:8787
```

Polls are saved to `data/venn.db` (SQLite).

Try it at [venn.day](https://venn.day). The developer docs are on [docs.venn.day](https://docs.venn.day).

## Self-hosting

Host it free on Cloudflare Workers with a D1 database, or on any server that runs Node:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sephmard/venn)

The [self-hosting guide](docs/SELF-HOSTING.md) covers Cloudflare, Node, deploying from GitHub Actions, and turning on email, calendars and AI.

## Privacy

- **No accounts, cookies or analytics.** Venn stores only what people type into a poll: its title and details, names, and answers.
- **Links are the keys.** The organizer link and each person's personal edit link contain a secret after the `#`. Browsers never send that part to the server. The server stores only a SHA-256 hash of each secret, so a database leak doesn't let anyone edit polls.
- **Your calendar stays with you.** _Check my calendar_ runs entirely in the browser. Google and Outlook are asked only for busy/free times, the sign-in token never reaches the server, and calendar files are never uploaded.
- **Delete anytime.** People can remove their own response. The organizer can remove anyone's response, or delete the whole poll.

Found a security issue? Please report it privately. See [SECURITY.md](SECURITY.md).

## How it's built

No framework and no build step: plain HTML, CSS and JavaScript, a small JSON API, and SQLite. The same code runs as a Cloudflare Worker or a Node server. The [developer docs](https://docs.venn.day) explain the [project layout](docs/INTRODUCTION.md#how-its-built) and the [API](docs/API.md).

## Roadmap

Ideas we'd love help with:

- [x] Email or webhook notifications when someone responds
- [x] Check Google and Outlook calendars for busy times
- [x] Optional AI: describe a poll in words, answer for me, summaries and messages
- [ ] Recurring "any week" polls (days of the week rather than dates)
- [ ] Translations
- [ ] Built-in rate limiting for the whole API (today: AI only, plus [your host's rate limiting](docs/MAINTAINING.md#hosting-a-public-instance))

Have another idea? [Open an issue](https://github.com/sephmard/venn/issues/new/choose).

## Contributing

Contributions are welcome, from typo fixes to new features. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, tests and how pull requests are reviewed. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Maintainers: see [docs/MAINTAINING.md](docs/MAINTAINING.md).

Every pull request gets quick automatic checks: lint, unit and browser tests on desktop and phone, accessibility checks, a coverage floor, a page-weight budget, and an advisory review from Claude. Docs-only changes take about 30 seconds. See [docs/CI.md](docs/CI.md).

```sh
npm run check          # lint, formatting, docs links, unit and API tests
npm run test:coverage  # unit tests with the coverage floor
npm run test:e2e       # browser and accessibility tests on desktop and mobile
npm run site           # build the developer docs into site/
```

## License

[MIT](LICENSE)
