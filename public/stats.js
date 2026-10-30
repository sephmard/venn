// The usage stats page: what src/usage.js counted, and what happened to the polls made. Only for
// whoever runs this server: it needs the STATS_TOKEN, kept in this browser once entered.

import { $, api, app, dateParts, esc, fmtDay, fmtDowLong, fmtMonthDay } from './ui.js';
import { METRICS, change, dayList, series, total, weekdays, weeks } from './stats-data.js';

const KEY = 'venn:stats-token';
const token = {
  get: () => localStorage.getItem(KEY) || '',
  set: (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY)),
};
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const sum = (rows) => rows.reduce((a, r) => a + r.count, 0);
const PERIODS = [7, 30, 90, 365];
const REFRESH_MS = 5 * 60_000;

// What's on screen: the period, the metric the trend charts show, and the last stats loaded.
const view = { days: 30, metric: 'polls', data: null, loadedAt: 0 };

// Friendlier names for kinds of poll.
const KINDS = {
  all: 'All polls',
  pick: 'Vote on dates',
  'pick/times': '… with times',
  'pick/allday': '… all day',
  'pick/trips': '… trips',
  free: 'When people are available',
  'free/days': '… whole days',
  'free/parts': '… parts of the day',
  'free/hours': '… hours',
};

function login(message = '') {
  app.innerHTML = `
    <h1>Usage</h1>
    <form id="login" class="sheet">
      <label for="token">Stats token</label>
      <input id="token" type="password" autocomplete="current-password" required>
      <p class="hint">The <code>STATS_TOKEN</code> set on this server. It's kept in this browser only.</p>
      <p class="error" role="alert">${esc(message)}</p>
      <button class="btn btn-primary" type="submit">Show stats</button>
    </form>`;
  $('#login').onsubmit = (e) => {
    e.preventDefault();
    token.set($('#token').value.trim());
    load(view.days);
  };
  $('#token').focus();
}

/** A table that scrolls sideways on narrow screens, so it can be focused and scrolled with keys. */
const scroller = (label, table) =>
  `<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(label)}"><table>${table}</table></div>`;

/** Rows of { label, n } as a table with bars, biggest first. */
/** Names for where people came from (?from=); the website's pages are named by their address. */
const FROM_LABELS = new Proxy(
  { guest: 'A guest making their own', set: 'After a date was picked', email: 'An “It’s happening” email' },
  { get: (o, k) => o[k] || (k === '(none)' ? k : `The ${k} page`) },
);

