# Venn: notes for Claude

Venn is a free polling app for finding a date for dinners, book clubs, trips and other get-togethers: plain HTML/CSS/JS in `public/` (no build step), a JSON API in `src/api.js` shared by a Cloudflare Worker (`src/worker.js`) and a Node server (`server.js`), and SQLite storage. Read `CONTRIBUTING.md` for the layout.

## Design preferences

Before designing, building or reviewing anything users see, read [`BRAND.md`](BRAND.md): the brand guidelines and the owner's standing rules (Create a Venn is the primary action everywhere, keep the website simple, phones first, accounts are optional, every UI PR shows phone and desktop screenshots), voice, logo and the two looks. It points to [`DESIGN.md`](DESIGN.md) for tokens and components and to [`.claude/skills/venn-design/SKILL.md`](.claude/skills/venn-design/SKILL.md) for the specific decisions behind today's screens. When the owner states a new preference or reverses one, update the right one of those files in the same PR.

## Rules that matter in review

- **Escape user text.** Anything a person typed goes through `esc()` before it is put into HTML. No `innerHTML` with raw values.
- **No new runtime dependencies** without discussion. The browser code has none; the server has only `@anthropic-ai/sdk` for optional AI.
- **Time zones.** Store instants as UTC milliseconds; convert only for display (`utcToZoned` / `zonedToUtc` in `public/core.js`). Think about DST.
- **Secrets stay secret.** Organizer and edit tokens live in the URL fragment and local storage; the server stores only SHA-256 hashes. Organizer-only endpoints must check `isAdmin`. Calendar tokens never reach the server.
- **Outbound requests.** Webhook URLs must pass `validateWebhookUrl` (public https only). New outbound hosts in the browser need a Content Security Policy update in `src/security-headers.js` (then `npm run headers`).
- **Optional features stay optional.** Email, calendars, AI and sign-in switch on only when their settings exist, and `/api/config` reports them. The app must work fully without them.
- **Accounts gate one thing.** Signing in (`src/auth.js`) adds My polls (polls made, polls answered, templates), and where sign-in is set up, making a _new_ brand template (For organizations, /brand) needs it: signed out, /brand/new asks to sign in first. Nothing else: making and answering polls never needs an account, and every poll and template keeps working by its link. Accounts are matched by the provider's id, never by email; sessions are stored as hashes like tokens. Email and password sign-in (`src/email-auth.js`) confirms every address by link first, never says which emails have accounts, and joins Google to an account only when connected from Account settings while signed in.
- **Phones first.** Everything must work at 375px wide with no sideways scrolling, 44px tap targets and 16px inputs.
- **Create a Venn stays the primary action.** Nothing new (sign-in, promos, templates) competes with it, and the home page stays simple: no feature promo sections.
- **Screenshots in every UI PR.** Phone (390px) and desktop (1200px) screenshots of each changed screen go in the PR description.
- **Accessibility.** Interactive elements need accessible names and keyboard access; colours must meet WCAG AA contrast in light and dark mode. The axe tests in `e2e/a11y.spec.js` enforce the basics.
- **Tests.** Logic changes need a test in `test/`; user-facing flows need one in `e2e/`. Coverage must stay above the floor in `npm run test:coverage`.

## Commands

```sh
npm run check        # lint, formatting, docs links, unit tests
npm run test:e2e     # browser + accessibility tests (desktop and phone)
npm run test:coverage
npm run site         # build the developer docs (docs.venn.day) into site/
```
