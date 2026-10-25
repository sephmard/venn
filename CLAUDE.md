# Venn: notes for Claude

Venn is a free polling app for finding a date for dinners, book clubs, trips and other get-togethers: plain HTML/CSS/JS in `public/` (no build step), a JSON API in `src/api.js` shared by a Cloudflare Worker (`src/worker.js`) and a Node server (`server.js`), and SQLite storage. Read `CONTRIBUTING.md` for the layout.

## Rules that matter in review

- **Escape user text.** Anything a person typed goes through `esc()` before it is put into HTML. No `innerHTML` with raw values.
- **No new runtime dependencies** without discussion. The browser code has none; the server has only `@anthropic-ai/sdk` for optional AI.
- **Time zones.** Store instants as UTC milliseconds; convert only for display (`utcToZoned` / `zonedToUtc` in `public/core.js`). Think about DST.
- **Secrets stay secret.** Organizer and edit tokens live in the URL fragment and local storage; the server stores only SHA-256 hashes. Organizer-only endpoints must check `isAdmin`. Calendar tokens never reach the server.
- **Outbound requests.** Webhook URLs must pass `validateWebhookUrl` (public https only). New outbound hosts in the browser need a Content Security Policy update in `src/security-headers.js` (then `npm run headers`).
- **Optional features stay optional.** Email, calendars and AI switch on only when their settings exist, and `/api/config` reports them. The app must work fully without them.
- **Phones first.** Everything must work at 375px wide with no sideways scrolling, 44px tap targets and 16px inputs.
- **Accessibility.** Interactive elements need accessible names and keyboard access; colours must meet WCAG AA contrast in light and dark mode. The axe tests in `e2e/a11y.spec.js` enforce the basics.
- **Tests.** Logic changes need a test in `test/`; user-facing flows need one in `e2e/`. Coverage must stay above the floor in `npm run test:coverage`.

## Commands

```sh
npm run check        # lint, formatting, docs links, unit tests
npm run test:e2e     # browser + accessibility tests (desktop and phone)
npm run test:coverage
npm run site         # build the GitHub Pages site into site/
```
