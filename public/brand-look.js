// An organization's own look (brand templates, /brand) on polls made from it: its colours (an
// accent, and if it likes its own background, cards and text), a font for headings and one for
// everything else, and its corners. Every colour is nudged until it meets WCAG AA against the ones
// it sits on, so any palette an organization picks stays readable. Picks keep the key's colours
// (green, amber, pink).

/** The fonts an organization can choose: system fonts only, so nothing more is downloaded. */
export const FONTS = {
  sans: ['Sans', "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"],
  serif: ['Serif', "'Iowan Old Style', 'Palatino Linotype', Georgia, serif"],
  rounded: ['Rounded', "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', system-ui, sans-serif"],
  mono: ['Mono', "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"],
  slab: ['Slab', "Rockwell, 'Roboto Slab', 'Bookman Old Style', 'DejaVu Serif', serif"],
  humanist: ['Humanist', "Optima, Candara, 'Gill Sans', 'Noto Sans', 'Trebuchet MS', sans-serif"],
  condensed: ['Condensed', "'Avenir Next Condensed', 'Arial Narrow', 'Roboto Condensed', 'Liberation Sans Narrow', sans-serif"],
  elegant: ['Elegant', "Didot, 'Bodoni 72', 'Bodoni MT', 'Noto Serif Display', Georgia, serif"],
};

/** Corners: [cards, big cards]. Soft is Venn's own. */
export const CORNERS = { square: ['Square', 4, 6], soft: ['Soft', 14, 20], round: ['Round', 22, 30] };

