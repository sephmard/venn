# Maintaining Venn

Notes for maintainers: how the repository is set up, the settings that live outside the code, and how changes get to production.

## How changes land

1. Every change, including the maintainer's own, goes through a pull request into `main`.
2. CI must pass. Branch protection requires one check, **CI passed**, which only goes green when every CI job has passed. New jobs added to `ci.yml` are covered automatically.
3. Review threads must be resolved.
4. Pull requests are **squash-merged**, so `main` has one commit per change and stays linear.

With a single maintainer, no approving review is required, because GitHub doesn't let you approve your own pull request. When a second maintainer joins, raise **Required approvals** to 1 and turn on **Require review from Code Owners**.

## What runs automatically

| Workflow                     | When                         | What it does                                                                                      |
| ---------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `ci.yml`                     | Every PR and push to `main`  | Lint, formatting, npm signature check, unit/API tests (Node 22 + 24), browser tests, Worker build |
| `ci.yml` → Dependency review | Every PR                     | Blocks new dependencies with known vulnerabilities (moderate and up) or non-permissive licenses   |
| `codeql.yml`                 | Every PR, `main`, and weekly | Static security analysis of the JavaScript and of the workflow files                              |
| `deploy.yml`                 | Push to `main`               | Deploys to Cloudflare, only if `CLOUDFLARE_DEPLOY=true` is set (off by default)                   |
| Dependabot                   | Weekly                       | Grouped update PRs for npm dev tools and GitHub Actions, after a 3-day cooldown                   |

All workflows start with read-only permissions. Pull requests from forks run with no access to secrets. Every third-party action is pinned to a full commit hash; Dependabot keeps the hashes current.

## One-time repository settings

These can't be stored in the code, so set them by hand. They're listed in order.

### 1. Protect `main`

**Settings → Rules → Rulesets → New ruleset → Import a ruleset**, and choose [`.github/rulesets/protect-main.json`](../.github/rulesets/protect-main.json). It:

- requires a pull request, with all review threads resolved, and allows squash merges only
- requires the **CI passed** check, on a branch that's up to date with `main`
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

### 6. Community

- In `CODE_OF_CONDUCT.md`, replace `[INSERT CONTACT METHOD]` with an address for reporting conduct issues.
- Add the repository description, website and topics under **About** on the repository page.

## Hosting a public instance

The app ships with sensible defaults: a strict Content Security Policy, no-referrer, no framing, JSON-only writes, request size limits and hashed secrets. When you run it on your own domain, also:

- **Serve it over HTTPS only**, with HSTS (`Strict-Transport-Security: max-age=31536000; includeSubDomains`). Cloudflare can do this under SSL/TLS → Edge Certificates.
- **Rate-limit the API.** Polls can be created without an account, so limit `POST /api/*` per IP at the edge. For example, use a Cloudflare WAF rate-limiting rule of around 30 requests per minute.
- **Keep the security headers.** If you serve `public/` from somewhere other than the included servers, copy the headers from `public/_headers` (the Content Security Policy in particular).
- **Back up the database.** On D1, use Time Travel. On Node, copy the SQLite file.
- **Turn on email notifications (optional).** Follow [NOTIFICATIONS.md](NOTIFICATIONS.md). Keep `RESEND_API_KEY` in Cloudflare secrets, never in `wrangler.toml`.
- **Add a privacy page.** Say what's stored (titles, names, answers) and how long you keep polls.

## Releases

Each merge to `main` is deployable. To mark a version, create a release from **Releases → Draft a new release**. Use a tag like `v1.2.0` and let GitHub generate the notes from the merged pull requests.
