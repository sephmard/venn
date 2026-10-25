# Maintaining Venn

Notes for maintainers: how the repository is set up, the settings that live outside the code, and how changes get to production.

## How changes land

1. Every change, including the maintainer's own, goes through a pull request into `main`.
2. CI must pass. Branch protection requires one check, **CI passed**, which only goes green when every CI job has passed. New jobs added to `ci.yml` are covered automatically.
3. Review threads must be resolved.
4. Pull requests are **squash-merged**, so `main` has one commit per change and stays linear.

With a single maintainer, no approving review is required, because GitHub doesn't let you approve your own pull request. When a second maintainer joins, raise **Required approvals** to 1 and turn on **Require review from Code Owners**.

## What runs automatically

| Workflow                     | When                              | What it does                                                                                                                                                                                                                                              |
| ---------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                     | Every PR and push to `main`       | Lint, formatting, docs links and site build, actionlint, npm signature check, unit/API tests with a coverage floor (Node 22 + 24), browser and accessibility tests (desktop + phone), Worker build. Docs-only PRs skip the heavy jobs. See [CI.md](CI.md) |
| `ci.yml` → Dependency review | Every PR                          | Blocks new dependencies with known vulnerabilities (moderate and up) or non-permissive licenses                                                                                                                                                           |
| `codeql.yml`                 | Every PR, `main`, and weekly      | Static security analysis of the JavaScript and of the workflow files                                                                                                                                                                                      |
| `claude-review.yml`          | Every non-draft PR from this repo | Advisory code review by Claude, guided by `CLAUDE.md`. Needs the `ANTHROPIC_API_KEY` secret                                                                                                                                                               |
| `labeler.yml`                | Every PR                          | Labels the PR by area (app, server, docs, tests, ci, dependencies)                                                                                                                                                                                        |
| `dependabot-auto-merge.yml`  | Dependabot PRs                    | Auto-merges patch and minor updates once CI passes                                                                                                                                                                                                        |
| `pages.yml`                  | Push to `main`                    | Builds and publishes the website and docs to GitHub Pages                                                                                                                                                                                                 |
| `scorecard.yml`              | Push to `main`, and weekly        | OpenSSF Scorecard security score (README badge)                                                                                                                                                                                                           |
| `deploy.yml`                 | Push to `main`                    | Deploys to Cloudflare, only if `CLOUDFLARE_DEPLOY=true` is set (off by default)                                                                                                                                                                           |
| Dependabot                   | Weekly                            | Grouped update PRs for npm dev tools and GitHub Actions, after a 3-day cooldown                                                                                                                                                                           |

All workflows start with read-only permissions. Pull requests from forks run with no access to secrets. Every third-party action is pinned to a full commit hash; Dependabot keeps the hashes current.

## One-time repository settings

These can't be stored in the code, so set them by hand. They're listed in order.

### 1. Protect `main`

**Settings → Rules → Rulesets → New ruleset → Import a ruleset**, and choose [`.github/rulesets/protect-main.json`](../.github/rulesets/protect-main.json). It:

- requires a pull request, with all review threads resolved, and allows squash merges only
- requires the **CI passed** check. Branches don't have to be up to date with `main`; CI runs again on `main` after each merge. If you imported an earlier version of this ruleset, edit it and untick **Require branches to be up to date before merging**
- blocks force-pushes and deleting `main`, and keeps history linear
- lets repository admins bypass only when merging a pull request (for emergencies), never by pushing directly

### 2. General

**Settings → General**:

- Pull Requests: allow **squash merging** only, with the default message set to **Pull request title and description**. Untick merge commits and rebase merging.
- Tick **Always suggest updating pull request branches**, **Allow auto-merge** and **Automatically delete head branches**.
- Features: untick **Wikis**. Docs live in the repo. Optionally tick **Discussions** for questions and ideas.

### 3. Actions

**Settings → Actions → General**:

- **Fork pull request workflows from outside collaborators:** _Require approval for all external contributors_. A maintainer clicks "Approve and run" after a quick look at the diff.
- **Workflow permissions:** _Read repository contents and packages permissions_, and leave **Allow GitHub Actions to create and approve pull requests** unticked.

### 4. Security

**Settings → Advanced Security** (named **Code security** on some accounts):

- Turn on **Private vulnerability reporting**. `SECURITY.md` points reporters to it.
- Turn on **Dependency graph**, **Dependabot alerts** and **Dependabot security updates**.
- Turn on **Secret scanning** and **Push protection**.
- **CodeQL:** leave _Default setup_ off. The repo uses its own `codeql.yml` (advanced setup), and the two can't run together.

### 5. Deploy environment (only if you use `deploy.yml`)

**Settings → Environments → New environment** named `production`:

- **Deployment branches:** _Selected branches_ → `main`.
- Optionally add yourself as a **Required reviewer**, so each deploy waits for one click.
- Put `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` here as **environment secrets**, not repository secrets, so only this job can read them. Use a Cloudflare API token limited to Workers and D1 for this one account.

