# AI features

Venn can use Anthropic's Claude to make scheduling faster. Everything is optional: AI is off until the server has an API key, and the app works the same without it.

| Feature               | Who sees it | What it does                                                                                                    |
| --------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| **Describe it**       | Organizers  | "45 minutes with the design team, afternoons next week" fills in the title, length, dates and times to propose. |
| **Summarize with AI** | Organizers  | A plain-language read of the responses, a suggested time with the reason, and a button to pick it.              |
| **Write a message**   | Organizers  | Drafts an invite, a reminder or a final-time announcement, ready to paste.                                      |
| **Answer for me**     | Invitees    | Fills in Yes / If needed / No from what you write ("no mornings") and, optionally, your calendar's busy times.  |

People always review the result: drafts fill a form, answers can be changed before saving, and nothing is picked or sent automatically.

## Turning it on

1. Create an API key in the [Claude Console](https://platform.claude.com/).
2. Give it to the server as `ANTHROPIC_API_KEY`. On Cloudflare:

   ```sh
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

   With Node, set it as an environment variable. The AI buttons appear automatically.

### Settings

| Setting             | Default           | Notes                                                                                                                          |
| ------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY` | (off)             | Required to turn AI on. Keep it secret.                                                                                        |
| `AI_MODEL`          | `claude-opus-5-5` | Any Claude model ID. `claude-sonnet-5-5` or `claude-haiku-5-5` cost less per request; check that quality holds for your users. |
| `AI_RATE_LIMIT`     | `10`              | AI requests per minute per visitor (IP address), counted on each server.                                                       |

On Cloudflare, each Worker instance counts separately. To enforce one limit everywhere, add a [rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) named `AI_RATE_LIMITER` in `wrangler.toml`. Venn uses it automatically when present.

## Cost

Each AI action is a single, short request. Effort is set to `low` for summaries, answers and messages, and `medium` for drafting polls, which needs a little date reasoning. Costs depend on the model you choose and on usage, so watch the Usage page in the Claude Console after launch. The per-visitor rate limit stops one person from running up your bill. Consider a monthly spend limit on your Anthropic account too.

## Privacy and safety

- **What is sent to Anthropic:**
  - for drafts, the description typed in
  - for summaries and messages, the poll's title, details, times, and participants' names and answers
  - for "Answer for me", the person's preferences and, only if they tick the box, the start and end of their busy calendar blocks

  Calendar event titles are never read, so they can't be sent. Each feature tells people their text goes to Anthropic.

- **The API key stays on the server.** Browsers call Venn, and Venn calls Claude.
- **User text is treated as data.** Everything people type is wrapped in tags, and the model is told never to follow instructions inside them. Every response must match a fixed JSON schema, and the server re-checks it: drafted dates must be real and in the future, and answers must refer to real options.
- **Refusals are handled.** Requests use Anthropic's server-side fallback (`fallbacks: "default"`), so a false-positive safety refusal is retried on a fallback model. A real refusal shows a friendly message.
- **Only organizers** can use Summarize and Write a message, using the same organizer link that controls the poll.
