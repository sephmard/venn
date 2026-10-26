// The organizer's ways around the "vote on a few dates" calendar. create.js loads it after the page
// shows, so guests never download it and the create page's first load stays small:
//   the day strip runs through the months ahead, scrolling sideways, with the day shown kept in view
//   « » skip 30 days (‹ › still go a week)
//   the date heading opens a month (a popover: Escape or a tap elsewhere closes it) to jump to any day

import { addDays } from './core.js';
import { dayWindow } from './day-window.js';
import { monthView } from './picker.js';
import { $, $$, todayStr } from './ui.js';

const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
const skip = (n, t) =>
  `<button type="button" class="icon-btn" data-skip="${n}" aria-label="${n < 0 ? 'Back' : 'Forward'} 30 days">${t}</button>`;

/**
 * Adds to a timeView (`view`) in `root`. Pass `strip` as timeView's strip option and call `update`
 * from its onRender; `marks(date)` notes the days with options.
 */
export function dayNav(root, view, marks) {
  let shown = [];
  const from = () => shown.find((d) => d >= todayStr()) || todayStr();
  const nav = $('.tv-nav', root);
  const label = $('.tv-label', nav);
  nav.insertAdjacentHTML('afterbegin', skip(-30, '«'));
  nav.insertAdjacentHTML('beforeend', skip(30, '»'));
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-skip]');
    if (b) view.show(addDays(from(), +b.dataset.skip)); // never before today
  });

  label.insertAdjacentHTML(
    'beforebegin',
    '<button type="button" class="pill tv-pick" popovertarget="jump"><span class="sr-only">, jump to a day</span></button><div class="tv-jump" id="jump" popover></div>',
  );
  const box = label.previousElementSibling;
  box.previousElementSibling.prepend(label); // picker.js keeps the date in it
  const cal = monthView(box, {
    onDay: (d) => (box.hidePopover(), view.show(d)),
    active: () => shown.length === 1 && shown[0],
    marks,
  });
  box.ontoggle = (e) => {
    if (e.newState !== 'open') return;
    cal.show(from());
    ($('[aria-current]', box) || $('.cal-day:not(:disabled)', box)).focus();
  };

  return {
    strip: (d) => dayWindow(todayStr(), d),
    /** After each render: « is off with ‹, months are named on the strip, and the day shown is in view. */
    update(ds) {
      shown = ds;
      nav.firstElementChild.disabled = $('[data-step="-1"]', nav).disabled;
      const strip = $('.tv-strip', root);
      for (const s of $$('[data-day$="-01"] small', strip)) {
        s.textContent = fmtMonth.format(new Date(`${s.parentNode.dataset.day}T12:00Z`)); // "Dec 1"
        s.setAttribute('aria-hidden', 'true'); // the month is read out after the number already
      }
      const c = $('[aria-pressed="true"]', strip);
      if (c) strip.scrollLeft = c.offsetLeft - (strip.clientWidth - c.offsetWidth) / 2;
    },
    cleanup: cal.cleanup,
  };
}
