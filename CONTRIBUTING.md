# Contributing to Venn

Thanks for helping! Bug reports, ideas, docs fixes and code are all welcome.

## Ground rules

- Be kind. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- For anything bigger than a small fix, **open an issue first** so we can agree on the approach before you spend time on it.
- Report security problems privately. See [SECURITY.md](SECURITY.md).

## Getting set up

You need **Node 22.13 or newer**.

```sh
git clone https://github.com/<you>/venn.git
cd venn
npm install
npm start            # http://localhost:8787
```

Data is stored in `data/venn.db` (SQLite). Delete it to start fresh.

## Before you open a pull request

```sh
npm run check        # lint + formatting + unit/API tests
npm run test:e2e     # browser tests on desktop and mobile (first run: npx playwright install chromium)
npm run format       # auto-fix formatting
```

CI runs all of these on every pull request, plus a check that the Cloudflare Worker still builds.

## How the code is organised

| Path                         | What's there                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/core.js`             | Shared logic with **no dependencies**: time zones, slots, ranking, calendar import/export. It runs in the browser, the Worker and Node, so keep it free of Node- or DOM-only APIs. |
| `public/app.js`              | The whole UI, vanilla JS, no build step                                                                                                                                            |
| `public/styles.css`          | Styles, light and dark themes                                                                                                                                                      |
| `src/api.js`                 | The JSON API, written against web-standard `Request`/`Response`                                                                                                                    |
| `src/store.js`               | SQL storage with adapters for Cloudflare D1 and `node:sqlite`                                                                                                                      |
| `src/worker.js`, `server.js` | Entry points for Cloudflare and Node                                                                                                                                               |
| `test/`                      | Unit and API tests (`node:test`)                                                                                                                                                   |
| `e2e/`                       | Playwright browser tests                                                                                                                                                           |

## Guidelines

- **No runtime dependencies.** The app ships without a build step and that's a feature. Dev tools are fine.
- **Add tests.** Logic changes need a unit test in `test/`. User-facing flows should have an e2e test in `e2e/`.
- **Think about time zones.** Store instants as UTC milliseconds and convert only for display. Test across DST changes.
- **Check it on a phone.** Every screen needs to work at 390px wide without sideways scrolling.
- **Escape user content.** Anything typed by a user goes through `esc()` before it's put into HTML.
- **Keep pull requests focused.** One change per pull request is easier to review and revert.

## Commit messages

Use the imperative mood ("Add CSV export", not "Added CSV export"). The first line should be short; explain the _why_ in the body when it isn't obvious.
