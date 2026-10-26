# Usage stats

Venn can count how it's used: how many polls are made and of which kind, how many get answers, and how many end with a date. These counts show what's working and what to improve, without tracking anyone.

Stats are off until the server has a `STATS_TOKEN`. That token also unlocks the stats page.

## What's counted, and what isn't

Each count is a number for one day. For example, "3 polls created on 2026-10-26 to vote on dinner times, with 4–7 options". That's all that's stored:

- No user, poll or answer IDs, so counts can't be joined up or traced to a person or poll.
- No names, titles, places, emails, IP addresses, user agents or times finer than the day.
- No cookies, no local IDs and no third-party scripts. Counts go to Venn's own server.
- Browsers that send [Global Privacy Control](https://globalprivacycontrol.org/) or Do Not Track aren't counted at all.

Only the events and values listed in `USAGE_EVENTS` in [`src/usage.js`](../src/usage.js) are kept. The server drops anything else. The browser can't send the events the server counts itself (polls created, answers and so on).

| Event                                           | Counted by | Properties                                                                                                                                                        |
| ----------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `poll.created`                                  | Server     | `kind` (pick, free), `detail` (times, allday, trips, days, parts, hours), `plan` (dinner, trip…), `options` (1, 2-3, 4-7, 8-15, 16+), `ifNeeded`, `email`, `copy` |
| `poll.edited`, `poll.deleted`, `poll.finalized` | Server     | `kind`                                                                                                                                                            |
| `answer.created`                                | Server     | `kind`, `copy` (asked for an email copy)                                                                                                                          |
| `answer.updated`, `answer.deleted`              | Server     | `kind`                                                                                                                                                            |
| `notify.email`, `notify.webhook`                | Server     | none                                                                                                                                                              |
| `calendar.ics`                                  | Server     | none                                                                                                                                                              |
| `ai.used`                                       | Server     | `feature` (draft, answer, summary, message)                                                                                                                       |
| `view`                                          | Browser    | `page` (chooser, pick, free, poll), `as` on polls (guest, answered, organizer)                                                                                    |
| `share`                                         | Browser    | `from` (created, poll), `how` (sheet, copy)                                                                                                                       |

**Poll outcomes aren't counted.** "Got answers", "date picked" and "guests per poll" are worked out when the stats are read, from the polls themselves.

## Turning it on

1. Make a long random token, for example with `openssl rand -base64 32`.
2. Give it to the server as `STATS_TOKEN`. On Cloudflare:

   ```sh
   npx wrangler secret put STATS_TOKEN
   ```

   With Node, set it as an environment variable.

3. Open `/stats` on your server and enter the token. It's kept in that browser until you choose "Forget the token on this device".

`GET /api/config` reports `"usage": true` once stats are on. Browsers only send their counts then.

## Reading the stats from code

```sh
curl -H "authorization: Bearer $STATS_TOKEN" "https://venn.example/api/stats?days=30"
```

It returns:

- `counts`: `[{ day, name, props, count }]`.
- `outcomes`: for each kind of poll (`all`, `pick`, `pick/times`, `free/parts` and so on), `{ polls, answered, finalized, medianGuests, guests }`. These cover polls created in the period. `guests` is a histogram of guest answers per poll.

`days` is 1 to 365, and 30 if left out.

## Turning it off

Remove `STATS_TOKEN`. Counting stops at once. To delete what's been counted, run `DELETE FROM usage_counts` on the database.
