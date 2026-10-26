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

If you change how the app looks, regenerate the README images and the home page's phone screens (`public/img/shots/`) with `npm run screenshots` (needs ffmpeg) and include them in your pull request.

CI runs all of these on every pull request, plus a check that the Cloudflare Worker still builds.

## What happens to your pull request

1. CI runs: lint, formatting, tests on Node 22 and 24 with a coverage floor, browser and accessibility tests on desktop and phone, a Worker build, CodeQL and a dependency review. Docs-only changes skip the heavy jobs. If you're a first-time contributor, a maintainer approves the run first. See [docs/CI.md](docs/CI.md) for the details.
2. An automated Claude review may leave comments. It's advisory: fix what's right, and reply where you disagree.
3. A maintainer reviews it. Please resolve each conversation once you've addressed it.
4. When the **CI passed** check is green, it's squash-merged into `main`. Your pull request title becomes the commit message, so make it a clear summary.

## How the code is organised

| Path                                              | What's there                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/core.js`                                  | Shared logic with **no dependencies**: time zones, slots, ranking, calendar import/export. It runs in the browser, the Worker and Node, so keep it free of Node- or DOM-only APIs. |
| `public/app.js`, `create.js`, `event.js`, `ui.js` | The UI, vanilla JS modules with no build step: a router, the create pages, the poll page, and shared helpers                                                                       |
| `public/styles.css`                               | Styles, light and dark themes                                                                                                                                                      |
| `src/security-headers.js`                         | Security headers for every response. `public/_headers` mirrors them for Cloudflare, and a test keeps them in sync.                                                                 |
| `src/ai.js`                                       | AI features. Calls Claude with structured JSON output; tests use a fake client, and the browser tests use `e2e/fake-anthropic.js`.                                                 |
| `src/api.js`                                      | The JSON API, written against web-standard `Request`/`Response`                                                                                                                    |
| `src/store.js`                                    | SQL storage with adapters for Cloudflare D1 and `node:sqlite`                                                                                                                      |
| `src/worker.js`, `server.js`                      | Entry points for Cloudflare and Node                                                                                                                                               |
| `test/`                                           | Unit and API tests (`node:test`)                                                                                                                                                   |
| `e2e/`                                            | Playwright browser tests                                                                                                                                                           |

## Guidelines

- **Keep dependencies out.** The browser code has none and ships without a build step, and that's a feature. The server's only runtime dependency is the Anthropic SDK, for AI. Please discuss any new one in an issue first. Dev tools are fine.
- **Add tests.** Logic changes need a unit test in `test/`. User-facing flows should have an e2e test in `e2e/`.
- **Think about time zones.** Store instants as UTC milliseconds and convert only for display. Test across DST changes.
- **Check it on a phone.** Every screen needs to work at 390px wide without sideways scrolling.
- **Escape user content.** Anything typed by a user goes through `esc()` before it's put into HTML.
- **Keep pull requests focused.** One change per pull request is easier to review and revert.

## Commit messages

Use the imperative mood ("Add CSV export", not "Added CSV export"). The first line should be short; explain the _why_ in the body when it isn't obvious.
