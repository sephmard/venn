# Notifications

Organizers can be told whenever someone responds to a poll, changes their answers or removes them. There are two ways:

- **Email**, sent through [Resend](https://resend.com). Off unless the server has an email key.
- **Webhooks**, to Slack, Discord, Zapier, Make or your own endpoint. Always available.

Organizers set these up from the **Notifications** button on their poll. Email can also be turned on when creating a poll.

## Turning on email

1. Create a Resend account and [verify your domain](https://resend.com/docs/dashboard/domains/introduction). Emails will come from an address on it.
2. Create an API key with **Sending access**.
3. Give the server two settings:

   | Setting          | Example                            |
   | ---------------- | ---------------------------------- |
   | `RESEND_API_KEY` | `re_123…` (secret)                 |
   | `EMAIL_FROM`     | `Venn <notifications@example.com>` |

   On Cloudflare:

   ```sh
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put EMAIL_FROM
   ```

   With Node, set them as environment variables.

The "Email me when people respond" field appears automatically once both settings are present.

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

**Slack** (`hooks.slack.com`) and **Discord** (`discord.com/api/webhooks/…`) URLs are recognized and receive a readable message instead, such as:

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
