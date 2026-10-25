# API

Venn's JSON API is served under `/api` by both the Cloudflare Worker and the Node server. Writes must be sent as `application/json`. Times are UTC milliseconds.

## Endpoints

| Method           | Path                                 | Notes                                                                                                           |
| ---------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `POST`           | `/api/events`                        | Create a poll → `{ id, adminToken }`. Specific times: `{ mode: "options", options: [{ start, end }] }` (UTC ms) |
| `GET`            | `/api/events/:id`                    | Poll and responses. Sending the `x-admin-token` header sets `isAdmin`.                                          |
| `DELETE`         | `/api/events/:id`                    | Organizer only                                                                                                  |
| `POST`           | `/api/events/:id/participants`       | `{ name, availability }` → `{ id, editToken }`                                                                  |
| `PUT` / `DELETE` | `/api/events/:id/participants/:pid`  | Needs `x-edit-token`. The organizer can also delete.                                                            |
| `POST`           | `/api/events/:id/finalize`           | `{ start }`, or `{ start: null }` to clear. Organizer only.                                                     |
| `GET`            | `/api/events/:id/event.ics`          | Calendar file for the picked time                                                                               |
| `GET` / `PUT`    | `/api/events/:id/notifications`      | Email and webhook settings. Organizer only. See [Notifications](NOTIFICATIONS.md).                              |
| `POST`           | `/api/events/:id/notifications/test` | Send a test webhook. Organizer only.                                                                            |
| `GET`            | `/api/config`                        | Which optional features (email, calendars, AI) this server has turned on                                        |
| `POST`           | `/api/ai/draft-poll`                 | `{ prompt, timezone }` → a draft poll. See [AI features](AI.md).                                                |
| `POST`           | `/api/events/:id/ai/:kind`           | `summary` and `message` (organizer only), `answer` (anyone)                                                     |

## Availability

`availability` maps each option's start time (UTC ms) to `2` (yes) or `1` (if needed). Anything missing means no.

```json
{ "name": "Ana", "availability": { "1793804400000": 2, "1793818800000": 1 } }
```

## Authentication

There are no accounts. Two secrets, both returned once when they're created, prove who you are:

- **`adminToken`** (from `POST /api/events`): send it as `x-admin-token` for organizer-only calls.
- **`editToken`** (from `POST /api/events/:id/participants`): send it as `x-edit-token` to change or remove that response.

The server stores only SHA-256 hashes of these tokens. In the web app they live in the URL fragment and the browser's local storage.

## Errors

Errors come back as JSON with an HTTP status: `{ "error": "This poll does not exist or was deleted" }`. Validation problems are `400`, missing permissions `403`, and unknown polls `404`.
