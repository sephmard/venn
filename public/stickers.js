// Finn's stickers, one at a time: the site and the poll page show them turning over every few
// seconds on their own, with nothing to press. Still when motion is reduced, and paused while the
// page is hidden. The pictures are drawn by finn-stickers.js (`npm run stickers`).

// The stickers in finn-moments.js, by key (test/finn.test.js checks they match). Listed here so the
// site's pages don't load the poll page's code to show them.
export const STICKER_KEYS = ['its-set', 'see-you-there', 'im-in', 'finn-approves', 'plans-over-excuses', 'cant-wait'];

const EVERY = 3200;
const src = (key) => `/img/stickers/finn-${key}.webp`;

/** The stickers stacked in one square of `size` px, the first showing. Decorative: put it in aria-hidden. */
export const stickerStack = (size) =>
  `<span class="stickers" data-stickers style="--s:${size}px">${STICKER_KEYS.map(
    (k, i) => `<img src="${src(k)}" width="${size}" height="${size}" alt=""${i ? ' loading="lazy"' : ' class="on"'} />`,
  ).join('')}</span>`;

/** Turn over the stickers in `box` every few seconds, until it leaves the page. */
export function rotate(box) {
  if (!box || box.dataset.turning || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  box.dataset.turning = '1';
  const imgs = [...box.querySelectorAll('img')];
  let i = Math.max(
    0,
    imgs.findIndex((im) => im.classList.contains('on')),
  );
  const timer = setInterval(() => {
    if (!box.isConnected) {
      clearInterval(timer);
      delete box.dataset.turning;
      return;
    }
    if (document.hidden) return;
    imgs[i].classList.remove('on');
    i = (i + 1) % imgs.length;
    imgs[i].classList.add('on');
  }, EVERY);
}

// The site's pages: every box of stickers already there.
if (typeof document !== 'undefined') for (const box of document.querySelectorAll('[data-stickers]')) rotate(box);
