# Connecting Google Calendar and Outlook

> **Coming soon.** The **Check my calendar** button is shown as "Coming soon" in the app for now. The code below stays in `public/calendars.js`, ready to switch back on.

Invitees can tap **Check my calendar** to fill in their answers from Google Calendar or Outlook / Microsoft 365. Uploading a calendar file (`.ics`) always works, with no setup.

## How it works and what's shared

- Sign-in happens in a popup, directly with Google or Microsoft. The page then asks only for **busy and free time ranges** over the poll's dates. Venn never requests event titles, attendees, locations or descriptions.
- Everything runs **in the person's browser**. The access token is kept in memory for that tab and is never sent to the Venn server. Nothing is stored on the server until the person presses Save, and then only their Yes / If needed / No answers.
- Busy times become **No**, Outlook events marked _tentative_ become **If needed**, and everything else becomes **Yes**. All-day entries are ignored. The person can change any answer before saving.

| Provider  | Permission requested                                                   | Sign-in flow                                    |
| --------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| Google    | `https://www.googleapis.com/auth/calendar.freebusy` (primary calendar) | OAuth 2.0 token flow for browser apps           |
| Microsoft | `Calendars.ReadBasic` (delegated)                                      | Authorization code with PKCE (no client secret) |

Each button only appears when its client ID is configured.

## Google Calendar

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (or pick one).
2. **APIs & Services → Library:** enable the **Google Calendar API**.
3. **Google Auth Platform** (formerly "OAuth consent screen"):
   - **Branding:** app name (for example "Venn"), support email, your home page, privacy policy, and your domain under _Authorized domains_.
   - **Audience:** _External_.
   - **Data access:** add the scope `https://www.googleapis.com/auth/calendar.freebusy`.
4. **Clients → Create client → Web application:**
   - _Authorized JavaScript origins:_ `https://your-domain` (plus `http://localhost:8787` for local development)
   - _Authorized redirect URIs:_ `https://your-domain/oauth-callback.html` (plus `http://localhost:8787/oauth-callback.html`)
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and set it as `GOOGLE_CLIENT_ID`.

**Before going public:** while the app is in _Testing_ mode, only the test users you list can sign in. Calendar scopes are classed as sensitive, so Google asks you to complete **app verification** before anyone can sign in. You'll need a privacy policy and home page on your domain. Plan for this before launch, because review can take a while.

## Outlook / Microsoft 365

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), go to **App registrations → New registration**.
   - **Supported account types:** _Accounts in any organizational directory and personal Microsoft accounts_. This works for work, school, Outlook.com and Hotmail accounts.
   - **Redirect URI:** platform **Single-page application (SPA)**, `https://your-domain/oauth-callback.html`. Add `http://localhost:8787/oauth-callback.html` for local development. It has to be the _SPA_ type, so the browser is allowed to complete the PKCE sign-in.
2. **API permissions → Add a permission → Microsoft Graph → Delegated permissions:** add **Calendars.ReadBasic**.
3. Copy the **Application (client) ID** and set it as `MICROSOFT_CLIENT_ID`.
4. Optional: set `MICROSOFT_TENANT` to `organizations`, `consumers` or a specific tenant ID to limit who can sign in. The default is `common`.

**Before going public:** complete **publisher verification** for the app registration. Some organizations block apps from unverified publishers, or require an admin to approve calendar access. If so, people from those organizations can still use the `.ics` upload.

## Configure the server

The client IDs aren't secrets, since they identify your app to Google and Microsoft. On Cloudflare you can set them as plain variables in `wrangler.toml`:

```toml
[vars]
GOOGLE_CLIENT_ID = "1234-abc.apps.googleusercontent.com"
MICROSOFT_CLIENT_ID = "00000000-0000-0000-0000-000000000000"
```

With Node, set them as environment variables. The buttons appear as soon as `/api/config` reports them.
