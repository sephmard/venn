# Venn brand guidelines

The front door for anyone (person or AI) building something people see: the website, the app, emails, link previews, the README and the docs. Read this first. It is short on purpose and points to the detail.

| File                                                                       | What's in it                                                                                          |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **BRAND.md** (this file)                                                   | Who Venn is, the standing rules, voice, logo, and the two looks at a glance                           |
| [DESIGN.md](DESIGN.md)                                                     | The design system: every colour token, type scale, spacing, shape and component, in both looks        |
| [.claude/skills/venn-design/SKILL.md](.claude/skills/venn-design/SKILL.md) | The owner's specific decisions behind today's screens (calendars, answers, results, /brand, accounts) |
| [CLAUDE.md](CLAUDE.md)                                                     | Rules that matter in review (escaping, accessibility, phones first, tests)                            |

**Keep it current.** When the owner states a new preference or reverses one, update the file it belongs in, in the same PR: a rule or the voice here, a token or component in DESIGN.md, a screen-level decision in the skill. If code and these files disagree, the newest decision from the owner wins; fix whichever is wrong.

## Who Venn is

Venn finds the day that works for a group: dinners, book clubs, trips, game nights. One link, no sign-up, no app, no ads, free and open source.

- **The idea:** three overlapping circles. Everyone's free time overlaps somewhere; Venn finds it. The logo, the hero animation and the bullets all carry that one idea.
- **The promise:** from noise to a plan. A group chat going round in circles becomes one picked date.
- **The personality:** warm, playful and confident, never busy. Finn the dog is the mascot.

## The standing rules

These come from the owner and outrank habits and defaults. Check every change against them.

