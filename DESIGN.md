# Venn design system

The marketing pages (`public/index.html`, `privacy.html`, `404.html`, styled by `public/site.css`) follow this file. The app itself (`public/styles.css`) shares the same green and neutrals.

**Direction: warm editorial.** Warm paper, an elegant serif for big headlines, a plain sans for everything else, and one idea carried through: overlapping circles, like the logo. Calm and confident; never busy.

## Color

Every color is a CSS variable in `site.css`. Pages use the names, never raw values.

| Token                     | Light                 | Dark                  | Role                                                                                       |
| ------------------------- | --------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `--paper`                 | `#faf8f4`             | `#0f1112`             | Page background                                                                            |
| `--paper-2`               | `#f2eee6`             | `#171a1c`             | Quiet panels, product-shot frame                                                           |
| `--line`                  | `#e4dfd4`             | `#2a2e31`             | Borders and dividers                                                                       |
| `--ink`                   | `#16181a`             | `#f1eee8`             | Text and headings                                                                          |
| `--ink-2`                 | `#55585c`             | `#a6a9ad`             | Secondary text (≥ 6:1 on paper)                                                            |
| `--green`                 | `#0b7a5c`             | `#2fc497`             | Primary: buttons, links, the overlap                                                       |
| `--green-ink`             | `#ffffff`             | `#06140f`             | Text on green                                                                              |
| `--green-soft`            | `#dcefe6`             | `#163a2f`             | Tints, step numbers                                                                        |
| `--mint`                  | `#c3f2de`             | `#1d4d3d`             | The logo's lightest shade; soft glows behind the hero                                      |
| `--green-deep`            | `#064c39`             | `#8ff0c8`             | The logo's deepest shade; end of the call-to-action gradient                               |
| `--cta-from` / `--cta-to` | `#0b7a5c` → `#064c39` | `#3fd8a6` → `#1f9d72` | The main call-to-action gradient; text is `--cta-ink` (white in light, near-black in dark) |
| `--card`                  | `#ffffff`             | `#171a1c`             | The hero's start card                                                                      |
| `--band`                  | `#16181a`             | `#171a1c`             | The one dark band ("No accounts…")                                                         |
| `--band-ink`              | `#faf8f4`             | `#f1eee8`             | Text on the band (`--band-ink-2` for secondary)                                            |
| `--band-accent`           | `#2fc497`             | `#2fc497`             | Green on the band (the band is dark in both modes)                                         |

Contrast: body text ≥ 7:1, secondary ≥ 4.5:1, white on green 5.3:1.

## Typography

- **Display:** Instrument Serif 400 (and italic), self-hosted in `public/fonts/` (SIL OFL). Headlines only.
- **Text:** the system sans stack (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). Fast and native.

| Name    | Size                           | Line height | Use                         |
| ------- | ------------------------------ | ----------- | --------------------------- |
| hero    | `clamp(3.25rem, 8vw, 6.5rem)`  | 0.95        | Hero headline (serif)       |
| h2      | `clamp(2.4rem, 5vw, 4rem)`     | 1           | Section headlines (serif)   |
| h3      | `1.125rem`, 600                | 1.3         | Step and fact titles (sans) |
| lede    | `clamp(1.125rem, 2vw, 1.3rem)` | 1.5         | Intro paragraphs            |
| body    | `1.0625rem`                    | 1.6         | Text                        |
| small   | `0.875rem`                     | 1.5         | Footer, captions            |
| eyebrow | `0.8125rem`, 600, +0.12em caps | 1           | Section labels              |

Lines stay under 65 characters. Italic serif is the only emphasis inside headlines, in `--green`.

## Spacing and layout

- 8px scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.
- Content width 1120px, side gutter 24px (16px on phones).
- Section spacing 128px on desktop, 88px on phones.
- Layouts are left-aligned. Only the final call to action is centered.

## Shape and depth

- Buttons are pills (`999px`). Product frames and panels: `20px`. Small chips: `999px`.
- One shadow, only on the product shot: `0 30px 80px -20px rgb(22 24 26 / 0.25)`. None in dark mode.

## Components

