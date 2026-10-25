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

| Feature                   | Settings                                                                             | Guide                             |
| ------------------------- | ------------------------------------------------------------------------------------ | --------------------------------- |
| Email notifications       | `EMAIL_FROM`, plus Cloudflare Email Sending (an `EMAIL` binding) or `RESEND_API_KEY` | [Notifications](NOTIFICATIONS.md) |
| Webhook notifications     | Always on. Organizers add a URL from their poll.                                     | [Notifications](NOTIFICATIONS.md) |
| Google Calendar / Outlook | `GOOGLE_CLIENT_ID` and/or `MICROSOFT_CLIENT_ID`                                      | [Calendars](CALENDARS.md)         |
| AI features (Claude)      | `ANTHROPIC_API_KEY`                                                                  | [AI features](AI.md)              |

## Running a public instance

Read the [hosting checklist](MAINTAINING.md#hosting-a-public-instance) before you share your instance: HTTPS with HSTS, rate limiting, security headers, backups and a privacy page.
