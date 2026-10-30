# Self-hosting

Venn runs on Cloudflare Workers with a D1 database, or on any server that runs Node 22.13 or newer. Both use the same code and the same API.

## Cloudflare (free)

Venn runs on [Cloudflare Workers](https://workers.cloudflare.com) with a [D1](https://developers.cloudflare.com/d1/) database. The free plan is plenty for personal and team use.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sephmard/venn)

Or deploy from your machine:

```sh
npx wrangler login
npx wrangler d1 create venn   # paste the database_id it prints into wrangler.toml
npx wrangler deploy
```

Tables are created automatically on the first request.

### Deploy from GitHub Actions

The [deploy workflow](../.github/workflows/deploy.yml) deploys every push to `main`. It's off by default, so forks never try to deploy. To turn it on, set these under **Settings → Secrets and variables → Actions**:

| Name                    | Kind     | Value                                                                       |
| ----------------------- | -------- | --------------------------------------------------------------------------- |
| `CLOUDFLARE_DEPLOY`     | Variable | `true`                                                                      |
| `D1_DATABASE_ID`        | Variable | The ID printed by `npx wrangler d1 create venn`                             |
| `CUSTOM_DOMAIN`         | Variable | Optional, for example `polls.example.com`; it must be a zone on the account |
| `CLOUDFLARE_API_TOKEN`  | Secret   | A token with Workers Scripts, D1, Workers Routes and DNS edit access        |
| `CLOUDFLARE_ACCOUNT_ID` | Secret   | Your 32-character Cloudflare account ID                                     |

The deploy job reads its secrets from the environment named in `deploy.yml`. [Maintaining](MAINTAINING.md) covers the environment and the rest of the repository setup.

## Any server with Node

```sh
PORT=3000 DB_PATH=/var/lib/venn/venn.db node server.js
```

Put it behind a reverse proxy (Caddy, nginx) for HTTPS. The SQLite file is the only state to back up.

## Optional features

Each one switches on when its settings exist, and `GET /api/config` reports which are on. Keep secrets in Cloudflare secrets (`npx wrangler secret put NAME`) or environment variables, never in `wrangler.toml`.

| Feature                   | Settings                                                                             | Guide                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Email notifications       | `EMAIL_FROM`, plus Cloudflare Email Sending (an `EMAIL` binding) or `RESEND_API_KEY` | [Notifications](NOTIFICATIONS.md)                     |
| Webhook notifications     | Always on. Organizers add a URL from their poll.                                     | [Notifications](NOTIFICATIONS.md)                     |
| Phone notifications       | `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (from `npm run vapid`)                    | [Notifications](NOTIFICATIONS.md#phone-notifications) |
| Google Calendar / Outlook | `GOOGLE_CLIENT_ID` and/or `MICROSOFT_CLIENT_ID`                                      | [Calendars](CALENDARS.md)                             |
| AI features (Claude)      | `ANTHROPIC_API_KEY`                                                                  | [AI features](AI.md)                                  |
| Address search in "Where" | `PLACES_PROVIDER=photon`, or `GOOGLE_PLACES_API_KEY`                                 | [Address search](#address-search)                     |
| Usage stats               | `STATS_TOKEN`                                                                        | [Usage stats](USAGE-STATS.md)                         |

### Address search

As an organizer types in a poll's _Where_, Venn can suggest real places and addresses; picking one fills it in. Anything else they type is kept as it is, and links (Zoom, Meet, Teams) are never searched. The browser asks Venn (`GET /api/places`, see the [API](API.md)), and Venn asks the provider, so people's IP addresses never reach it and no Content Security Policy change is needed. Searches are rate limited per visitor and never logged.

| Provider                                                                                                          | Settings                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Photon](https://photon.komoot.io), OpenStreetMap data                                                            | `PLACES_PROVIDER=photon` (not a secret: `[vars]` is fine)                 | Free, no key. The public server is shared, so Venn waits until 3 characters and a pause in typing, caches answers for 10 minutes and says who's asking in its `User-Agent`. Busy instances should [run their own Photon](https://github.com/komoot/photon) and set `PHOTON_URL`. The suggestions show "© OpenStreetMap", which its licence requires.                                                                                                  |
| [Google Places API (New)](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete) | `GOOGLE_PLACES_API_KEY` (a secret), and `PLACES_PROVIDER=google` or unset | Better for businesses by name. Enable _Places API (New)_ in a Google Cloud project with billing, create an API key restricted to that API, then `npx wrangler secret put GOOGLE_PLACES_API_KEY`. Each typing session gets its own session token; Venn uses only the text of each suggestion, so check Google's pricing for Autocomplete requests. Answers aren't cached, as Google's terms require, and the suggestions show Google Maps attribution. |

An explicit `PLACES_PROVIDER` wins: with `photon`, a Google key is ignored. Other settings: `PLACES_RATE_LIMIT` (searches a minute per visitor, default 60), or on Cloudflare a [rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) named `PLACES_RATE_LIMITER`, which counts across all of Cloudflare's servers. With neither provider set, `/api/config` reports `places: false` and _Where_ is a plain text field. If you run a public instance, say in your privacy page that what's typed in _Where_ goes to the provider.

## Running a public instance

Read the [hosting checklist](MAINTAINING.md#hosting-a-public-instance) before you share your instance: HTTPS with HSTS, rate limiting, security headers, backups and a privacy page.
