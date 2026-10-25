# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems.

Report them privately through GitHub: go to the repository's **Security** tab and choose
**Report a vulnerability** ([direct link](https://github.com/sephmard/venn/security/advisories/new)).

Include what you found, how to reproduce it, and what impact you think it has. You should hear back
within a week. Once a fix is released, we're happy to credit you in the advisory.

## Supported versions

Only the latest version on `main` gets security fixes.

## Scope

Venn stores poll titles, participant names and availability. Things we especially want to hear about:

- Reading or changing someone else's response, or acting as an organizer without the organizer link
- Cross-site scripting through poll titles, descriptions, names or imported calendar files
- Ways to exhaust storage or crash the server with a single request
