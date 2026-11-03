/**
 * ‹ › for the row of templates or starters on the create forms, loaded only with a mouse (wirePlan()
 * in create.js): 36px to see and 44px to hit, over the row's ends, the row fading under them.
 */
const CSS = `.row-wrap {
  position: relative;
}
.row-wrap.scrolled .occasions {
  mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent);
}
.row-arrow {
  display: grid;
  place-items: center;
  position: absolute;
  top: 50%;
  translate: 0 -50%;
  width: 44px;
  height: 44px;
  padding: 0 0 3px;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 1.3rem;
  line-height: 1;
  cursor: pointer;
  isolation: isolate;
}
.row-arrow::before {
  content: '';
  position: absolute;
  inset: 4px;
  z-index: -1;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  background: var(--surface);
}
.row-arrow:hover::before {
  background: var(--surface-2);
}
.row-arrow[data-dir='-1'] {
  left: -16px;
}
.row-arrow[data-dir='1'] {
  right: -16px;
}
.row-arrow[hidden] {
  display: none;
}
`;

/**
 * With a mouse, ‹ › at the ends of the row of templates (or starters), which a mouse can't swipe:
 * each scrolls a row's width less a card, and hides at its end or when everything fits. Out of the
 * tab order, as the cards are already reached by Tab.
 */
export function rowArrows(row) {
  if (!document.getElementById('row-arrows-css'))
    document.head.append(Object.assign(document.createElement('style'), { id: 'row-arrows-css', textContent: CSS }));
  const what = row.getAttribute('aria-label').toLowerCase();
  const wrap = Object.assign(document.createElement('div'), { className: 'row-wrap' });
  row.before(wrap);
  wrap.append(row);
  wrap.insertAdjacentHTML(
    'beforeend',
    [-1, 1]
      .map(
        (d) =>
          `<button type="button" class="row-arrow" data-dir="${d}" tabindex="-1" aria-label="${d < 0 ? 'Earlier' : 'More'} ${what}" hidden>${d < 0 ? '‹' : '›'}</button>`,
      )
      .join(''),
  );
  const [back, on] = wrap.querySelectorAll('.row-arrow');
  const sync = () => {
    back.hidden = row.scrollLeft < 4;
    on.hidden = row.scrollLeft + row.clientWidth > row.scrollWidth - 4;
    wrap.classList.toggle('scrolled', !back.hidden);
  };
  row.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(row);
  new MutationObserver(sync).observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.row-arrow');
    if (!b) return;
    const card = row.querySelector('.tpl:not([hidden])')?.offsetWidth || 0;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    row.scrollBy({ left: b.dataset.dir * (row.clientWidth - card - 8), behavior: still ? 'instant' : 'smooth' });
  });
}
