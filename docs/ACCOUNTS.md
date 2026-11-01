# Accounts (optional sign-in)

Venn works fully without an account: polls and brand templates have their own organizer and manage links. Signing in is for people who want **My polls** (`/me`): every poll and brand template they organize in one list, on any device, opened as the organizer without the link.

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
- **Owning.** `owners` says which account keeps a poll or template (at most one each). Polls and templates made while signed in are kept automatically. On My polls, the organizer links this browser remembers are added (each checked against its stored hash), and a link from elsewhere can be pasted in. One already kept with another account stays there.
- **The owner is the organizer.** For a poll (or template) kept with your account, organizer-only calls work with the session alone. Viewing it, you get the organizer's view only when you ask for it with `x-organizer: 1` (the app does from My polls, which opens `/e/<id>#organizer`), so the plain link still shows what guests see.
- **Cross-site requests.** Besides `SameSite` and the API taking only JSON, a request that changes something counts as signed out when its `Origin` (or `Sec-Fetch-Site`) is another site.
- **Leaving.** Sign out ends the session. Delete account (on My polls) removes the account, its sessions and its list; the polls and templates stay, with their links.

## Google

1. In the [Google Cloud console](https://console.cloud.google.com/), pick the project used for Venn (or create one).
2. **Google Auth Platform → Branding:** app name "Venn", support email, home page `https://your-domain`, privacy policy `https://your-domain/privacy`, and your domain under _Authorized domains_. **Audience:** _External_, then **Publish app** (the scopes below are not sensitive, so no verification review is needed).
3. **Data access:** the default `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile` scopes are all sign-in needs.
4. **Clients → Create client → Web application** (or open the one you made for calendars, which works too):
   - _Authorized redirect URIs:_ `https://your-domain/api/auth/google/callback` (plus `http://localhost:8787/api/auth/google/callback` for local development).
5. Copy the client ID into `[vars]` in `wrangler.toml` as `GOOGLE_CLIENT_ID` (it's public), and set the secret:

   ```sh
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

## Microsoft

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), **App registrations → New registration** (or open the calendars one). Supported accounts: _any organizational directory and personal Microsoft accounts_.
2. **Authentication → Add a platform → Web**, redirect URI `https://your-domain/api/auth/microsoft/callback`.
3. **Certificates & secrets → New client secret.** Set `MICROSOFT_CLIENT_ID` in `[vars]` and `npx wrangler secret put MICROSOFT_CLIENT_SECRET`. Secrets expire (at most 24 months), so note the date.

## GitHub

1. **Settings → Developer settings → OAuth Apps → New OAuth App**, callback URL `https://your-domain/api/auth/github/callback`.
2. Generate a client secret; set `GITHUB_CLIENT_ID` and `npx wrangler secret put GITHUB_CLIENT_SECRET`.

## Why not Cloudflare Access?

[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) puts a login in front of a whole site for a team (it's Zero Trust, priced per seat after 50 users). Venn's polls must stay open to anyone with the link, and sign-in is optional, so Access is the wrong shape. Running OAuth in the Worker costs nothing extra, needs no new dependency, and works the same in `server.js`.