function breakdown(title, rows, { total, sort = true, hint = '' } = {}) {
  const list = sort ? [...rows].sort((a, b) => b.n - a.n) : rows;
  const max = Math.max(1, ...list.map((r) => r.n));
  const body = list.length
    ? list
        .map(
          (r) =>
            `<tr><td>${esc(r.label)}</td><td class="n">${r.n}${total ? ` <span class="muted">(${pct(r.n, total)})</span>` : ''}</td><td style="width:40%"><span class="bar" style="width:${(100 * r.n) / max}%"></span></td></tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="muted">Nothing yet</td></tr>';
  return `<section class="sheet"><h2>${esc(title)}</h2>${hint ? `<p class="hint">${esc(hint)}</p>` : ''}${scroller(title, body)}</section>`;
}

/** Counts of `name` split by one property: [{ label, n }]. */
function by(counts, name, prop, labels = {}) {
  const m = new Map();
  for (const c of counts.filter((x) => x.name === name)) {
    const k = c.props[prop] ?? '(none)';
    m.set(k, (m.get(k) || 0) + c.count);
  }
  return [...m].map(([k, n]) => ({ label: labels[k] || k, n }));
}

const updatedAt = () => `Updated at ${new Date(view.loadedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

/** "↑ 12% on the 30 days before", or nothing when there's no earlier period to compare with. */
function vsBefore(now, before, days) {
  if (before == null) return '';
  const c = change(now, before);
  const text = c == null ? 'nothing the period before' : c === 0 ? 'same as before' : `${c > 0 ? '↑' : '↓'} ${Math.abs(c)}%`;
  return `<small class="delta">${text}<span class="sr-only"> compared with the ${days} days before</span></small>`;
}

/**
 * A column chart of [{ day, end?, n }], one column per day (or week). Hovering or tapping a column
 * shows its number; the same numbers are in the table below it, for screen readers and keys.
 */
function columns(title, rows, { weekly }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  const when = (r) => (weekly ? `Week of ${fmtMonthDay.format(dateParts(r.day))}` : fmtDay.format(dateParts(r.day)));
  const peak = rows.reduce((a, r) => (r.n > a.n ? r : a), rows[0]);
  const label = `${title}, ${weekly ? 'by week' : 'by day'}. Highest: ${peak.n}, ${when(peak)}.`;
  return `
    <div class="chart" role="img" aria-label="${esc(label)}">
      <span class="chart-max" aria-hidden="true">${max}</span>
      <div class="cols" style="--n:${rows.length}">
        ${rows
          .map(
            (r, i) =>
              `<span class="col" data-i="${i}" data-tip="${esc(`${when(r)}: ${r.n}`)}"><span style="height:${(100 * r.n) / max}%"></span></span>`,
          )
          .join('')}
      </div>
      <div class="chart-axis" aria-hidden="true"><span>${esc(fmtMonthDay.format(dateParts(rows[0].day)))}</span><span>${esc(fmtMonthDay.format(dateParts(rows.at(-1).end || rows.at(-1).day)))}</span></div>
      <div class="chart-tip" hidden></div>
    </div>
    <details>
      <summary>Show as a table</summary>
      ${scroller(
        title,
        `<tr><th>${weekly ? 'Week of' : 'Day'}</th><th class="n">${esc(title)}</th></tr>${rows
          .map((r) => `<tr><td>${esc(fmtDay.format(dateParts(r.day)))}</td><td class="n">${r.n}</td></tr>`)
          .join('')}`,
      )}
    </details>`;
}

function render({ days, since, counts, outcomes }, earlier) {
  const of = (name, match = {}) =>
    sum(counts.filter((c) => c.name === name && Object.entries(match).every(([k, v]) => c.props[k] === v)));
  const created = of('poll.created');
  const all = outcomes.all || { polls: 0, answered: 0, finalized: 0, medianGuests: 0 };
  const views = (page) => of('view', { page });
  const metric = METRICS[view.metric];
  const daily = series(counts, metric, dayList(since, days));
  const weekly = days > 90;
  // The same counts for the period just before, when it was loaded.
  const prev = (m) => (earlier ? total(earlier, m) : null);

  app.innerHTML = `
    <h1>Usage</h1>
    <div class="stats-bar">
      <p class="muted">Since ${esc(since)}. Anonymous counts: no people, polls or IP addresses.</p>
      <div class="seg" role="radiogroup" aria-label="Period">
        ${PERIODS.map(
          (d) => `<button type="button" role="radio" data-days="${d}" aria-checked="${d === days}">${d} days</button>`,
        ).join('')}
      </div>
    </div>
    <p class="muted updated"><span id="updated">${esc(updatedAt())}</span>. It updates every few minutes while this page is open. <button type="button" class="link-btn" id="refresh">Refresh now</button></p>
    <div class="tiles">
      <div class="tile"><b>${created}</b><span>polls created</span>${vsBefore(created, prev(METRICS.polls), days)}</div>
      <div class="tile"><b>${of('answer.created')}</b><span>answers from guests</span>${vsBefore(of('answer.created'), prev(METRICS.answers), days)}</div>
      <div class="tile"><b>${pct(all.answered, all.polls)}</b><span>of polls got a guest's answer</span></div>
      <div class="tile"><b>${pct(all.finalized, all.polls)}</b><span>of polls picked a date</span></div>
      <div class="tile"><b>${all.medianGuests}</b><span>guests per poll (median)</span></div>
    </div>
    <section class="sheet trend">
      <div class="trend-head">
        <h2>Trend</h2>
        <div class="seg" role="radiogroup" aria-label="Show">
          ${Object.entries(METRICS)
            .map(
              ([k, m]) =>
                `<button type="button" role="radio" data-metric="${k}" aria-checked="${k === view.metric}">${esc(m.label)}</button>`,
            )
            .join('')}
        </div>
      </div>
      <p class="hint"><b class="trend-total">${total(counts, metric)}</b> ${esc(metric.label.toLowerCase())} in ${days} days ${vsBefore(total(counts, metric), prev(metric), days)}</p>
      ${columns(metric.label, weekly ? weeks(daily) : daily, { weekly })}
    </section>
    ${breakdown(
      `${metric.label} by day of the week`,
      weekdays(daily).map(({ dow, n }) => ({ label: fmtDowLong.format(new Date(Date.UTC(2024, 0, 1 + dow))), n })),
      { sort: false, hint: 'Days are counted in UTC.' },
    )}
    <section class="sheet">
      <h2>What happens to polls</h2>
      <p class="hint">Polls created in this period, and how they're doing now.</p>
      ${scroller(
        'What happens to polls',
        `        <tr><th>Kind</th><th class="n">Polls</th><th class="n">Organizer answered</th><th class="n">Got answers</th><th class="n">Date picked</th><th class="n">Median guests</th></tr>
        ${Object.keys(KINDS)
          .filter((k) => outcomes[k])
          .map((k) => {
            const o = outcomes[k];
            return `<tr><td>${esc(KINDS[k])}</td><td class="n">${o.polls}</td><td class="n">${pct(o.hostAnswered, o.polls)}</td><td class="n">${pct(o.answered, o.polls)}</td><td class="n">${pct(o.finalized, o.polls)}</td><td class="n">${o.medianGuests}</td></tr>`;
          })
          .join('')}
        `,
      )}
    </section>
    ${breakdown(
      'From visit to poll',
      [
        { label: 'Opened "Create a Venn"', n: views('free') },
        { label: '… and created one', n: of('poll.created', { kind: 'free' }) },
        { label: 'Opened the older "Vote on a few dates"', n: views('pick') },
        { label: '… and created one', n: of('poll.created', { kind: 'pick' }) },
      ],
      { sort: false },
    )}
    ${breakdown(
      'Who opens polls',
      by(counts, 'view', 'as', {
        guest: 'Guests, not answered yet',
        answered: 'Guests who answered',
        organizer: 'Organizers',
      }).filter((r) => r.label !== '(none)'),
    )}
    ${breakdown(
      'Where new polls come from',
      by(counts, 'poll.created', 'from', FROM_LABELS).filter((r) => r.label !== '(none)'),
      {
        total: created,
        hint: 'Polls whose organizer came from a guest’s “make yours” link, a picked date, or a page on the website.',
      },
    )}
    ${breakdown(
      'Visits from the website’s pages',
      by(counts, 'view', 'from', FROM_LABELS).filter((r) => r.label !== '(none)'),
      { hint: 'People who opened a create page from a link with a from=, by where it was.' },
    )}
    ${breakdown('Kinds of poll created', by(counts, 'poll.created', 'detail'), { total: created })}
    ${breakdown('Plans', by(counts, 'poll.created', 'plan'), { total: created })}
    ${breakdown('Options (or days) per poll', by(counts, 'poll.created', 'options'), { total: created })}
    ${breakdown(
      'Organizer choices',
      [
        { label: 'Gave an email for notifications', n: of('poll.created', { email: 'yes' }) },
        { label: 'Started from another poll', n: of('poll.created', { copy: 'yes' }) },
        { label: 'Edited a poll', n: of('poll.edited') },
        { label: 'Added a webhook', n: of('notify.webhook') },
        { label: 'Turned on phone notifications', n: of('notify.push') },
        { label: 'Deleted a poll', n: of('poll.deleted') },
      ],
      { total: created, sort: false },
    )}
    ${breakdown(
      'Guests',
      [
        { label: 'Answered', n: of('answer.created') },
        { label: '… and asked for an email copy', n: of('answer.created', { copy: 'yes' }) },
        { label: 'Changed their answer', n: of('answer.updated') },
        { label: 'Removed their answer', n: of('answer.deleted') },
        { label: 'Added the date to their calendar', n: of('calendar.ics') },
      ],
      { sort: false },
    )}
    ${breakdown('Sharing', [
      { label: 'From "Your Venn is ready!"', n: of('share', { from: 'created' }) },
      { label: 'From the poll page', n: of('share', { from: 'poll' }) },
      { label: 'As a picture of the date', n: of('share', { from: 'card' }) },
    ])}
    ${breakdown('AI', by(counts, 'ai.used', 'feature'))}
    <p><button type="button" class="link-btn" id="logout">Forget the token on this device</button></p>`;
}

const get = (days) => api(`stats?days=${days}`, { headers: { authorization: `Bearer ${token.get()}` } });

/**
 * Load the stats for `days`, and the period before it to compare with (when that fits in the 365
 * days the server keeps a report for). `quiet` is the refresh in the background: no "Loading…",
 * no redraw when nothing changed, and a failure leaves what's shown.
 */
async function load(days, { quiet = false } = {}) {
  if (!token.get()) return login();
  view.days = days;
  if (!quiet) app.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const [data, both] = await Promise.all([get(days), days * 2 <= 365 ? get(days * 2) : null]);
    if (days !== view.days) return; // another period was picked meanwhile
    const earlier = both && both.counts.filter((c) => c.day < data.since);
    const same = quiet && JSON.stringify([data, earlier]) === JSON.stringify(view.data);
    view.data = [data, earlier];
    view.loadedAt = Date.now();
    if (same) $('#updated').textContent = updatedAt();
    else redraw();
  } catch (e) {
    if (quiet && e.status !== 403) return;
    if (e.status === 403) token.set('');
    view.data = null;
    login(e.message);
  }
}

/** Draw what's loaded, keeping focus on the control that had it (redraws replace the page). */
function redraw() {
  const focused = document.activeElement?.closest('[data-days], [data-metric], #refresh');
  const key =
    focused &&
    (focused.dataset.days
      ? `[data-days="${focused.dataset.days}"]`
      : focused.dataset.metric
        ? `[data-metric="${focused.dataset.metric}"]`
        : '#refresh');
  render(...view.data);
  if (key) $(key)?.focus();
}

app.addEventListener('click', (e) => {
  const d = e.target.closest('[data-days]');
  if (d) load(+d.dataset.days);
  const m = e.target.closest('[data-metric]');
  if (m && view.data) {
    view.metric = m.dataset.metric;
    redraw();
  }
  if (e.target.closest('#refresh')) load(view.days, { quiet: true });
  if (e.target.closest('#logout')) {
    token.set('');
    view.data = null;
    login();
  }
});

// Hovering or tapping a column shows its number above it.
function tip(e) {
  const col = e.target.closest?.('.col');
  const chart = e.target.closest?.('.chart');
  for (const t of document.querySelectorAll('.chart-tip')) if (!chart || !chart.contains(t)) t.hidden = true;
  if (!chart) return;
  const box = $('.chart-tip', chart);
  if (!col) return (box.hidden = true);
  box.textContent = col.dataset.tip;
  box.hidden = false;
  const c = chart.getBoundingClientRect();
  const r = col.getBoundingClientRect();
  const x = r.left + r.width / 2 - c.left;
  box.style.left = `${Math.min(Math.max(x, box.offsetWidth / 2), c.width - box.offsetWidth / 2)}px`;
}
app.addEventListener('pointermove', tip);
app.addEventListener('pointerdown', tip);
app.addEventListener('pointerleave', () => document.querySelectorAll('.chart-tip').forEach((t) => (t.hidden = true)));

// Keep it current: refresh every few minutes while the page is showing, and on coming back to it.
const refresh = () => view.data && document.visibilityState === 'visible' && load(view.days, { quiet: true });
setInterval(refresh, REFRESH_MS);
document.addEventListener('visibilitychange', () => Date.now() - view.loadedAt > 60_000 && refresh());

load(view.days);