export const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) =>
  `#${c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** The WCAG contrast ratio of two colours. */
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));

// Venn's backgrounds (styles.css): the page and cards, in each mode.
const BACKS = { light: ['#faf8f4', '#ffffff', '#f2eee6'], dark: ['#0f1112', '#171a1c', '#1f2326'] };
// The key's colours (styles.css), for a light or a dark background.
const KEY = {
  light:
    '--yes:#0b7a5c;--yes-ink:#ffffff;--maybe:#e0a12e;--maybe-ink:#241a04;--no-bg:#55585c;--no-ink:#ffffff;--no:#b42318;--no-cell:#f0b2a6;--danger:#b42318;--heat:11, 122, 92;',
  dark: '--yes:#2fc497;--yes-ink:#06140f;--maybe:#e9b14a;--maybe-ink:#241a04;--no-bg:#c9c6bf;--no-ink:#0f1112;--no:#ff8577;--no-cell:#6a2e27;--danger:#ff8577;--heat:47, 196, 151;',
};

const isDark = (hex) => lum(hex) < 0.18;
/** `hex`, mixed toward black (on light backgrounds) or white (on dark) until it reads at `min`:1 on each of `backs`. */
function readable(hex, backs, min = 4.5) {
  const toward = isDark(backs[0]) ? '#ffffff' : '#000000';
  let c = hex.toLowerCase();
  for (let t = 0.05; t <= 1.001 && backs.some((b) => contrast(c, b) < min); t += 0.05) c = mix(hex, toward, t);
  return c;
}
/** The ink on a colour: white or near-black, whichever reads better. */
const inkOn = (hex) => (contrast(hex, '#ffffff') >= contrast(hex, '#111111') ? '#ffffff' : '#111111');

/**
 * The accent for each of Venn's modes: read at 4.5:1 on every background, the ink on it, and a soft
 * tint of it for highlights.
 */
export function palette(hex) {
  const out = {};
  for (const [mode, backs] of Object.entries(BACKS)) {
    const accent = readable(hex, backs);
    out[mode] = { accent, ink: inkOn(accent), soft: mix(backs[0], accent, mode === 'light' ? 0.14 : 0.24) };
  }
  return out;
}

/**
 * The organization's own page colours, the same in light and dark mode: its background, its cards
 * (or a shade of the background), its text (or black or white) and the rest made from them, every
 * one readable on what it sits on. Returns CSS custom properties.
 */
export function scheme({ bg, surface, text, accent }) {
  const dark = isDark(bg);
  // Text sits on both, so cards stay on the background's side (light or dark): a light card on a
  // dark page becomes a hint of it.
  let card = isHex(surface) ? surface.toLowerCase() : mix(bg, '#ffffff', dark ? 0.06 : 0.7);
  if (isDark(card) !== dark) card = mix(bg, card, 0.12);
  const card2 = mix(card, dark ? '#ffffff' : '#000000', 0.06);
  const backs = [bg, card, card2];
  const ink = readable(isHex(text) ? text : dark ? '#f1eee8' : '#16181a', backs);
  const muted = readable(mix(ink, bg, 0.35), backs);
  const acc = readable(isHex(accent) ? accent : dark ? '#2fc497' : '#0b7a5c', backs);
  return {
    vars:
      `--bg:${bg};--surface:${card};--surface-2:${card2};--border:${mix(bg, ink, 0.16)};--text:${ink};--muted:${muted};` +
      `--accent:${acc};--accent-ink:${inkOn(acc)};--accent-soft:${mix(card, acc, dark ? 0.24 : 0.14)};` +
      `--cell-empty:${mix(card, ink, 0.08)};--cell-line:${readable(mix(ink, bg, 0.5), [card], 3)};` +
      `--yes-soft:${mix(card, dark ? '#2fc497' : '#0b7a5c', 0.2)};--maybe-soft:${mix(card, '#e0a12e', 0.2)};--no-soft:${mix(card, dark ? '#ff8577' : '#b42318', 0.16)};` +
      `--final:${ink};--final-ink:${bg};` +
      KEY[dark ? 'dark' : 'light'] +
      `color-scheme:${dark ? 'dark' : 'light'};`,
    dark,
    card,
  };
}

// The organization's bar (brandBar), styled here so pages without a brand never download it.
const BAR =
  '.brand-bar{display:flex;align-items:center;gap:10px;margin:0 0 16px;font-weight:700;font-size:1.05rem}' +
  '.brand-bar img{height:var(--logo-h,40px);width:auto;max-width:calc(var(--logo-h,40px)*4);object-fit:contain}';

/** How big the logo shows over its polls: its height in pixels. */
export const LOGO_SIZES = { small: ['Small', 40], medium: ['Medium', 64], large: ['Large', 96] };
/** Buttons: Venn's pills, or the template's own corners. */
export const BUTTONS = { pill: 'Pills', corners: 'Match the corners' };

/**
 * The key's colours, when the template has its own (available, if needed, unavailable): each with
 * ink that reads on it, and a soft tint on the cards (`card`, in a light or dark look).
 */
function keyVars(b, card, dark) {
  const soft = (c) => mix(card, c, dark ? 0.26 : 0.18);
  let v = '';
  if (isHex(b.yes)) v += `--yes:${b.yes};--yes-ink:${inkOn(b.yes)};--yes-soft:${soft(b.yes)};--heat:${rgb(b.yes).join(', ')};`;
  if (isHex(b.maybe)) v += `--maybe:${b.maybe};--maybe-ink:${inkOn(b.maybe)};--maybe-soft:${soft(b.maybe)};`;
  if (isHex(b.no))
    v += `--no-cell:${b.no};--no-cell-ink:${inkOn(b.no)};--no-soft:${soft(b.no)};--no-bg:${b.no};--no-ink:${inkOn(b.no)};`;
  return v;
}

const fontVar = (k) => Object.hasOwn(FONTS, k ?? '') && FONTS[k][1];

/**
 * The CSS that gives the page (or, with `scope`, one element: the preview on /brand) the brand's
 * look: only colours made here, fonts from FONTS and corners from CORNERS. Without its own
 * background it follows Venn's light and dark (the retro look is dark, so it takes the dark ones).
 */
export function brandCss(brand, scope = ':root') {
  const head = fontVar(brand.font);
  const body = fontVar(brand.bodyFont);
  const corners = Object.hasOwn(CORNERS, brand.corners ?? '') ? CORNERS[brand.corners] : CORNERS.soft;
  const logo = Object.hasOwn(LOGO_SIZES, brand.logoSize ?? '') && LOGO_SIZES[brand.logoSize][1];
  const base =
    (head ? `--serif:${head};` : '') +
    (body ? `--display:${body};` : '') +
    (brand.corners ? `--radius:${corners[1]}px;--radius-lg:${corners[2]}px;` : '') +
    (logo ? `--logo-h:${logo}px;` : '');
  // Buttons, pills and switches with the template's corners instead of Venn's round ends.
  const inside = scope === ':root' ? '' : `${scope} `;
  const buttons =
    brand.buttons === 'corners'
      ? `${[`.btn`, `.pill`, `.seg`, `.seg button`, `.tabs`, `.tabs [role=tab]`].map((x) => inside + x).join(',')}{border-radius:${corners[1]}px}`
      : '';
  if (isHex(brand.bg)) {
    const own = scheme(brand);
    return `${BAR}${buttons}${scope}{${base}${own.vars}${keyVars(brand, own.card, own.dark)}}`;
  }
  const p = isHex(brand.accent) ? palette(brand.accent) : null;
  const vars = (m) => (p ? `--accent:${m.accent};--accent-ink:${m.ink};--accent-soft:${m.soft};` : '');
  const dark = (p ? vars(p.dark) : '') + keyVars(brand, BACKS.dark[1], true);
  return (
    BAR +
    buttons +
    `${scope}{${base}${p ? vars(p.light) : ''}${keyVars(brand, BACKS.light[1], false)}}` +
    (dark ? `@media (prefers-color-scheme: dark){${scope}{${dark}}}html.retro ${scope}{${dark}}` : '')
  );
}

/** Show the brand's look on this page, or (with null) take it off. */
export function brandLook(brand) {
  document.getElementById('brand-look')?.remove();
  document.documentElement.classList.toggle('branded', !!brand);
  if (!brand) return;
  document.documentElement.classList.remove('retro'); // an organization's look replaces Venn's retro one
  document.head.append(Object.assign(document.createElement('style'), { id: 'brand-look', textContent: brandCss(brand) }));
}

/** The organization's bar: its logo and name, at the top of the create page and its polls. */
export const brandBar = (brand, esc) => {
  // With its name in the logo, the template can leave the name out; the logo then says it.
  const named = !(brand.hideName && brand.logo);
  return `<p class="brand-bar">${brand.logo ? `<img src="${esc(brand.logo)}" alt="${named ? '' : esc(brand.name)}">` : ''}${named ? `<span>${esc(brand.name)}</span>` : ''}</p>`;
};

/** On the create page: the bar, no retro switch (the poll gets the brand's look), and (`fill`, a new poll) what it starts with. */
export function brandForm(b, fill, $, esc) {
  // Only the poll is branded: the create page keeps Venn's look, and shows whose template it is.
  if (!document.getElementById('brand-bar-look'))
    document.head.append(Object.assign(document.createElement('style'), { id: 'brand-bar-look', textContent: BAR }));
  $('#create').insertAdjacentHTML('afterbegin', brandBar(b, esc));
  const retro = $('#p-retro');
  if (retro) [retro.checked, retro.closest('label').hidden] = [false, true];
  if (!fill) return;
  const title = $('#title');
  if (b.title) title.value = title.dataset.seed = b.title;
  if (b.where) $('#location').value = b.where;
  if (b.note) $('#desc').value = b.note;
  if (b.where || b.note) $('#more-box').open = true;
  if (b.emoji) $('#emoji-tile').textContent = b.emoji;
  title.dispatchEvent(new Event('input'));
}
