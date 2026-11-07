# AI features

Venn can use Anthropic's Claude to make scheduling faster. Everything is optional: AI is off until the server has an API key (or lets people bring their own), and the app works the same without it.

| Feature                        | Who sees it   | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use AI**                     | Organizers    | One box above the Date · Vote switch, in the same place on Create a Venn (/new) and on a Vote (/new/topic): "Describe it, and Venn sets it up". Venn picks the kind of poll (`ai/draft`, see "Which kind of poll" below) and fills it in for review, moving to the other form when it needs to. A date poll gets its name, an emoji with one of Venn's tile backgrounds, the place if named, and the days, parts of the day or hours; a vote gets its question and options. It says what it picked and why, with Undo. On "vote on a few dates", "45 minutes with the design team, afternoons next week" fills in the title, length, dates and times. |
| **Describe your organization** | Organizations | On a brand template's Starting look, or from **Make one with AI** in My polls' Templates, a sentence fills in its colours, fonts, corners and buttons, and (where still empty) its name, its polls' emoji and their usual name. It says what it filled in, with Undo, and everything stays editable.                                                                                                                                                                                                                                                                                                                                                  |
| **Summarize with AI**          | Organizers    | A plain-language read of the responses, a suggested time with the reason, and a button to pick it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Write a message**            | Organizers    | Drafts an invite, a reminder or a final-time announcement, ready to paste.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Answer for me**              | Invitees      | Fills in Yes / If needed / No from what you write ("no mornings") and, optionally, your calendar's busy times.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

People always review the result: drafts fill a form, answers can be changed before saving, and nothing is picked or sent automatically. AI isn't offered on polls inside another website's frame (`/embed`) or on white-label polls.

## How Use AI reads times

On Create a Venn, Use AI picks how guests answer, the days and their times, by these rules (`src/days-draft.js`):

- **Days** when the plan has no time-of-day limit: all-day plans and trips. A trip of several days sets Days in a row.
- **Parts of day** when the words state or imply mornings, afternoons or evenings. Date night, dinner, drinks or a party imply evening; brunch implies morning; lunch afternoon.
- **Hours** only for clock times, bounded windows ("between 9 and noon", "after 6pm") or a length that needs exact times. It uses the window given and never makes up a start time or a length.
- What the person says beats what the plan implies ("date night, but only afternoons" is afternoons). "Only free", "except" and "busy" exclude; a preference keeps the less preferred days as _if needed_.
- Dates come from the person's own date and time zone, in Monday-to-Sunday weeks. Days and today's times that are over are left out, and it says so.
- **A vote, not a time.** It also says what the group is deciding (`decide`: when, what or both), which the box uses to pick the kind; see below.

## Which kind of poll

The one box picks a date poll or a vote by these rules, first match wins (`src/ask-kind.js`, tested in `test/ask-kind.test.js`):

1. **Words in the request.** "vote", "a poll on/about", "choose/pick between", "which (one)" and "decide what/where/which" make a vote; "find a date/time/day", "when can/should", "schedule", "what day", "which day(s)" and "availability" make a date poll. They're checked on the server after the model answers, so they win over it. English only; other words fall through.
2. **What's still open,** as the model read it. Choices to pick between make a vote, a time to find makes a date poll. **Choices and a time both** make a vote first: on one set day ("pizza or tacos on Friday?") the day goes in the vote's note ("Friday, Nov 6") and the card says "Venn made this a vote, because Friday is already set."; on several days, it says Find a date for it gives the days once the vote is decided. Either way, **Make it a date poll instead** beside Undo opens the date poll with the days it read and the question as its name, with no second request. Deciding where and when with nothing named to pick from stays a date poll, with **Vote on it first**.
3. **A question with no time in it,** and nothing named to pick from ("should we get a dog?", "ask my wife if she thinks I'm cute"), makes a vote: yes or no when it's one ("Venn made this a vote, because you asked yes or no."), or with options the vote writer suggests ("…because there's no date to find. Check the options it suggested."). Only words that ask when ("when can we meet") with no time read keep the date poll's "Couldn't find any days".
4. **Nothing usable:** it says so in the box and nothing changes.

