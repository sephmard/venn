# Accounts (optional sign-in)

Venn works fully without an account: polls have their own organizer links, and brand templates their manage links. Signing in is for people who want **My polls** (`/me`): the polls they made, the polls they answered and their brand templates, on any device, to search, sort and group. Polls they made open as the organizer without the link; polls they answered open with their own answer, ready to change.

**Saving a new brand template needs an account** when sign-in is set up: `POST /api/brands` answers 401 without a session, and the brand page asks the person to sign in at Save, keeps their draft through the sign-in and saves it on the way back. Templates that already exist keep working by their share and manage links, and can be added to an account from My polls. With no sign-in set up, anyone can save a template, as before.

**Email and password** switches on by itself when the server sends email ([Notifications](NOTIFICATIONS.md)), since every address is confirmed by an emailed link. Set `EMAIL_SIGNIN=off` to keep it off. See [Email and password](#email-and-password) below.

Each sign-in switches on when its client ID **and** secret are set. With none set, nothing about accounts shows anywhere, and `GET /api/config` returns `accounts: []`.

| Provider  | Settings                                                                          | Callback URL                                      |
| --------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| Google    | `GOOGLE_CLIENT_ID` (a var) and `GOOGLE_CLIENT_SECRET` (a secret)                  | `https://your-domain/api/auth/google/callback`    |
| Microsoft | `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` (optional `MICROSOFT_TENANT`) | `https://your-domain/api/auth/microsoft/callback` |
| GitHub    | `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`                                     | `https://your-domain/api/auth/github/callback`    |

## How it works

- **No library, no third party in between.** The Worker (or `server.js`) runs OAuth 2.0 / OpenID Connect itself: the authorization-code flow with PKCE, a `state` tied to a 10-minute cookie, and, for Google and Microsoft, a `nonce` in the ID token. The ID token comes straight from the provider's token endpoint over TLS, so its issuer, audience, expiry and nonce are checked (OpenID Connect allows TLS in place of the signature check here). GitHub, which isn't OpenID Connect, is asked for the user and their primary verified email.
- **Sessions.** A random token in an `HttpOnly`, `SameSite=Lax` cookie on `/api` (`Secure` on https), for 30 days. The server keeps only its SHA-256 hash, in the `sessions` table.
- **What's stored.** `users`: the provider, the provider's own id for the person, their name and email. Accounts are matched only by that id, never by email, so one person signing in with Google and then GitHub has two accounts. No picture, contacts or calendar.
- **Owning.** `owners` says which account keeps a poll or template (at most one each). Polls and templates made while signed in are kept automatically. Signed in, the organizer, manage and change-your-answer links this browser remembers join the account on their own (`public/keep.js`, each checked against its stored hash): on any page, once each, and again on My polls. So opening a private link from another device while signed in adds it, with no pasting; a guest's plain link never adds anything. My polls' "Missing a poll?" sheet says this, and still takes a pasted link as a last resort. One already kept with another account stays there.
- **Answers.** An answer given while signed in is kept with the account too (`owners` kind `answer`, by participant id); so is one changed with its edit link while signed in, and the edit links this browser remembers are added on My polls. Signed in, `GET /api/events/:id` returns `yourAnswer` (and that answer, even when the organizer hides answers), and the answer can be changed or removed with the session alone. `GET /api/me` lists them as `answered`, with `can` (2 yes, 1 if needed, 0 no) for the picked date. `DELETE /api/me/answers/:pid` takes one off the list; the answer stays on the poll.
- **Deadlines and reminders.** Where the server has sign-in, setting a poll's deadline (and who to remind) needs a session, like saving a new brand template; the create forms show the Deadline row only when signed in. See [Deadline and reminders](API.md#deadline-and-reminders).
- **Managing from My polls.** Each poll's ⋯ sheet uses the organizer's own calls with the session: `DELETE /api/events/:id`, and `POST /api/events/:id/remind`, which emails the invitees who haven't answered (polls with an invite list, email on, at most every 12 hours, counted like scheduled reminders), and a link to **Invite by email** (`#organizer&invite`).
- **The owner is the organizer.** For a poll (or template) kept with your account, organizer-only calls work with the session alone. Viewing it, you get the organizer's view only when you ask for it with `x-organizer: 1` (the app does from My polls, which opens `/e/<id>#organizer`), so the plain link still shows what guests see.
- **Cross-site requests.** Besides `SameSite` and the API taking only JSON, a request that changes something counts as signed out when its `Origin` (or `Sec-Fetch-Site`) is another site.
- **Sharing a template.** A template's owner (its account, or its manage link) makes invite links for **admins** (they change it, but can't delete or share it) or **users** (it's in their templates, to make polls with). Each is a secret in the link's fragment (`/brand/<id>#join=…`), stored as a SHA-256 hash in `brand_invites`, and works for anyone signed in until the owner turns the links off (`DELETE /api/brands/<id>/invites`); who joined is in `brand_members`, and stays. `GET /api/brands/<id>/sharing` lists them; `PUT|DELETE /api/brands/<id>/members/<user>` changes or removes one, and anyone leaves with `DELETE /api/me/brands/<id>`. `/api/me` lists every template with its `role`: owner, admin or user.
- **Leaving.** Sign out ends the session. Delete account (on My polls) removes the account, its sessions and its list; the polls and templates stay, with their links.

## Email and password

For people who'd rather not use Google. Nothing to set up beyond email: Cloudflare Email Sending (needs Workers Paid) or Resend, as in [Notifications](NOTIFICATIONS.md).

- **Signing up** asks for an email and a password, and always answers "check your inbox": the account exists once the emailed link is used. If the address already has an account, the email says so and offers a new password instead, so the page never tells anyone which addresses have accounts.
- **Links** carry a random 256-bit secret after `#` (never sent to the server in the URL, so never in a log); the server keeps its SHA-256 hash. The page a link opens asks for a tap before using it, since mail scanners open links. Sign-up links last 24 hours, password links 1 hour, email-change links 24 hours, and each works once. At most 3 links an hour go to any one address.
- **Passwords** are hashed with PBKDF2-HMAC-SHA256 through Web Crypto, 100,000 iterations (the most Cloudflare Workers allow) and a random salt per password, in a string that names its settings so they can be raised later; older hashes are upgraded at the next sign-in. That's about 20 ms of CPU per sign-in, more than the 10 ms the Workers Free plan allows, so run Venn on Workers Paid.
- **Rules** follow NIST SP 800-63B: at least 10 characters, at most 128, no "must contain a symbol" rules, pasting and password managers welcome. New passwords are checked against [Have I Been Pwned](https://haveibeenpwned.com/Passwords)' leaked passwords: only the first 5 characters of the password's SHA-1 leave the server (with padding on), and if the check can't run the password is allowed. `PWNED_PASSWORDS=off` skips it.
- **Guessing.** A wrong email and a wrong password get the same answer, in about the same time. After 10 wrong passwords in a row an account pauses for 15 minutes (a reset still works). Each IP gets 30 tries per 10 minutes (`AUTH_RATE_LIMIT`), and on Cloudflare also 10 a minute across instances (the `AUTH_RATE_LIMITER` binding in `wrangler.toml`).
- **Account settings** (`/me/settings`): change the email (the new address confirms by link; the old one is told), change the password (the current one first; other devices are signed out), sign out other devices, connect Google, delete the account (with the password).
- **A forgotten password** is reset by link. That signs out every browser, cancels pending email changes, emails a notice, and asks to sign in with the new password.
- **Google and email, together.** Accounts are never joined by matching emails, because that's how accounts get taken over (someone signs up first with your address and waits). Instead: a signed-in person can _connect_ Google in Account settings, after which either signs in to the same account; a Google account can _add a password_, through a link sent to its address; and signing up with an address that has a Google account sends that same "add a password" link.

## Google

1. In the [Google Cloud console](https://console.cloud.google.com/), pick the project used for Venn (or create one).
2. **Google Auth Platform → Branding:** app name "Venn", support email, home page `https://your-domain`, privacy policy `https://your-domain/privacy`, terms of service `https://your-domain/terms`, and your domain under _Authorized domains_. **Audience:** _External_, then **Publish app** (the scopes below are not sensitive, so no verification review is needed).
3. **Data access:** the default `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile` scopes are all sign-in needs.
4. **Clients → Create client → Web application** (or open the one you made for calendars, which works too):
   - _Authorized redirect URIs:_ `https://your-domain/api/auth/google/callback` (plus `http://localhost:8787/api/auth/google/callback` for local development).
5. Give the Worker the client ID and secret, either way:
   - **Deploying with the GitHub workflow** (`.github/workflows/deploy.yml`): add repository secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Settings → Secrets and variables → Actions). Each deploy puts them on the Worker. Don't set them as variables in the Cloudflare dashboard: a deploy replaces dashboard variables with `wrangler.toml`'s.
   - **Deploying by hand:** `npx wrangler secret put GOOGLE_CLIENT_ID` and `npx wrangler secret put GOOGLE_CLIENT_SECRET` (or the ID in `[vars]` in `wrangler.toml`; it's public).
6. Open `https://your-domain/api/config`: `"accounts": ["google"]` means it's on.

## Microsoft

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), **App registrations → New registration** (or open the calendars one). Supported accounts: _any organizational directory and personal Microsoft accounts_.
2. **Authentication → Add a platform → Web**, redirect URI `https://your-domain/api/auth/microsoft/callback`.
3. **Certificates & secrets → New client secret.** Set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` the same way as Google's. Secrets expire (at most 24 months), so note the date.

## GitHub

1. **Settings → Developer settings → OAuth Apps → New OAuth App**, callback URL `https://your-domain/api/auth/github/callback`.
2. Generate a client secret. On the Worker they're `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`; as repository secrets for the deploy workflow, `GH_OAUTH_CLIENT_ID` and `GH_OAUTH_CLIENT_SECRET` (GitHub reserves names starting with `GITHUB_`).

## Why not Cloudflare Access?

[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) puts a login in front of a whole site for a team (it's Zero Trust, priced per seat after 50 users). Venn's polls must stay open to anyone with the link, and sign-in is optional, so Access is the wrong shape. Running OAuth in the Worker costs nothing extra, needs no new dependency, and works the same in `server.js`.
