// The chooser (/new): which kind of poll. Its own module, so the create pages don't carry it; it
// loads create.js (and so the create pages' styles, and the next step ahead of time) with it.

import { fromUrl } from './create.js';
import { app, esc, track } from './ui.js';

export function renderChooser() {
  document.title = 'New poll · Venn';
  // Where they came from, passed on to the form.
  const from = fromUrl();
  track('view', { page: 'chooser', ...(from && { from }) });
  // A title or template from the landing page or a template page goes on to the form.
  const q = new URLSearchParams([...new URLSearchParams(location.search)].filter(([k]) => /^(title|template|from)$/.test(k)));
  const carry = q.size ? `?${q}` : '';
  app.innerHTML = `
    <section class="chooser">
      <h1>What kind of poll?</h1>
      <p class="lede">Two ways to find a date. Pick the one that fits your plans.</p>
      <div class="choices">
        <a class="choice" href="/new/pick${esc(carry)}" data-link>
          <span class="choice-art art-pick" aria-hidden="true"><i>Fri</i><i class="on">Sat</i><i>Sun</i></span>
          <span class="choice-title">Vote on a few dates</span>
          <span class="choice-text">You suggest some dates or times. Everyone says yes, if needed or no to each one.</span>
          <span class="choice-fit">Good for dinners, book clubs and parties</span>
        </a>
        <a class="choice" href="/new/free${esc(carry)}" data-link>
          <span class="choice-art art-free" aria-hidden="true"><i></i><i></i></span>
          <span class="choice-title">Ask when people are available</span>
          <span class="choice-text">You pick a range of days. Everyone marks when they're available, and Venn finds the overlap.</span>
          <span class="choice-fit">Good for trips, or when any day could work</span>
        </a>
      </div>
    </section>`;
}
