# Notifications

Organizers can be told whenever someone responds to a poll, changes their answers or removes them. There are three ways:

- **On their phone or computer** (Web Push). Off until the server has a key pair: see [Phone notifications](#phone-notifications).
- **Email**, the default. Off until the server has an email provider: [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/) or [Resend](https://resend.com) are built in, and [others can be added](#adding-an-email-provider).
- **Custom notifications** (webhooks), to Slack, Discord, Zapier, Make or your own endpoint. Always available. The panel shows an example of the JSON and how to check the signature.

Organizers set these up from the **Notifications** button on their poll. Email can also be turned on when creating a poll.

## What the organizer gets

- **When the poll is created,** if they gave an email: "Your poll is ready 🎉", with the link to share. There's no confirmation step.
- **Each time someone answers:** "🎉 Ana just answered…", with the best time so far and a link to everyone's answers. Changes and removals get a plainer email.

## Copies for people who answer

When email is on, the poll page asks people who answer for their email, as an optional field. "Email me a copy of my answer" is ticked by default, so anyone who gives an address gets an email listing their answers, with a link to the poll and their personal link to change their answer. They can untick it, or leave the address out.

- The address is used for that email only. It isn't stored with the poll, shown to anyone, or used again.
- Because anyone could type someone else's address, each answer gets at most 3 copies, and each poll at most 300.
- With the API, send `copyTo` with `POST` or `PUT /api/events/:id/participants`.

## Phone notifications

The organizer taps **Turn on** under _On this device_ in the Notifications panel, and their phone or computer gets a notification each time someone answers: the poll's name, who answered, and how many can make the best time so far. A tap opens the poll. A first notification comes straight away, so it's plain it works.

- **iPhone and iPad:** notifications need Venn on the Home Screen (iOS 16.4 or later). In Safari, tap **Share**, then **Add to Home Screen**, and open Venn from there. A Home Screen app keeps its own storage, apart from Safari's, so it notifies about the Venns made in it. The panel says so on an iPhone in Safari.
- **Android, Mac and Windows:** in Chrome, Edge, Firefox or Safari, straight from the browser.
- **Guests** who have answered get **🔔 Notify me when the date is picked** under their answer, where the browser can show notifications. They're told when the organizer picks the date ("The date is picked. Tap to see it.") and if it changes later. It's tied to their answer: removing the answer, or **Turn off**, stops it. At most 5 devices per guest, 200 per poll.
- Each poll notifies at most 5 devices. Turning it off on one only stops that poll's notifications there.
- The message is encrypted for the device ([RFC 8291](https://www.rfc-editor.org/rfc/rfc8291)), so the push service can't read it, and each request is signed with the server's key ([VAPID](https://www.rfc-editor.org/rfc/rfc8292)). It's done with WebCrypto in [`src/push.js`](../src/push.js): no dependencies. [`public/sw.js`](../public/sw.js), the service worker, only shows notifications. It caches nothing.

To turn it on, make a key pair once and set both:

```sh
npm run vapid               # prints VAPID_PUBLIC_KEY=… and VAPID_PRIVATE_KEY=…
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
```

With the deploy workflow, you can instead add both as repository secrets (Settings → Secrets and variables → Actions) with those names: each deploy puts them on the Worker. With Node, set them as environment variables. `VAPID_SUBJECT` is optional: a `mailto:` address or `https://` URL push services can contact you at (by default `https://venn.day`). Keep the same keys: new ones stop every device that's already subscribed. Once set, `GET /api/config` reports the public key as `"push"`.

## Turning on email

Every provider needs the address emails come from. It must be on a domain the provider has verified, and doesn't need to be a real inbox:

| Setting          | Example                            |
| ---------------- | ---------------------------------- |
| `EMAIL_FROM`     | `Venn <notifications@example.com>` |
| `EMAIL_REPLY_TO` | `Venn <hello@example.com>`         |

`EMAIL_REPLY_TO` is optional: where replies go. Use an address someone reads (on Cloudflare, [Email Routing](https://developers.cloudflare.com/email-routing/) can forward one to your own inbox). Mail apps trust a sender more when people can write back. Set it the same way as `EMAIL_FROM`.

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

Once a provider and `EMAIL_FROM` are set, `GET /api/config` reports `"email": true`. The organizer's email becomes a required field on the create pages, and email becomes the first choice in the Notifications panel. Until then, both say that email isn't switched on, and point to custom notifications.

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

Every email shows Venn's dog (`public/img/venn-dog.png`), loaded from your own instance's address. To use another picture, replace that file, with no see-through holes inside the figure (retro emails are dark, and a hole shows the background), and raise the `?v=` in `mascotUrl` (`src/notify.js`) so mail apps fetch it again.

### If emails land in spam

A new sending domain has no reputation yet, so the first emails can land in spam. To help:

- Mark the email **Not spam** and add the sender to your contacts. Mail apps learn from this.
- Check that the domain passes SPF, DKIM and DMARC: in Gmail, open the email, then **⋮ → Show original**. Each should say `PASS`.
- Keep a DMARC record on the domain, for example `v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com`, to get reports on what's failing.
- Send from a stable address, such as `notifications@`, with a clear name in `EMAIL_FROM`, and set `EMAIL_REPLY_TO` to an inbox someone reads.
- Watch your domain's reputation with Gmail in [Google Postmaster Tools](https://postmaster.google.com/). It shows data once a domain sends enough mail to Gmail each day.

### How email stays safe

- **A cap per poll.** Addresses aren't confirmed, so a poll sends the organizer at most 200 emails. That keeps a poll from being used to flood someone else's inbox.
- **One-click unsubscribe.** Every email has `List-Unsubscribe` and `List-Unsubscribe-Post` headers, which mail apps show as their own unsubscribe button and which Gmail and Yahoo expect. The button stops that person's emails about the poll in one tap. Organizer emails also have a "Stop these emails" link.
- **Few links.** Each email has the one button it's for, the poll's link to copy, and little else. Emails full of links look like marketing to spam filters.
- **Scanner-safe links.** Unsubscribe links open the poll page, which finishes the action. Security scanners that pre-open links in emails can't trigger them by accident.
- **No inbox flooding.** If the same person edits their answers several times within 10 minutes, the organizer gets one email.

## Feature requests and "Contact us"

The home page has an _Ideas and questions_ form: a feature request, or a message that needs a reply. Each one is emailed to the address in `EMAIL_REPLY_TO`, with the sender's email (if they gave one) as Reply-To, so you answer by replying. Nothing is stored.

It switches on with email and `EMAIL_REPLY_TO` both set: `GET /api/config` then reports `"contact": true`. Until then the form stays hidden and the page points to GitHub issues. Each visitor (IP address) can send 3 messages an hour (`CONTACT_RATE_LIMIT`), or on Cloudflare use a [rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) named `CONTACT_RATE_LIMITER`.

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
