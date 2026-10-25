# CI and review

Every pull request gets fast, automatic checks, so reviewers can focus on what matters. The goal is high product quality without slowing anyone down: most pull requests are fully checked in about a minute, and docs-only changes in about 30 seconds.

## What runs on a pull request

| Check                                           | Runs when     | Blocks merging        | What it catches                                                                                              |
| ----------------------------------------------- | ------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Lint, format & docs**                         | Always        | Yes                   | ESLint, Prettier, broken links between docs, mistakes in workflow files (actionlint), npm package signatures |
| **Unit & API tests**                            | Code changed  | Yes                   | Logic and API behaviour on Node 22 and 24, with a coverage floor and a page-weight budget                    |
| **Browser tests** (desktop, phone, in parallel) | Code changed  | Yes                   | Real user flows in Chromium, plus accessibility checks (axe, WCAG 2.2 AA) in light and dark mode             |
| **Cloudflare Worker build**                     | Code changed  | Yes                   | The production build still bundles                                                                           |
| **Dependency review**                           | Always on PRs | Yes                   | New dependencies with known vulnerabilities or non-permissive licenses                                       |
| **CodeQL**                                      | Always        | Shown in Security tab | Security issues in the JavaScript and in the workflow files                                                  |
| **Claude review**                               | Non-draft PRs | No (advisory)         | Bugs, security and privacy issues, missing tests. It leaves inline comments.                                 |
| **Labels**                                      | Always        | No                    | Tags the PR by area (app, server, docs, tests, ci, dependencies)                                             |

Branch protection requires one check, **CI passed**. It turns green only when every blocking job above has passed, or was skipped because the change is docs-only.

### Quality gates

- **Coverage floor:** lines 90%, branches 80%, functions 85%, for the server and the shared logic (`npm run test:coverage`). Today it's about 95% / 85% / 90%.
- **Accessibility:** serious or critical axe violations on the create page, a poll (as organizer) and a time-range poll, in light and dark mode, on desktop and phone (`e2e/a11y.spec.js`).
- **Page weight:** at most 45 KB gzipped for everything the browser downloads, and 25 KB per file (`test/budget.test.js`). Today it's about 43 KB.
- **Content Security Policy:** browser tests fail on any CSP violation.

## After merging

- **CI runs again on `main`** as a safety net. Pull requests don't have to be up to date with `main` before merging, which keeps them from waiting on each other. If two changes clash, this run shows it right away.
- **Docs site:** the [docs site](https://docs.venn.day) rebuilds.
- **Scorecard:** OpenSSF Scorecard re-scores the project's security practices (also weekly).
- **Dependabot:** proposes updates weekly. Patch and minor updates **merge themselves** once CI passes. Major updates wait for a person.

## Running the checks yourself

```sh
npm run check          # what the lint job and unit tests run, minus actionlint
npm run test:coverage  # unit tests with the coverage floor
npm run test:e2e       # browser and accessibility tests
npm run site           # build the docs site into site/
```

## Audit notes (October 2026)

What was already in place and kept:

- **One required check.** A single "CI passed" gate, so adding a job never needs a settings change.
- **Hardened workflows.** Actions pinned to commit hashes, read-only token permissions, no persisted credentials, job timeouts.
- **Security checks.** CodeQL, dependency review, and Dependabot with a 3-day cooldown.
- **Protected `main`.** Pull requests required, squash merges only, no force-pushes.

Gaps found and fixed:

| Gap                                                   | Change                                                                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No accessibility testing                              | Added axe checks. They found real problems, now fixed: text contrast in light and dark mode, the availability grid's screen-reader structure, and the people list's markup |
| No coverage floor                                     | Added thresholds just below current coverage                                                                                                                               |
| No page-weight budget                                 | Added a gzip budget test                                                                                                                                                   |
| Docs could silently break                             | Link checks for Markdown, plus a site build that fails on broken links                                                                                                     |
| Workflow files weren't linted                         | Added actionlint, with the download checksum verified                                                                                                                      |
| Docs-only changes ran the full pipeline               | Heavy jobs now skip when only docs change                                                                                                                                  |
| Desktop and phone browser tests ran one after another | They run in parallel, with the browser download cached                                                                                                                     |
| "Up to date with `main`" forced repeated updates      | Relaxed. CI on `main` after each merge is the safety net                                                                                                                   |
| Dependency updates needed manual merging              | Patch and minor updates auto-merge when green                                                                                                                              |
| No automated code review                              | Claude review on every pull request, guided by `CLAUDE.md`                                                                                                                 |
| No public security posture                            | OpenSSF Scorecard and badge                                                                                                                                                |

Deliberately left out, because the cost to velocity outweighs the value at this size:

- **Visual screenshot diffs:** flaky across font and OS updates.
- **Lighthouse CI:** slow; the page-weight budget covers the main risk.
- **Mutation testing.**
- **Merge queues:** these need an organization-owned repository.