One press is one request and one unit of the allowance, whichever form it fills. Usually it's one model call; a second (the vote writer) runs only when a vote has nothing named to pick from, to tell a yes-or-no question from a list still to come. Moving to the other form keeps what was typed on the form being left (its draft) and, when the other form already had a draft, says "It replaced the vote you'd started. Undo brings it back." Undo puts back the form and the kind. A brand template's link (`?brand=`, including `none`) stays across the move, and what AI wrote wins over a template's starting text. The days AI read are never saved with a vote. Usage counts `ai.used` with `picked` and `why` (words, open, both or question), and `ai.ask` with `undone` or `switched` when someone reverses the pick; never the text.

The model answers in a fixed shape (its reading first, then the mode, the usual parts of the day, and each day's own parts or window). The server settles that into the least precise mode that keeps every time it was given: a day with clock times makes it hours and a part of the day makes it parts, so an evening is never lost to "all day". The page then says what it picked ("Evenings: Wed, Nov 4 · Thu, Nov 5 · …") with any assumption, and Undo. Asking again replaces the draft; Undo puts back what was there, including days picked by hand.

The full policy and acceptance matrix are tested in `test/days-draft.test.js` and `e2e/ai-days.spec.js`. To check the live model against the matrix, run `ANTHROPIC_API_KEY=… npm run ai:eval` (3 runs of each case, a fraction of a cent each). Its `k` cases check which kind of poll the box makes.

## Jev and Claude: System 1, then System 2

Venn's AI follows one rule: **Jev is System 1 and Claude is System 2**, after Daniel Kahneman's _Thinking, Fast and Slow_. Jev makes the fast, typed decisions first: which of a few answers, yes or no, a score. Claude is called only when it's needed: to create something (titles, questions, options, days, messages, summaries) or to reason where Jev isn't sure. Anything that needs no model at all (the calendar's busy times, the word rules) is decided in code before either. Jev is named after William Stanley Jevons: cheaper intelligence gets used for more.

Today that means:

- **Use AI:** Jev picks the kind of poll and Claude writes it (below).
- **Answer for me** (`answerForMe` in `src/ai.js`): a busy time in the calendar is No and a tentative one is at most If needed, with no model. Jev answers each other time from what the person wrote (one choice question per time, `jevAnswers` in `src/jev.js`, up to 40 times a request). Claude answers only the times Jev isn't 80% sure about, or all of them when Jev is off or fails. Jev never sees the calendar. Answers Jev decides carry no note; calendar and Claude answers keep theirs. Jev gets 2.5 seconds here (4 for Use AI), since Claude waits for it. Usage counts `ai.used` with `feature: answer` and `by`: `jev` when Claude wasn't needed, `calendar` when every time was busy, otherwise `claude`.

New AI work starts by asking which part is a decision Jev can make.

## Jev: which kind, decided first

[Jev](https://openrouter.ai/docs/guides/community/jev) is TypeSafe's decision model. It answers a typed question about a text (here: which of four kinds of poll it asks for: a date poll, a vote, a yes-or-no question, or nothing to set up) with a probability for each answer, in well under a second, for a few millionths of a dollar. Venn reaches it through OpenRouter's Decisions API (`src/jev.js`, model `typesafe/jev-1.14`, pinned), asking OpenRouter for providers that don't collect the text.

In the one Use AI box (`draftAny` in `src/ai.js`), Jev decides and Claude writes:

1. Jev reads the sentence at the same time as Claude's read, so it adds no wait.
2. When Jev is sure (80% or more), its kind wins, over the words too (`jevPick` in `src/ask-kind.js`). Claude still writes everything in the poll: the days and times, the title, the question and its options. A date poll needs days Claude found; if it found none, Jev's pick is set aside rather than make days up. Sure it's yes or no, the vote is one yes-or-no question, whatever options the writer offered.
3. When Jev isn't sure, says there's nothing to set up, fails (4 seconds at most) or isn't set up, the rules in "Which kind of poll" decide, exactly as before.

It's the same press and the same one unit of the allowance. Jev's cost (about $0.00002 a request, on the server's OpenRouter key, also for people using their own Anthropic key) isn't counted against the allowance or the weekly dollar cap: the AI rate limit bounds it, and a credit limit on the OpenRouter key is the backstop. Only the sentence typed goes to Jev, and the privacy page says so. Usage counts `ai.used` with `by`: `jev`, `claude` or `words`, never the text.

**Watching it.** A fixed set of 55 sentences, each with the kind it should make (`src/kind-cases.js`, written for the set and never anything a person typed), is checked every hour on the server (`src/kind-check.js`): five sentences go to Jev and to Claude's picker on its own (without Jev), and each answer is counted as `kind.check` in the usage stats, with whether Jev was sure and, for a vote from Claude's picker, whether it came with options (`filled`). The whole set is checked once a day, in the first eleven hours (UTC). Both are paid by the server's keys and count against `AI_WEEKLY_BUDGET_USD`, about 3 cents a day; past the cap nothing is checked. Jev doesn't review Claude's drafts or send them back for another pass: measured on the full set in November 2026, it caught 1 of 9 bad drafts and flagged 7 good ones, so that was left off. The word rules alone settle 14 of the 55 right (pinned in `test/jev.test.js`).

## Days from plain words, without AI

Where AI can't answer, Create a Venn still reads simple descriptions of when, with no model at all (`src/days-parse.js`). That covers a server without AI, where the button says **Describe it** and the box says Venn reads it itself. It also covers a server with AI when the person has no key of their own and the weekly allowance is used up. It runs only in those cases, never ahead of AI, and nothing is sent to Anthropic.

It understands:

- weekday names ("Fridays", "Tue and Thu")
- "weekend" and "weekends", and "weekdays"
- mornings, afternoons and evenings, and what dinner, lunch, brunch, drinks or date night imply
- today, tonight and tomorrow
- this week, next week, this weekend and next weekend
- the next two (three, few) weeks
- this month, next month, and a month by name ("in December", "late November")
- a trip of a few days or nights, or a weekend trip

Its answer goes through the same checks as AI's (`shapeDays` in `src/days-draft.js`) and is shown the same way, for review with Undo. It notes that it was read from the words (on a server with AI, without AI), and says what it assumed, such as "Took date night as evenings."

It leaves alone anything it can't read for sure: clock times, dates by number, "except", "ideally" or "if needed", and anything that sounds like a vote. Then the page goes on as before. In the one box, a plain choice it can split on commas and "or" ("Italian, Thai or Mexican?", no times in it) becomes a vote with those options; a vote it can't split says "Without AI, Venn can read days but not choices. Type the options below." Without AI there's no box on a Vote (/new/topic). Without AI, the box asks the person to name the days or pick them on the calendar. With AI but no key, the key form offers **Fill it in yourself**. Its cases are tested in `test/days-parse.test.js` and `e2e/no-ai-days.spec.js`.

## Who pays: a weekly allowance, then people's own keys

The server's key pays for a set number of AI requests each week: per person (their account when signed in, otherwise their IP address) and for everyone together. Past either limit, the AI panel asks for the person's own Anthropic API key. It's kept in their browser (local storage), sent with each AI request in the `x-anthropic-key` header, used for that request only, and never stored or logged by the server. Requests with a key of their own don't count against the allowance.

Before asking, the app can check `GET /api/ai/allowance`, which answers `{ "allowance": "available" | "used" | "off" }` for this visitor this week. `used` means their share, everyone's, or the dollar cap is used up, and it doesn't say which. `off` means AI is off or the server's key pays for nothing. It never returns a count or a dollar figure, and it takes nothing from the allowance. It only says who would pay: whichever key pays, an AI request still sends its text to Anthropic.

The weekly counts are kept in the `ai_allowance` table under a SHA-256 hash of the week and the account or IP address, so nothing readable is stored and one week can't be matched to the next. Earlier weeks are deleted when a new one starts.

## Turning it on

1. Create an API key in the [Claude Console](https://platform.claude.com/).
2. Give it to the server as `ANTHROPIC_API_KEY`. On Cloudflare:

   ```sh
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

   With Node, set it as an environment variable. The AI buttons appear automatically.

### Settings

| Setting                  | Default             | Notes                                                                                                                                                                                          |
| ------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`      | (off)               | Required to turn AI on. Keep it secret.                                                                                                                                                        |
| `AI_MODEL`               | `claude-haiku-5-5`  | Any Claude model ID. Haiku is quick and cheap; Sonnet and Opus cost more per request. Models other than Haiku retry a false-positive refusal on a fallback model.                              |
| `AI_RATE_LIMIT`          | `10`                | AI requests per minute per visitor (IP address), counted on each server.                                                                                                                       |
| `AI_WEEKLY_LIMIT`        | `20`                | AI requests the server's key pays for, per person each week. `0` turns the server's key off: everyone brings their own.                                                                        |
| `AI_WEEKLY_TOTAL`        | `2000`              | AI requests the server's key pays for each week, for everyone together. A ceiling on the bill.                                                                                                 |
| `AI_WEEKLY_BUDGET_USD`   | `5`                 | The most the server's key spends each week, in US dollars, worked out from each answer's token counts. Past it, people bring their own key until Monday (UTC). `0` turns the server's key off. |
| `AI_OWN_KEYS`            | (off)               | `on` turns AI on without a server key: everyone brings their own Anthropic key.                                                                                                                |
| `JEV_API_KEY_OPENROUTER` | (off)               | An OpenRouter key for Jev (see "Jev" above). Turns on Jev in Use AI, and the hourly check (with `STATS_TOKEN`). Keep it secret.                                                                |
| `JEV_MODEL`              | `typesafe/jev-1.14` | Another Jev release, such as `~typesafe/jev-latest`.                                                                                                                                           |

On Cloudflare, each Worker instance counts separately. So `wrangler.toml` also sets a [rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) named `AI_RATE_LIMITER` (10 a minute, counted across instances), which a request must pass as well.

## Cost

Each AI action is a single, short request. Effort is set to `low` for summaries, answers, messages and template looks, and `medium` for drafting polls and days, which needs a little date reasoning. On Haiku a request costs a small fraction of a cent, so the default weekly ceiling of 2,000 requests stays around a dollar or two a week. Watch the Usage page in the Claude Console after launch. The weekly dollar cap (`AI_WEEKLY_BUDGET_USD`, $5 by default), the weekly allowance and the per-visitor rate limit stop anyone from running up your bill; a monthly spend limit on your Anthropic account is a good backstop.

## Privacy and safety

- **What is sent to Anthropic:**
  - for drafts and template looks, the description typed in (and the organization's name)
  - for summaries and messages, the poll's title, details, times, and participants' names and answers
  - for "Answer for me", the person's preferences and, only if they tick the box, the start and end of their busy calendar blocks

  What is sent to Jev (OpenRouter and TypeSafe): the Use AI sentence, and for "Answer for me" the preferences, the time zone and the poll's times, never the calendar.

  Calendar event titles are never read, so they can't be sent. Each feature tells people their text goes to Anthropic.

- **The API key stays on the server.** Browsers call Venn, and Venn calls Claude.
- **User text is treated as data.** Everything people type is wrapped in tags, and the model is told never to follow instructions inside them. Every response must match a fixed JSON schema, and the server re-checks it: drafted dates must be real and in the future, and answers must refer to real options.
- **Refusals are handled.** On Sonnet and Opus, requests use Anthropic's server-side fallback (`fallbacks: "default"`), so a false-positive safety refusal is retried on a fallback model. Haiku, the default, has no fallback. A refusal shows a friendly message.
- **Only organizers** can use Summarize and Write a message, using the same organizer link that controls the poll.