1. **Create a Venn is the primary action, everywhere.** Every page leads to making a poll. The top bar on every page is the logo, **Create a Venn** and the menu; signed out, a quiet **Sign in** sits after Create as plain text on wider screens, and nothing else. On phones the bar is only the logo, Create and the menu; Sign in is first in the menu. Empty states, "Poll not found" and the 404 page offer **Create a Venn**. Nothing (sign-in, templates, promos) competes with it for attention; accounts make Venn better for people who sign in, never stand in the way of creating.
2. **Keep the website simple.** The home page is the hero, the four benefits, one closing call to action, contact and the footer. No feature promo sections (the brand-template section was taken off for this); features live in the menu ("For organizations") or their own pages. The menu stays short: account, For organizations, For developers, Contact. Privacy, Terms and Contact live in the footer.
3. **Design mobile-first.** Design for a 375px phone, then check desktop. No sideways scrolling, 44px tap targets, 16px inputs. Walk the real journey on a phone before calling it done.
4. **Accounts are optional.** Making and answering polls never needs an account, and every poll and template keeps working by its link. Signing in adds a better experience (My polls on any device; saving a new brand template) without getting in the way. Never put a sign-in wall, prompt or banner in front of creating or answering. Sign-in is Google and email for now.
5. **Every UI PR shows phone and desktop screenshots** in its description: 390px and 1200px, in a Phone / Desktop table, retro (the default) and classic if both changed. See [CONTRIBUTING.md](CONTRIBUTING.md#before-you-open-a-pull-request).
6. **The UI explains itself; words don't.** If something needs a sentence to be understood, change the UI. Cut hints and labels that restate what the screen shows.
7. **Consistent everywhere.** The same thing looks, reads and behaves the same in every place.
8. **Welcome developers, quietly.** Venn is open source with an open API, and developers are invited in without crowding the people making polls: **For developers** in the menu (to docs.venn.day), one "Build on Venn." line with **Developer docs** and **GitHub** buttons at the top of every website footer, the "Open source, with a free API" benefit, and the README's "Build with Venn" section. Nothing developer-facing goes in the top bar, the hero or the app's poll pages. The developer docs open on a quickstart (make a poll, hear about answers, embed it), and their top bar shows GitHub as a button.
9. **Never** put the owner's name in the product, the website or the docs.

## Name and wording

- The product is **Venn** (capital V). A poll is also "a Venn": the button is **Create a Venn**, the celebration is "Your Venn is ready!". The tagline: **"Find the day that works."** The sign-off: "Stop the back-and-forth. Just Venn it."
- The website is **venn.day**; the developer docs are **docs.venn.day**.
- Say **available**, not "free", for time (free means no cost). Answers are **Available · If needed · Unavailable**.
- Say **poll**, **organizer** and **guests**. Not "event", "host", "admin" or "users" in the interface.
- Example names: **Dinner at Rosa's**; people are Priya, Marcus, Ana, Jordan and Lee.

## Voice and tone

Friendly, plain and short, like a helpful friend in the group chat.

- **The strongest line, once.** Drop a heading that restates the sentence under it. "Free, with no trial, no paid plan and no catch." is the whole message.
- **Benefits, not features.** Say what people get ("No account and no app, just the link."), not what the software has.
- **Plain words, short sentences.** Sentence case for headings and buttons. Buttons say what they do: Create a Venn, Copy link, Pick this time?
- **Calm, never pushy.** No exclamation marks in Finn's lines or the interface (the two celebrations are the exception), no urgency, no hype words ("revolutionary", "seamless").
- **Errors say what happened and what to do**, in the page, never in a browser `alert()` or `confirm()`.
- **Finn** is warm and a bit funny, never mean: "Finn is waiting by the door", "Finn already has the party hat on".
- **Emoji** mark the kind of plan in the app (🍝 dinner, ✈️ trip). The website stays without.

## The logo

- **The mark:** three circles in a triangle, a three-way Venn, darkest where all three meet. Never redraw it, stretch it, recolour it outside these versions, or add effects.
- **Neon (default):** `public/logo-retro.svg`, cyan, magenta and yellow rings with a sunset at the centre. It is the header mark in **every** look: retro, classic and on branded polls.
- **Green (classic):** `public/favicon.svg`, green gradients. Used for the classic tab icon, the app icon and link previews in the classic look.
- **Wordmark:** the mark beside "Venn" in the page's heading font, at 28px in the top bar.
- **Other organizations' logos** (brand templates) sit beside the poll, never in place of Venn's.
- **White label** is the one exception: a template with **Hide Venn's name and logo** switched on (off by default) shows its polls with no Venn mark, top bar, footer or Finn, and only such polls. See [docs/EMBED.md](docs/EMBED.md).
- Tab icons, the home-screen icon and link previews: see [DESIGN.md](DESIGN.md#imagery-and-motion).

## The two looks

**Retro is the default** for the website and for new polls. **Classic mode** at the end of the footer switches to the classic look (remembered in the browser; `venn.day/classic` links to it). An organizer can turn a poll's Retro look off. Brand templates replace both on their own polls only.

|              | Retro (default)                                                     | Classic                                        |
| ------------ | ------------------------------------------------------------------- | ---------------------------------------------- |
| Feel         | A synthwave night: stars, scanlines, a striped sun on a neon grid   | Warm editorial: warm paper, calm and confident |
| Background   | `#0d0221` deep-space purple, one look day and night                 | `#faf8f4` warm paper (`#0f1112` in dark mode)  |
| Accent       | Neon cyan `#2de2e6` with magenta `#ff3cac`                          | Green `#0b7a5c` (`#2fc497` in dark mode)       |
| Headlines    | Orbitron 700/900 caps in chrome, a sunset gradient on the key words | Instrument Serif, italic green for emphasis    |
| Small labels | Press Start 2P pixel type                                           | System sans, 600, spaced caps                  |
| Body text    | System sans                                                         | System sans                                    |
| Big button   | Magenta-to-purple gradient pill, white text                         | Green gradient pill, white text                |

All fonts are self-hosted in `public/fonts/` (SIL OFL). Tokens live as CSS variables (`public/site.css`, `public/styles.css`, `public/retro-app.css`); pages use the variable names, never raw values. Full tables: [DESIGN.md](DESIGN.md).

**In every look, answers keep their colours:** available is green, if needed amber, unavailable pink (never red), not answered plain. Today is the accent. The picked date gets the serif (or chrome) treatment.

## Imagery and motion

- **Finn** (`public/img/dog.webp`) is the only character. Poses are the same picture moved and dressed up, never new art; in retro, Finn stays smooth, never pixelated. venn.day's own link preview has no Finn; in the app Finn stays prominent.
- **No stock photos, no icon sets, no gradients on body text.** Benefits use the logo as their bullet. The GitHub mark appears only on links to the repository (the website footer and the docs bar).
- **Motion is a reward, not decoration:** the hero's group-chat story, small hover lifts, a small celebration for picking a date and a big one for creating a poll. Everything stands still under `prefers-reduced-motion`.
- **Link previews** are short: the logo and one headline. Each poll's title and date are text tags, never drawn into the image.

## Accessibility is part of the brand

WCAG AA contrast in every look and mode (body text well above), visible focus rings, accessible names, keyboard access. Brand-template colours are adjusted to meet AA rather than refused. The axe tests in `e2e/a11y.spec.js` enforce the basics.

## Checklist for a change people will see

- [ ] Create a Venn is still the most prominent action on the page
- [ ] Works at 375px with no sideways scrolling, 44px taps and 16px inputs; then checked on desktop
- [ ] Nothing new asks for an account before creating or answering
- [ ] Looks right in retro and classic (and light and dark for classic)
- [ ] Uses tokens, not raw colours; answers keep green / amber / pink
- [ ] Copy is the strongest line once, in Venn's words (available, poll, organizer, guests)
- [ ] Phone (390px) and desktop (1200px) screenshots are in the PR description
- [ ] BRAND.md, DESIGN.md or the design skill updated if a preference changed