### 6. GitHub Pages

**Settings → Pages → Build and deployment → Source:** _GitHub Actions_. `pages.yml` then publishes the product page and docs on every push to `main`, at `https://<owner>.github.io/venn/`.

- Optionally, under **Settings → Secrets and variables → Actions → Variables**, add `APP_URL` with the address of your hosted instance. The site's main button then says **Open Venn** and links there.

### 7. Automated review

`claude-review.yml` reviews every non-draft pull request from this repository and leaves inline comments. It's advisory: it never blocks merging.

- Add an Anthropic API key as the repository secret **`ANTHROPIC_API_KEY`** (**Settings → Secrets and variables → Actions**). Without it the job skips with a notice.
- Pull requests from forks are never reviewed automatically, because they can't read secrets.
- The review follows the rules in [`CLAUDE.md`](../CLAUDE.md). Edit that file to change what it looks for.

### 8. Dependabot auto-merge

`dependabot-auto-merge.yml` turns on auto-merge for Dependabot's patch and minor updates, so they merge once **CI passed** is green. This needs **Allow auto-merge** from step 2. Major updates wait for a person.

### 9. Community

- In `CODE_OF_CONDUCT.md`, replace `[INSERT CONTACT METHOD]` with an address for reporting conduct issues.
- Add the repository description, website and topics under **About** on the repository page.

## Hosting a public instance

The app ships with sensible defaults: a strict Content Security Policy, no-referrer, no framing, JSON-only writes, request size limits and hashed secrets. When you run it on your own domain, also:

- **Serve it over HTTPS only**, with HSTS (`Strict-Transport-Security: max-age=31536000; includeSubDomains`). Cloudflare can do this under SSL/TLS → Edge Certificates.
- **Rate-limit the API.** Polls can be created without an account, so limit `POST /api/*` per IP at the edge. For example, use a Cloudflare WAF rate-limiting rule of around 30 requests per minute.
- **Keep the security headers.** If you serve `public/` from somewhere other than the included servers, copy the headers from `public/_headers` (the Content Security Policy in particular).
- **Back up the database.** On D1, use Time Travel. On Node, copy the SQLite file.
- **Turn on email notifications (optional).** Follow [NOTIFICATIONS.md](NOTIFICATIONS.md). Keep `RESEND_API_KEY` in Cloudflare secrets, never in `wrangler.toml`.
- **Turn on calendar connections (optional).** Follow [CALENDARS.md](CALENDARS.md). Google requires app verification and Microsoft recommends publisher verification before public launch, so start early.
- **Turn on AI (optional).** Follow [AI.md](AI.md). Keep `ANTHROPIC_API_KEY` in Cloudflare secrets, set a monthly spend limit on your Anthropic account, and consider the `AI_RATE_LIMITER` binding.
- **Add a privacy page.** Mention that AI features, when used, send the poll text and answers to Anthropic. Say what's stored (titles, names, answers) and how long you keep polls.

## The official site: venn.day

The landing page, privacy page and app are all served by the one Worker. To set it up:

1. **Register the domain.** In the Cloudflare dashboard, go to **Domain Registration → Register Domains** and buy `venn.day`. Registering it with Cloudflare adds it as a zone on the same account automatically. If you buy it elsewhere, add it as a site in Cloudflare and point the registrar's nameservers at the two Cloudflare gives you.
2. **Create the database**: `npx wrangler d1 create venn`.
3. **Create an API token** under **My Profile → API Tokens** with _Account → Workers Scripts: Edit_, _Account → D1: Edit_, _Zone → Workers Routes: Edit_ and _Zone → DNS: Edit_ (zone: `venn.day`).
4. **Set the repository's Actions settings**: variables `CLOUDFLARE_DEPLOY=true`, `D1_DATABASE_ID` and `CUSTOM_DOMAIN=venn.day`; secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
5. **Deploy**: run the **Deploy** workflow, or merge to `main`. Wrangler attaches `venn.day` as a Custom Domain and creates its DNS record and certificate.
6. **Redirect `www`.** Add a proxied DNS record for `www` (for example `AAAA www 100::`) and a **Rules → Redirect Rules** rule from `www.venn.day/*` to `https://venn.day/${1}` (301, keep the query string).
7. **Harden it**: work through [hosting a public instance](#hosting-a-public-instance) below: HSTS, the rate-limiting rule and backups. The privacy page is already at `/privacy`; update it if you add another service that handles data.
8. **Optional extras**: verify `venn.day` in Resend for notification emails (`EMAIL_FROM="Venn <notifications@venn.day>"`), and add `https://venn.day/oauth-callback.html` as a redirect URI for the Google and Microsoft calendar apps.

After changing the landing page's main screenshot, regenerate the social preview with `npm run og`.

## Releases

Each merge to `main` is deployable. To mark a version, create a release from **Releases → Draft a new release**. Use a tag like `v1.2.0` and let GitHub generate the notes from the merged pull requests.
