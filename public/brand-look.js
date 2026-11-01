// An organization's own look (brand templates, /brand): its accent colour and font on the create page
// and on polls made from it. The accent is nudged until it meets WCAG AA on Venn's own backgrounds in
// light and dark mode, so any colour an organization picks stays readable. Picks keep the key's
// colours (green, amber, pink): only Venn's accent changes.

/** The fonts an organization can choose: system fonts only, so nothing more is downloaded. */
export const FONTS = {
  sans: ['Sans', "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"],
  serif: ['Serif', "'Iowan Old Style', 'Palatino Linotype', Georgia, serif"],
  rounded: ['Rounded', "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', system-ui, sans-serif"],
  mono: ['Mono', "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"],
};

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

/**
 * The accent for each mode: the colour, mixed toward black (light) or white (dark) just enough to
 * read at 4.5:1 on every background; the ink on it (white or near-black, whichever reads better);
 * and a soft tint of it for highlights.
 */
export function palette(hex) {
  const out = {};
  for (const [mode, backs] of Object.entries(BACKS)) {
    const toward = mode === 'light' ? '#000000' : '#ffffff';
    let accent = hex.toLowerCase();
    for (let t = 0.05; t <= 1 && backs.some((b) => contrast(accent, b) < 4.5); t += 0.05) accent = mix(hex, toward, t);
    const ink = contrast(accent, '#ffffff') >= contrast(accent, '#111111') ? '#ffffff' : '#111111';
    out[mode] = { accent, ink, soft: mix(backs[0], accent, mode === 'light' ? 0.14 : 0.24) };
  }
  return out;
}

// The organization's bar (brandBar), styled here so pages without a brand never download it.
const BAR =
  '.brand-bar{display:flex;align-items:center;gap:10px;margin:0 0 16px;font-weight:700;font-size:1.05rem}' +
  '.brand-bar img{height:40px;width:auto;max-width:160px;object-fit:contain}';

/**
 * The CSS that gives the page (or, with `scope`, one element: the preview on /brand) the brand's
 * look: only colours made here and fonts from FONTS. The retro look is dark, so it takes the dark ones.
 */
export function brandCss(brand, scope = ':root') {
  const p = isHex(brand.accent) ? palette(brand.accent) : null;
  const vars = (m) => `--accent:${m.accent};--accent-ink:${m.ink};--accent-soft:${m.soft};`;
  const font = Object.hasOwn(FONTS, brand.font ?? '') && FONTS[brand.font][1];
  return (
    BAR +
    `${scope}{${font ? `--display:${font};--serif:${font};` : ''}${p ? vars(p.light) : ''}}` +
    (p ? `@media (prefers-color-scheme: dark){${scope}{${vars(p.dark)}}}html.retro ${scope}{${vars(p.dark)}}` : '')
  );
}

/** Show a brand's look on one element only (the preview on /brand), leaving the page's own. */
export function brandPreview(brand, scope) {
  let el = document.getElementById('brand-preview-look');
  if (!el) document.head.append((el = Object.assign(document.createElement('style'), { id: 'brand-preview-look' })));
  el.textContent = brandCss(brand, scope);
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
export const brandBar = (brand, esc) =>
  `<p class="brand-bar">${brand.logo ? `<img src="${esc(brand.logo)}" alt="">` : ''}<span>${esc(brand.name)}</span></p>`;

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