- **Primary button:** green pill, `--green-ink` text, 48px tall (44px minimum tap target). Hover darkens slightly; focus shows a 3px `--green` ring with 3px offset; no disabled state on these pages.
- **Secondary button:** text link style with an arrow, `--ink`, underline on hover.
- **Links:** `--green`, underlined in prose, plain in navigation.
- **Nav bar:** sticky, `--paper` at 96% with a light blur and a `--line` bottom border. Logo left; For groups, For developers, Docs, Privacy, a bordered **GitHub** pill (mark + label) and the primary button right. Under 900px the text links move into a menu (a `<details>` panel, no script); under 640px the GitHub pill becomes a 44px icon button, but it is always visible.
- **Poll cards:** the hero's centrepiece and the main way into the app. Two equal `--card` panels (28px radius, `--card-shadow`), one per kind of poll, each a plain link: **Vote on a few dates** (`/new/pick`, with Fri · Sat · Sun chips) and **Ask when people are free** (`/new/free`, with the logo's three circles). Each has a serif title, one line on how it works, who it's for in `--green`, and a gradient **Create →** pill. Hover lifts the card and outlines it in `--green`. They stack on phones.
- **Ghost button (on the dark band):** transparent with a light inset border. Used for **View on GitHub** next to **Read the API docs**.
- **Code card:** near-black on the dark band, 20px radius, monospace at 14px (12px on phones, wrapping), `$` prompts in `--band-accent`. It shows a real API request that works against venn.day.
- **Footer:** one row of small links on `--line` top border.
- **Focus:** every interactive element shows the green ring with `:focus-visible`.

## Imagery and motion

- **Logo:** three circles in a triangle, a three-way Venn. One shade where one circle covers, a deeper one where two overlap, and the deepest green where all three meet. Each shade is a green gradient. The header shows `favicon.svg` itself, so there is one source.
- The hero's background is the same three circles, very large and soft (radial `--mint` glows), behind the start card.
- **Tab icons** (all from `npm run icons`, which renders each SVG to an `.ico` of 16, 32 and 48 px). Each place has its own, so tabs are easy to tell apart:
  - **Site and app** (`favicon.svg`): the logo itself.
  - **Poll pages** (`favicon-poll.svg`, swapped in by `app.js` on `/e/:id`): the Venn in white on a green-gradient tile, with its centre lit up.
  - **Docs** (`site-src/favicon.svg`): the logo on a dark ink tile.

  All are drawn on a 16 px grid so they stay sharp in a browser tab. The home-screen icon (`icons/icon.svg`) puts the logo on `--paper`, inside the maskable safe zone. When an icon changes, bump the `?v=` on the icon links so browsers drop their cached copy.

- The GitHub mark (Octicons, official) appears only on links to the repository.
- **"Less group chat. More plans."** is shown, not screenshotted: a slightly tilted group-chat card going back and forth, an arrow, then a crisp result card ("Dinner at Finn's", the agreed date, everyone's initials, Add to calendar). It's built in HTML and CSS, so it stays sharp and follows dark mode, and it's one `role="img"` with a description for screen readers. The landing page has no product screenshots.
- Example names: use **Finn's** for the restaurant ("Dinner at Finn's"), and Priya, Marcus, Ana, Jordan and Lee for people.
- Benefits use the logo as their bullet. No other icons, no emoji, no stock photos, no gradients on text.
- Motion: only small hover lifts on the choice buttons.

## The app

The app (`public/styles.css`, for `/new` and `/e/:id`) uses the same colors and fonts, plus a few things of its own:

- **Roles:** green for actions and "Yes", amber for "If needed", blue (`--final`) for the picked date.
- **Type:** Instrument Serif only for the page title, the best option and the picked date. Everything else is the system sans.
- **People** appear as round avatars with initials, in a color from their name. Overlapping avatar stacks echo the Venn.
- **Quick picks** are pills that fill with green when pressed: kinds of plan, lengths, parts of the day. No dropdowns where a few choices will do.
- **Organizers draw options on a week** (a day at a time on phones), in 30-minute steps: drag to draw, or tap to add one of the plan's length; drag an edge to make it longer or shorter, or drag it to another time. Each option is marked Available or If needed for the organizer, and that becomes their own answer when the poll is created. **Days, then times** is the other way in: pick days on a month, then start times. "Options in your poll" always lists exactly what guests will see.
- **Asking when people are free** starts with how long the plan is. For hours, the organizer paints the times guests can mark on a week (a day at a time on phones), with quick fills for mornings, afternoons and evenings; days with the same hours are listed together under "What your guests will mark". For all day or several days, they pick days on the month.
- **Answers use colour and words.** Yes is green, if needed amber, and an explicit no is red, so it never looks like an unanswered row. Guests see a summary of what they picked, and need a name and at least one answer (or "None of these work") to save.
- **Guests see options on a calendar too**: Week on desktop, Day on phones, with overlapping options side by side.
- **Emoji** mark the kind of plan (🍝 dinner, ✈️ trip…) in the app only; the landing page stays without.
- **Phones first:** 44px tap targets, 16px inputs, sticky Save and Create bars, and two tabs ("Your answer", "The group") that become two columns on wide screens.
- **Motion:** two celebrations. Picking the date gets a small one. Creating a poll gets a big one (`public/celebrate.js`): the Venn circles slide together behind the dog (`public/img/dog.webp`), confetti flies, and "Poll created! So proud of you for bringing people together." stays up for a few seconds before the poll opens. Its button opens the poll straight away. Under `prefers-reduced-motion` nothing moves: the note just shows, then the poll opens.
