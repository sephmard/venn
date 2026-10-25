# Venn design system

The marketing pages (`public/index.html`, `privacy.html`, `404.html`, styled by `public/site.css`) follow this file. The app itself (`public/styles.css`) shares the same green and neutrals.

**Direction: warm editorial.** Warm paper, an elegant serif for big headlines, a plain sans for everything else, and one idea carried through: overlapping circles, like the logo. Calm and confident; never busy.

## Color

Every color is a CSS variable in `site.css`. Pages use the names, never raw values.

| Token           | Light     | Dark      | Role                                               |
| --------------- | --------- | --------- | -------------------------------------------------- |
| `--paper`       | `#faf8f4` | `#0f1112` | Page background                                    |
| `--paper-2`     | `#f2eee6` | `#171a1c` | Quiet panels, product-shot frame                   |
| `--line`        | `#e4dfd4` | `#2a2e31` | Borders and dividers                               |
| `--ink`         | `#16181a` | `#f1eee8` | Text and headings                                  |
| `--ink-2`       | `#55585c` | `#a6a9ad` | Secondary text (≥ 6:1 on paper)                    |
| `--green`       | `#0b7a5c` | `#2fc497` | Primary: buttons, links, the overlap               |
| `--green-ink`   | `#ffffff` | `#06140f` | Text on green                                      |
| `--green-soft`  | `#dcefe6` | `#163a2f` | Tints, step numbers                                |
| `--amber`       | `#e0a12e` | `#e9b14a` | Second circle in the hero (matches "If needed")    |
| `--blue`        | `#4a63d9` | `#7c95ff` | Third circle in the hero (matches the final pick)  |
| `--band`        | `#16181a` | `#171a1c` | The one dark band ("No accounts…")                 |
| `--band-ink`    | `#faf8f4` | `#f1eee8` | Text on the band (`--band-ink-2` for secondary)    |
| `--band-accent` | `#2fc497` | `#2fc497` | Green on the band (the band is dark in both modes) |

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
- **Nav bar:** sticky, `--paper` at 96% with a light blur and a `--line` bottom border. Logo left; How it works, Docs, Privacy, a bordered **GitHub** pill (mark + label) and the primary button right. Under 900px the text links move into a menu (a `<details>` panel, no script); under 640px the GitHub pill becomes a 44px icon button, but it is always visible.
- **Ink button:** like the primary button, in `--ink` with `--paper` text. Used once, for **View on GitHub** in the open-source section.
- **Code card:** `--band` background, 20px radius, monospace at 15px (13px on phones, wrapping), `$` prompts in `--band-accent`.
- **Footer:** one row of small links on `--line` top border.
- **Focus:** every interactive element shows the green ring with `:focus-visible`.

## Imagery and motion

- The hero is the Venn diagram itself, drawn in SVG: three translucent circles (green, amber, blue) whose shared center fills solid green and carries the agreed time.
- **Icon** (`favicon.svg`, `icons/icon.svg` and its PNGs from `npm run icons`): a solid `--green` tile with two white circle outlines and a white overlap, built to read at 16 px on light and dark tabs. The app icon is full-bleed, with the rings inside the maskable safe zone.
- The GitHub mark (Octicons, official) appears only on links to the repository.
- One real product screenshot (light and dark versions), framed on `--paper-2` and faded at the bottom.
- No icons, emoji, stock photos or gradients on text.
- Motion: the circles drift a few pixels on a slow loop. Everything stays still under `prefers-reduced-motion`.
