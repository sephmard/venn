# AI features

Venn can use Anthropic's Claude to make scheduling faster. Everything is optional: AI is off until the server has an API key (or lets people bring their own), and the app works the same without it.

| Feature                        | Who sees it   | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use AI**                     | Organizers    | A "Use AI" button beside the first question of each create form. On Create a Venn (/new), "dinner, any Friday or Saturday evening this month" fills the poll for review (its name, an emoji with one of Venn's tile backgrounds, the place if named, and the days, parts of the day or hours), while nothing is picked yet, with Undo. On "vote on a few dates", "45 minutes with the design team, afternoons next week" fills in the title, length, dates and times. On a Vote (/new/topic), "dinner Friday: Rosa's, Luigi's or the Thai place" writes the question and options (`ai/draft-topic`). |
| **Describe your organization** | Organizations | On a brand template's Starting look, or from **Make one with AI** in My polls' Templates, a sentence fills in its colours, fonts, corners and buttons, and (where still empty) its name, its polls' emoji and their usual name. It says what it filled in, with Undo, and everything stays editable.                                                                                                                                                                                                                                                                                                 |
| **Summarize with AI**          | Organizers    | A plain-language read of the responses, a suggested time with the reason, and a button to pick it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Write a message**            | Organizers    | Drafts an invite, a reminder or a final-time announcement, ready to paste.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Answer for me**              | Invitees      | Fills in Yes / If needed / No from what you write ("no mornings") and, optionally, your calendar's busy times.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

People always review the result: drafts fill a form, answers can be changed before saving, and nothing is picked or sent automatically. AI isn't offered on polls inside another website's frame (`/embed`) or on white-label polls.

## How Use AI reads times

On Create a Venn, Use AI picks how guests answer, the days and their times, by these rules (`src/days-draft.js`):

- **Days** when the plan has no time-of-day limit: all-day plans and trips. A trip of several days sets Days in a row.
- **Parts of day** when the words state or imply mornings, afternoons or evenings. Date night, dinner, drinks or a party imply evening; brunch implies morning; lunch afternoon.
- **Hours** only for clock times, bounded windows ("between 9 and noon", "after 6pm") or a length that needs exact times. It uses the window given and never makes up a start time or a length.
- What the person says beats what the plan implies ("date night, but only afternoons" is afternoons). "Only free", "except" and "busy" exclude; a preference keeps the less preferred days as _if needed_.
- Dates come from the person's own date and time zone, in Monday-to-Sunday weeks. Days and today's times that are over are left out, and it says so.
- **A vote, not a time.** It also says what the group is deciding. "Choose between Italian, Thai and Mexican" changes nothing on the date form; the reply says it sounds like a vote and **Make it a vote** opens the vote (`/new/topic`) with the question and choices filled in. "Decide where and when" fills the days as usual and adds **Vote on it first**, since a vote leads to Find a date for it. Same single AI call; no extra cost.

The model answers in a fixed shape (its reading first, then the mode, the usual parts of the day, and each day's own parts or window). The server settles that into the least precise mode that keeps every time it was given: a day with clock times makes it hours and a part of the day makes it parts, so an evening is never lost to "all day". The page then says what it picked ("Evenings: Wed, Nov 4 · Thu, Nov 5 · …") with any assumption, and Undo. Asking again replaces the draft; Undo puts back what was there, including days picked by hand.

The full policy and acceptance matrix are tested in `test/days-draft.test.js` and `e2e/ai-days.spec.js`. To check the live model against the matrix, run `ANTHROPIC_API_KEY=… npm run ai:eval` (3 runs of each case, a fraction of a cent each).

## Who pays: a weekly allowance, then people's own keys

The server's key pays for a set number of AI requests each week: per person (their account when signed in, otherwise their IP address) and for everyone together. Past either limit, the AI panel asks for the person's own Anthropic API key. It's kept in their browser (local storage), sent with each AI request in the `x-anthropic-key` header, used for that request only, and never stored or logged by the server. Requests with a key of their own don't count against the allowance.

The weekly counts are kept in the `ai_allowance` table under a SHA-256 hash of the week and the account or IP address, so nothing readable is stored and one week can't be matched to the next. Earlier weeks are deleted when a new one starts.

## Turning it on

1. Create an API key in the [Claude Console](https://platform.claude.com/).
2. Give it to the server as `ANTHROPIC_API_KEY`. On Cloudflare:

   ```sh
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

   With Node, set it as an environment variable. The AI buttons appear automatically.

### Settings

| Setting                | Default            | Notes                                                                                                                                                                                          |
| ---------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`    | (off)              | Required to turn AI on. Keep it secret.                                                                                                                                                        |
| `AI_MODEL`             | `claude-haiku-5-5` | Any Claude model ID. Haiku is quick and cheap; Sonnet and Opus cost more per request. Models other than Haiku retry a false-positive refusal on a fallback model.                              |
| `AI_RATE_LIMIT`        | `10`               | AI requests per minute per visitor (IP address), counted on each server.                                                                                                                       |
| `AI_WEEKLY_LIMIT`      | `20`               | AI requests the server's key pays for, per person each week. `0` turns the server's key off: everyone brings their own.                                                                        |
| `AI_WEEKLY_TOTAL`      | `2000`             | AI requests the server's key pays for each week, for everyone together. A ceiling on the bill.                                                                                                 |
| `AI_WEEKLY_BUDGET_USD` | `5`                | The most the server's key spends each week, in US dollars, worked out from each answer's token counts. Past it, people bring their own key until Monday (UTC). `0` turns the server's key off. |
| `AI_OWN_KEYS`          | (off)              | `on` turns AI on without a server key: everyone brings their own Anthropic key.                                                                                                                |

On Cloudflare, each Worker instance counts separately. To enforce one limit everywhere, add a [rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) named `AI_RATE_LIMITER` in `wrangler.toml`. Venn uses it automatically when present.

## Cost

Each AI action is a single, short request. Effort is set to `low` for summaries, answers, messages and template looks, and `medium` for drafting polls and days, which needs a little date reasoning. On Haiku a request costs a small fraction of a cent, so the default weekly ceiling of 2,000 requests stays around a dollar or two a week. Watch the Usage page in the Claude Console after launch. The weekly dollar cap (`AI_WEEKLY_BUDGET_USD`, $5 by default), the weekly allowance and the per-visitor rate limit stop anyone from running up your bill; a monthly spend limit on your Anthropic account is a good backstop.

## Privacy and safety

- **What is sent to Anthropic:**
  - for drafts and template looks, the description typed in (and the organization's name)
  - for summaries and messages, the poll's title, details, times, and participants' names and answers
  - for "Answer for me", the person's preferences and, only if they tick the box, the start and end of their busy calendar blocks

  Calendar event titles are never read, so they can't be sent. Each feature tells people their text goes to Anthropic.

- **The API key stays on the server.** Browsers call Venn, and Venn calls Claude.
- **User text is treated as data.** Everything people type is wrapped in tags, and the model is told never to follow instructions inside them. Every response must match a fixed JSON schema, and the server re-checks it: drafted dates must be real and in the future, and answers must refer to real options.
- **Refusals are handled.** On Sonnet and Opus, requests use Anthropic's server-side fallback (`fallbacks: "default"`), so a false-positive safety refusal is retried on a fallback model. Haiku, the default, has no fallback. A refusal shows a friendly message.
- **Only organizers** can use Summarize and Write a message, using the same organizer link that controls the poll.
