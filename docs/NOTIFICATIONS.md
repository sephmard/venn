# Notifications

Organizers can be told whenever someone responds to a poll, changes their answers or removes them. There are two ways:

- **Email**, the default. Off until the server has an email provider: [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/) or [Resend](https://resend.com) are built in, and [others can be added](#adding-an-email-provider).
- **Custom notifications** (webhooks), to Slack, Discord, Zapier, Make or your own endpoint. Always available. The panel shows an example of the JSON and how to check the signature.

Organizers set these up from the **Notifications** button on their poll. Email can also be turned on when creating a poll.

## Copies for people who answer

When email is on, the poll page asks people who answer for their email, as an optional field. "Email me a copy of my answer" is ticked by default, so anyone who gives an address gets an email listing their answers, with a link to the poll and their personal link to change their answer. They can untick it, or leave the address out.

- The address is used for that email only. It isn't stored with the poll, shown to anyone, or used again.
- Because anyone could type someone else's address, each answer gets at most 3 copies, and each poll at most 300.
- With the API, send `copyTo` with `POST` or `PUT /api/events/:id/participants`.

## Turning on email

Every provider needs the address emails come from. It must be on a domain the provider has verified, and doesn't need to be a real inbox:

| Setting      | Example                            |
| ------------ | ---------------------------------- |
| `EMAIL_FROM` | `Venn <notifications@example.com>` |

Then set up one provider. If several are set up, the first in this list is used, or the one named by `EMAIL_PROVIDER` (`cloudflare` or `resend`).

### Cloudflare Email Sending (Cloudflare only)

No API key: the Worker sends through a binding.

1. In the Cloudflare dashboard, open **Compute & AI → Email Service → Email Sending → Onboard Domain**, and pick your domain (or run `npx wrangler email sending enable example.com`). This adds the SPF and DKIM records.
2. Add the binding to the Worker. With the deploy workflow, set the repository variable `CLOUDFLARE_EMAIL` to `true`. Deploying by hand, add this to `wrangler.toml`:

   ```toml
   [[send_email]]
   name = "EMAIL"
   ```

3. Set the sender: `npx wrangler secret put EMAIL_FROM`.

### Resend (Cloudflare or Node)

1. Create a Resend account and [verify your domain](https://resend.com/docs/dashboard/domains/introduction). If the domain's DNS is on Cloudflare, Resend can add the records for you.
2. Create an API key with **Sending access**.
3. Set `RESEND_API_KEY` and `EMAIL_FROM`. On Cloudflare:

   ```sh
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put EMAIL_FROM
   ```

   With Node, set them as environment variables.

Once a provider and `EMAIL_FROM` are set, `GET /api/config` reports `"email": true`. The "Email me when people answer" field appears on the create pages, and email becomes the first choice in the Notifications panel. Until then, both say that email isn't switched on, and point to custom notifications.

### Adding an email provider

Providers live in [`src/email.js`](../src/email.js). Each one is a small object:

```js
{
  name: 'postmark',
  configured: (env) => Boolean(env.POSTMARK_TOKEN),
  async send(env, { to, subject, text, html, headers }, { fetchImpl }) {
    // Send one message. Throw if the provider doesn't accept it.
  },
}
```

Add it to `EMAIL_PROVIDERS`, add a test next to the others in `test/email.test.js`, and document its settings here. Outbound requests run on the server, so the browser's Content Security Policy doesn't change.

Every email shows Venn's dog (`public/img/venn-dog.png`), loaded from your own instance's address. To use another picture, replace that file.

### If emails land in spam

A new sending domain has no reputation yet, so the first emails can land in spam. To help:

- Mark the email **Not spam** and add the sender to your contacts. Mail apps learn from this.
- Check that the domain passes SPF, DKIM and DMARC: in Gmail, open the email, then **⋮ → Show original**. Each should say `PASS`.
- Keep a DMARC record on the domain, for example `v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com`, to get reports on what's failing.
- Send from a stable address, such as `notifications@`, with a clear name in `EMAIL_FROM`.

### How email stays safe

- **Double opt-in.** Entering an address only sends a confirmation email. Nothing else is sent until someone opens that link, so a poll can't be used to put someone on a mailing list.
- **Limited retries.** A poll can trigger at most 3 confirmation emails.
- **One-click unsubscribe.** Every notification includes an unsubscribe link, plus a `List-Unsubscribe` header that mail apps show as a button.
- **Scanner-safe links.** Confirm and unsubscribe links open the poll page, which finishes the action. Security scanners that pre-open links in emails can't trigger them by accident.
- **No inbox flooding.** If the same person edits their answers several times within 10 minutes, the organizer gets one email.

## Webhooks

Paste any `https://` URL. Venn sends a `POST` with a JSON body each time someone responds:

```json
{
  "event": "response.created",
  "sentAt": "2026-11-02T15:04:05.000Z",
  "poll": {
    "id": "kz4d48daet",
    "title": "Design review",
    "url": "https://venn.example.com/e/kz4d48daet",
    "responses": 6,
    "finalStart": null
  },
  "response": { "name": "Ana" },
  "bestTime": {
    "start": "2026-11-04T20:00:00.000Z",
    "end": "2026-11-04T21:00:00.000Z",
    "available": 5,
    "ifNeeded": 1,
    "label": "Wed, Nov 4, 3:00 PM – 4:00 PM EST"
  }
}
```

`event` is one of `response.created`, `response.updated`, `response.deleted`, or `test` (from the **Send test** button).

**Slack** (`hooks.slack.com`) and **Discord** (`discord.com/api/webhooks/…`) URLs are recognized and receive a readable message instead, with Venn's dog beside it, such as:

> Ana responded to “Design review”. Best time so far: Wed, Nov 4, 3:00 PM – 4:00 PM EST (6 of 6 can make it). https://venn.example.com/e/kz4d48daet

### Verifying requests

Each request is signed with the poll's signing secret (`whsec_…`, shown in the Notifications panel):

- `X-Venn-Timestamp`: Unix time in seconds
- `X-Venn-Signature`: `sha256=` + hex HMAC-SHA256 of `"<timestamp>.<raw body>"`

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function isFromVenn(rawBody, headers, secret) {
  const timestamp = headers['x-venn-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // reject replays
  const expected = 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const given = headers['x-venn-signature'] || '';
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

### Delivery rules

- Requests time out after 5 seconds and are not retried. The panel shows the result of the last delivery.
- Only public `https://` addresses on the standard port are accepted. The Node server also checks DNS, so a hostname can't point at a private network. Redirects are not followed.
