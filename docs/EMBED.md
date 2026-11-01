# White label and embedding

Venn polls can live inside another app or website, in that organization's look and with no sign of Venn. It takes a [brand template](API.md#brand-templates), the API, and a frame.

## 1. Make a template

Make one at `/brand` (or `POST /api/brands`). On its **White label** step:

- **Hide Venn's name and logo** (`hideVenn: true`): its polls show only the organization's logo and name. No Venn top bar, footer, "make your own" links or Finn, and link previews carry the organization's name instead of Venn's.
- **Your websites that show its polls** (`embedSites`): up to 10 addresses, like `https://example.com`. Only pages on these websites can show its polls in a frame. Plain `http` is allowed only for `localhost`, to try it out.

Keep the template's manage link (or its `adminToken`): it's what changes the template later, with `PUT /api/brands/:id` and `x-admin-token`.

### Make templates from your server

An app that gives each of its own users a template (each club, team or shop in its own look) can make them with the API instead: `POST /api/brands` with the same fields, from its server. Where the Venn it uses has sign-in set up, as venn.day does, that needs a key from whoever runs it, sent as `authorization: Bearer <key>`. A Venn's keys are its `APP_KEYS` setting ([Self-hosting](SELF-HOSTING.md#optional-features)); keep yours on your server, like a poll's `adminToken`. A template made this way belongs to no account and is managed with its `adminToken`, like any other.

## 2. Make polls with the API

From your server, make each poll with the template's `brand` id:

```sh
curl -X POST https://venn.day/api/events \
  -H 'content-type: application/json' \
  -d '{"title":"Team lunch","organizer":"Sam","timezone":"Europe/London","dates":["2026-11-02","2026-11-03"],"startMinute":0,"endMinute":1440,"slotMinutes":1440,"durationMinutes":1440,"brand":"<template id>"}'
```

It answers `{ id, adminToken }`. Keep `adminToken` secret, on your server: it's the organizer's key (picking the date, changing or deleting the poll). The [API](API.md) has every field and call.

## 3. Show the poll

```html
<iframe
  src="https://venn.day/embed/<poll id>"
  title="Team lunch"
  allow="clipboard-write; web-share"
  style="width: 100%; height: 640px; border: 0"
></iframe>
<script src="https://venn.day/embed.js" async></script>
```

`/embed/<poll id>` is the poll page alone: no Venn top bar or footer, links to other pages open in a new tab, and (unless the template hides Venn) one small "Made with Venn" link at the end. For the organizer's view, give the organizer `/embed/<poll id>#admin=<adminToken>`; show it only to them.

### Fit it into your page

Add these to the end of the frame's address, after `#`, joined with `&`. They're read in the browser and never sent to a server.

| Option         | What it does                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `name=Ada%20L` | Fills in the name of the person answering, when your website already knows it. They can still change it. URL-encode it.       |
| `head=off`     | Leaves out the template's logo bar and the poll's heading (its emoji, name, host and details), for a page that shows its own. |
| `share=off`    | Leaves out "Copy the link" under the poll, for a website that invites people itself.                                          |

For example `/embed/<poll id>#name=Ada%20Lovelace&head=off&share=off`, or `#admin=<adminToken>&head=off` for the organizer.

If your website has a dark mode, give the template one too (`darkBg`, `darkSurface`, `darkText`, `darkAccent` in the [API](API.md#brand-templates), or **Its own dark mode** on the Colours step), so the frame follows the device's setting as your page does.

`embed.js` is optional. With it, each Venn frame on the page grows to fit its poll, and fires a `venn` event when something happens:

```js
document.addEventListener('venn', (e) => {
  const { type, poll } = e.detail; // type: 'ready', 'height', 'answered' (with `updated`) or 'picked' (with `start`, UTC ms)
});
```

Without it, listen for `message` events yourself: check `event.origin` is Venn's, then read `event.data`, `{ venn: 1, type, poll, ... }`.

## How it stays safe

- Every Venn page says only Venn may frame it (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`). Only `/embed/<poll>` for a poll made from a template with websites listed adds those websites, and nothing else. Change the list and it applies at once.
- The frame posts its messages only to the template's websites, so no other page can listen in. Messages carry the poll's id, never names, answers or tokens.
- Inside the frame there's no sign-in: browsers don't send Venn's cookie to a page in another site's frame, and nothing in an embed needs it. Guests' answers are remembered in that browser as on Venn.
- Polls without a template, and templates without websites, can't be shown on other websites.

## Not yet

Your own address for the polls (`polls.example.com`), and branded emails, aren't available yet. Emails about a white-label poll still come from Venn.
