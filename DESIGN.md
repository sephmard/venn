# Venn design system

The marketing pages (`public/index.html`, `privacy.html`, `404.html`, styled by `public/site.css`) follow this file, in their usual look or in **retro mode** (below). The app itself (`public/styles.css`) shares the same green and neutrals.

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
- **Nav bar:** sticky, `--paper` at 96% with a light blur and a `--line` bottom border. Logo left; For groups, For developers, Docs, Privacy, a bordered **GitHub** pill (mark + label) and the primary **Create a poll** button right, on every page including the home page, so it is one tap away however far down people scroll. Under 900px the text links move into a menu (a `<details>` panel, no script); under 640px the GitHub pill becomes a 44px icon button, but it is always visible.
- **Poll cards:** the hero's centrepiece and the main way into the app. Two equal `--card` panels (28px radius, `--card-shadow`), one per kind of poll, each a plain link: **Vote on a few dates** (`/new/pick`, with Fri · Sat · Sun chips) and **Ask when people are free** (`/new/free`, with the logo's three circles). Each has a serif title, one line on how it works, who it's for in `--green`, and a gradient **Create →** pill. Hover lifts the card and outlines it in `--green`. They stack on phones.
- **Ghost button (on the dark band):** transparent with a light inset border. Used for **View on GitHub** next to **Read the API docs**.
- **Code card:** near-black on the dark band, 20px radius, monospace at 14px (12px on phones, wrapping), `$` prompts in `--band-accent`. It shows a real API request that works against venn.day.
- **Footer:** one row of small links on `--line` top border: Templates, Privacy, Docs, GitHub, Contact (the home page's form).
- **Template pages** (`/templates`, `/templates/friendsgiving`, `holiday-party`, `secret-santa`): a breadcrumb, a serif H1 with a big gradient button that opens the app with that template chosen, and a poll drawn in HTML (dates with bars for how many can make each, the best one in green). Then how-to steps, tips with the logo bullets, a sample timeline and questions (with FAQPage JSON-LD). The home page links to them in a "Planning for the holidays?" section of cards.
- **Focus:** every interactive element shows the green ring with `:focus-visible`.

## Imagery and motion

- **Logo:** three circles in a triangle, a three-way Venn. One shade where one circle covers, a deeper one where two overlap, and the deepest green where all three meet. Each shade is a green gradient. The header shows `favicon.svg` itself, so there is one source.
- The hero's background is the same three circles, very large and soft (radial `--mint` glows), behind the start card.
- **Tab icons** (all from `npm run icons`, which renders each SVG to an `.ico` of 16, 32 and 48 px). Each place has its own, so tabs are easy to tell apart:
  - **Site and app** (`favicon.svg`): the logo itself.
  - **Poll pages** (`favicon-poll.svg`, swapped in by `app.js` on `/e/:id`): the Venn in white on a green-gradient tile, with its centre lit up.
  - **Docs** (`site-src/favicon.svg`): the logo on a dark ink tile.

  All are drawn on a 16 px grid so they stay sharp in a browser tab. The home-screen icon (`icons/icon.svg`) puts the logo on `--paper`, inside the maskable safe zone. When an icon changes, bump the `?v=` on the icon links so browsers drop their cached copy.

- **Link previews** (1200×630, `npm run og` renders them from HTML in `scripts/og-image.js`): `og.png` for the home page and polls still asking ("Find the day that works for everyone."), `og-set.png` for polls whose date is picked ("It's set."). Both are the logo drawn large with Finn the dog (`img/dog.webp`) standing where the circles meet, on `--paper`, with a serif headline big enough to read as a thumbnail. Each poll's own title and date are text tags beside the image (`src/preview.js`), never drawn into it. The website's own preview is `og-retro.png`, retro being its default look; `venn.day/classic`, the home page in the classic look, previews with `og.png` (the Worker serves it). A poll in the retro look shares `og-retro.png` / `og-set-retro.png` instead: the synthwave night, a striped sun over a neon grid, chrome Orbitron capitals and the neon logo (Finn on the "It's set" one, smooth as ever). A poll's own picture card follows its look too: drawn in neon when the retro look is on, and drawn again when the organizer switches it on the poll.
- The GitHub mark (Octicons, official) appears only on links to the repository.
- **The hero's group chat** is the story: chat bubbles, each with who sent it and tilted, bounce around going round in circles ("wait which week", "can't do Thu 😩", "oh wait, no", "did we pick a day"), then fly to the friend who sent them and the circles meet on the day that works. The home page has no separate group-chat section. Template pages still show a group-chat card next to a result card, built in HTML and CSS, one `role="img"` with a description. The landing page has no product screenshots.
- Example names: use **Rosa's** for the restaurant ("Dinner at Rosa's"), and Priya, Marcus, Ana, Jordan and Lee for people.
- Benefits use the logo as their bullet. No other icons, no emoji, no stock photos, no gradients on text.
- Motion: only small hover lifts on the choice buttons.

## The app

The app (`public/styles.css`, for `/new` and `/e/:id`) uses the same colors and fonts, plus a few things of its own:

- **Roles:** green for actions and "Yes", amber for "If needed", blue (`--final`) for the picked date.
- **Type:** Instrument Serif only for the page title, the best option and the picked date. Everything else is the system sans.
- **People** appear as round avatars with initials, in a color from their name. Overlapping avatar stacks echo the Venn.
- **Quick picks** are pills that fill with green when pressed: lengths, parts of the day. No dropdowns where a few choices will do. The length pills are the lengths templates use (1 to 4 hours, all day, several days), so a template never looks like a custom choice; half days and any other length are under "Custom", which looks chosen only when the length really isn't a pill.
- **Create says what's missing.** Until the poll can be made, the sticky bar names what's still needed ("Needed: poll name · options · your name", or the one thing in full), each a link to its field. A chosen template names the poll when the name is left empty.
- **Templates** (kinds of plan, `public/templates.js`) are a row of small cards, emoji over name, that scrolls sideways inside its sheet (never the page), snaps to each card and fades out at the far edge so it's clear there's more. A chosen card fills with green like a pill. Seasonal ones (Friendsgiving, Holiday party, Secret Santa, New Year's) lead while in season and are hidden otherwise; they also suggest a name, where, and a note for everyone, which never replaces what someone typed. `?template=friendsgiving` on a create page chooses one.
- **Little surprises** (`public/easter-eggs.js`, loaded on first typing or tapping): a few poll names, or a template tapped five times, get a line from Finn in the status message and a two-second burst of emoji with Finn peeking in. Once each, never in the way, and only the message under reduced motion.
- **Organizers draw options on a week** (a day at a time on phones), in 30-minute steps: drag to draw, or tap to add one of the plan's length; drag an edge to make it longer or shorter, or drag it to another time. Each option is Available for the organizer when added, and a second tap makes it If needed, the same on every calendar ("Tap: available · Tap again: if needed", under the hint); that becomes their own answer when the poll is created. To add many that are only if needed, "Mark many as if needed" (folded away under the calendar, next to the time zone) makes new ones if needed until it's switched off. Tapping an option switches it between the two; its × removes it (on hover with a mouse, always on touch screens). "Options in your poll" lists exactly what guests will see, and tapping one there switches it too.
- **Ask when people are free** zooms in the same way: whole days on a month, then mornings, afternoons and evenings on a week (pick them day by day), then hours painted on a week. Zooming keeps what's picked.
- **The organizer gives their email** when the server sends email, so they always get their poll's link. Times are in the organizer's own time zone; everyone sees them in theirs.
- **Asking when people are free** starts with how long the plan is. For hours, the organizer draws the times guests can mark on a week (a day at a time on phones), with a finger or the mouse, and the optional length sits under that calendar; days with the same hours are listed together under "What your guests will mark". For all day or several days, they pick days on the month. Every calendar's week starts on Monday.
- **Answers use colour and words.** Yes is green, if needed amber, and an explicit no is red, so it never looks like an unanswered row. Guests see a summary of what they picked, and need a name and at least one answer (or "None of these work") to save.
- **Guests answer one way, on a list.** A poll opens on its list for guests, with no calendar to switch to: whole-day polls by day, parts-of-the-day polls by part (with an **All day** shortcut on each day that marks all of its parts), specific times by option, and hours polls by each stretch of time the organizer offered ("Tue, Jan 8, 9:00 AM – 12:00 PM"), its answer going to every half hour in it. Every row has the same Yes / If needed / No. Only everyone's answers to an hours poll show as a grid. The organizer can also see their own answer on a calendar. The copy says "available", not "free" (free means no cost).
- **Add to your calendar**, once the date is picked: three named buttons with small logos drawn in the page, Google Calendar and Outlook (open in a new tab) and iCal (the .ics file, which Apple Calendar and most others open). Sharing and "Clear the date" sit below as plain links. Every share or copy of the poll is just its link.
- **"It's set" picture**, from the picked date's **Share as a picture** link (**Save as a picture** without a share sheet): a 1080×1920 story image drawn on a canvas (`public/share-card.js`, loaded when pressed). Finn in front of the Venn circles with a little confetti, the poll's emoji on a tilted tile, a green "It's set" pill, the title in Instrument Serif, the date in green, the initials of who can make it (never when the poll hides answers or names), and venn.day with the logo. It follows light or dark mode, and keeps clear of Instagram's buttons at the top and bottom.
- **Guests see options on a calendar too**: Week on desktop, Day on phones, with overlapping options side by side.
- **Emoji** mark the kind of plan (🍝 dinner, ✈️ trip…) in the app only; the landing page stays without.
- **The organizer's answer comes with the poll.** The times they offer count as their own answer, as they marked them (Available or If needed). They can change it on the poll like anyone, and the poll can still be edited until a guest answers.
- **Answers are explicit.** Available is green, If needed amber, Unavailable red, and not answered yet is plain. "Everyone's answers" uses the same colours.
- **Say less.** A hint only when the next step isn't obvious from the page.
- **Pick first, then your name.** On the answer form, the name and email fields sit just above **Save**, after the answers, so people start choosing straight away.
- **Edit, then duplicate.** Organizers can **Edit poll** until someone else answers. After that the button becomes **Duplicate poll**, which opens the create page filled in.
- **Phones first:** 44px tap targets, 16px inputs, sticky Save and Create bars, and two tabs ("Your answer", "The group") that become two columns on wide screens.
- **Finn, the Venn dog** (`public/img/dog.webp`) is the mascot. Finn has a few things to say on the poll page (`public/finn.js`, loaded after the page; the logic and every line are in `public/finn-moments.js`): a small note under the banners, Finn beside a speech bubble, with one of a few short lines picked at random. Warm and a bit funny, never mean, and no exclamation marks. The moments, most important first: the date is picked and this guest said they could make it ("Finn knew you’d be there"), the date is picked ("Finn already has the party hat on"), a date works for everyone who answered, at least three people ("Finn found a date that works for everyone"), the organizer's first answer from a guest, and the organizer's poll with no answers yet ("Finn is waiting by the door"). "Poll not found" and the 404 page have a puzzled Finn ("Finn couldn’t sniff out this poll"). Each moment shows once per poll in a browser, and can be closed. Poses are the one picture moved and dressed up, never new art: a hop, a wag, a head tilt, a look around, with a party hat, a heart, sparkles, "…" or a question mark drawn above, in the page's colours. The picture is decorative (`alt=""`); the words are a status message. Under `prefers-reduced-motion` Finn stands still.
- **Finn stickers** (`public/finn-stickers.js`, from **Finn stickers** in the "It's set" banner and in Finn's notes): six 512×512 see-through PNGs drawn on a canvas, Finn in front of the three circles with a caption on a tilted green pill in Instrument Serif ("It’s set!", "See you there", "I’m in", "Finn approves", "Plans > excuses", "Can’t wait") and something to match (a party hat, a scarf, hearts, a tick, sunglasses, sparkles), with a white sticker edge and a soft shadow so they work on any chat background. Tap to share (the share sheet on phones), otherwise they download; press and hold a preview to copy it. In the sheet they rock gently, unless motion is reduced.
- The landing page meets Finn once, quietly, under the closing call to action.
- **Motion:** two celebrations. Picking the date gets a small one. Creating a poll gets a big one (`public/celebrate.js`): the Venn circles slide together behind the dog (`public/img/dog.webp`), confetti flies, and "Poll created! So proud of you for bringing people together." stays up for a few seconds before the poll opens. Its button opens the poll straight away. Under `prefers-reduced-motion` nothing moves: the note just shows, then the poll opens.

## Retro mode

Retro is the website's default look; **Classic mode** in its menu switches to the classic look above (`public/retro-mode.js`, a tiny script in `<head>` so it never flashes; remembered in this browser). The home page's address follows it, `venn.day` or `venn.day/classic`, so a copied link opens the site in that look for whoever gets it, with that look's preview. (Older `?retro=1` and `?retro=0` links still work.) It sets `html.retro`, and every retro rule in `site.css` sits under it. The app and poll pages never change.

**Retro polls.** An organizer can give one poll the **Retro look** (a switch when creating it, and on top of the poll for the organizer, which takes at once). Picking it shows the look on the create page at once. It starts on for a new poll, like the site, and off for someone who chose the site's Classic mode; editing or copying a poll keeps its own. Its page then opens in the same night-sky look for everyone (`public/retro-app.css`, under `html.retro`; it comes with every app page, and the look is set before the first paint, by `app-look.js` for a new poll and by the server for a poll's page, so neither ever flashes the other look), with an arcade toast, the retro Finn stickers and a retro "Your Venn is ready!", and its emails come re-coloured in neon (`retroEmail` in `src/notify.js`). The answers keep their meaning: available is green, if needed amber, unavailable pink.

**Direction: retrofuturist.** A synthwave night: deep-space purple with stars and faint scanlines, chrome headlines with a sunset gradient on the words that matter, neon cyan and magenta, and arcade pixel type for small labels. The hero sets a striped sun on a moving neon grid, and the Venn's circles are glowing rings that light up where they cross. Bold and playful, but the words stay easy to read. One look, day or night (`color-scheme: dark`).

### Color

Every color is a CSS variable in `site.css`. Pages use the names, never raw values. (The old names are kept so the rules didn't all change: `--green` is now neon cyan.)

| Token                     | Value                 | Role                                                                    |
| ------------------------- | --------------------- | ----------------------------------------------------------------------- |
| `--paper`                 | `#0d0221`             | Page background (a night-sky gradient with stars sits over it)          |
| `--paper-2`               | `#1a0b3d`             | Quiet panels                                                            |
| `--line`                  | `#3a2170`             | Borders and dividers                                                    |
| `--ink`                   | `#f5f0ff`             | Text                                                                    |
| `--ink-2`                 | `#c9bfec`             | Secondary text                                                          |
| `--green`                 | `#2de2e6`             | Neon cyan: links, the main button (with `--green-ink`, `#0d0221`, text) |
| `--green-mid`             | `#ff3cac`             | Neon magenta: glows, the grid, the ✓                                    |
| `--cta-from` / `--cta-to` | `#c2166f` → `#5b21b6` | The big call-to-action gradient, white text                             |
| `--card`                  | `#150a35`             | Cards: dark glass with a cyan edge and a magenta glow                   |
| `--sunset`                | yellow → magenta      | Emphasis in headlines, the hero's sun                                   |
| `--chrome`                | silver bands          | Headline text                                                           |

Contrast: body text ≥ 12:1, secondary ≥ 9:1, dark ink on cyan ≥ 12:1, white on the call-to-action gradient ≥ 4.5:1.

### Typography

- **Display:** Orbitron 700 and 900, uppercase, self-hosted in `public/fonts/` (SIL OFL). Headlines, the brand, buttons, the Venn's names.
- **Pixel:** Press Start 2P (SIL OFL) for small labels: eyebrows, "Free. No sign-up. No ads.", the chat header, the ✓, the hero's flying messages.
- **Text:** the system sans stack. Fast and native.

| Name    | Size                             | Line height | Use                          |
| ------- | -------------------------------- | ----------- | ---------------------------- |
| hero    | `clamp(2.05rem, 7.4vw, 4.75rem)` | 1.04        | Hero headline (Orbitron 900) |
| h2      | `clamp(1.75rem, 4.6vw, 3.25rem)` | 1.08        | Section headlines            |
| page h1 | `clamp(1.9rem, 7vw, 3.75rem)`    | 1.08        | Privacy, 404, templates      |
| lede    | `clamp(1.125rem, 2vw, 1.3rem)`   | 1.5         | Intro paragraphs             |
| body    | `1.0625rem`                      | 1.6         | Text                         |
| label   | `0.625rem` pixel                 | 1.8         | Eyebrows and small labels    |

Headlines are chrome; the sunset gradient (with a soft glow) is the only emphasis inside them.

- **Finn's stickers on the website** (`img/stickers/retro/`, `npm run stickers`): Finn (smooth, never pixelated) on neon circles, an arcade caption on a magenta tag, and a glowing cyan edge. The poll page keeps the plain stickers.
- **Website logo** (`logo-retro.svg`): the same three circles as neon rings in cyan, magenta and yellow, with a sunset where all three meet. It's the website's header mark and tab icon; the app keeps the green logo below.
