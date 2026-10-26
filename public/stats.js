// The usage stats page: what src/usage.js counted, and what happened to the polls made. Only for
// whoever runs this server: it needs the STATS_TOKEN, kept in this browser once entered.

import { $, api, app, esc } from './ui.js';

const KEY = 'venn:stats-token';
const token = {
  get: () => localStorage.getItem(KEY) || '',
  set: (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY)),
};
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const sum = (rows) => rows.reduce((a, r) => a + r.count, 0);

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
    load(30);
  };
  $('#token').focus();
}

/** A table that scrolls sideways on narrow screens, so it can be focused and scrolled with keys. */
const scroller = (label, table) =>
  `<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(label)}"><table>${table}</table></div>`;

/** Rows of { label, n } as a table with bars, biggest first. */
function breakdown(title, rows, { total, sort = true } = {}) {
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
  return `<section class="sheet"><h2>${esc(title)}</h2>${scroller(title, body)}</section>`;
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

function render({ days, since, counts, outcomes }) {
  const of = (name, match = {}) =>
    sum(counts.filter((c) => c.name === name && Object.entries(match).every(([k, v]) => c.props[k] === v)));
  const created = of('poll.created');
  const all = outcomes.all || { polls: 0, answered: 0, finalized: 0, medianGuests: 0 };
  const views = (page) => of('view', { page });
  const dates = [...new Set(counts.map((c) => c.day))].sort();

  app.innerHTML = `
    <h1>Usage</h1>
    <div class="stats-bar">
      <p class="muted">Since ${esc(since)}. Anonymous counts: no people, polls or IP addresses.</p>
      <div class="seg" role="radiogroup" aria-label="Period">
        ${[7, 30, 90]
          .map((d) => `<button type="button" role="radio" data-days="${d}" aria-checked="${d === days}">${d} days</button>`)
          .join('')}
      </div>
    </div>
    <div class="tiles">
      <div class="tile"><b>${created}</b><span>polls created</span></div>
      <div class="tile"><b>${of('answer.created')}</b><span>answers from guests</span></div>
      <div class="tile"><b>${pct(all.answered, all.polls)}</b><span>of polls got a guest's answer</span></div>
      <div class="tile"><b>${pct(all.finalized, all.polls)}</b><span>of polls picked a date</span></div>
      <div class="tile"><b>${all.medianGuests}</b><span>guests per poll (median)</span></div>
    </div>
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
        { label: 'Opened "New poll"', n: views('chooser') },
        { label: 'Opened "Vote on a few dates"', n: views('pick') },
        { label: '… and created one', n: of('poll.created', { kind: 'pick' }) },
        { label: 'Opened "Ask when people are available"', n: views('free') },
        { label: '… and created one', n: of('poll.created', { kind: 'free' }) },
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
      { label: 'From "Poll created!"', n: of('share', { from: 'created' }) },
      { label: 'From the poll page', n: of('share', { from: 'poll' }) },
    ])}
    ${breakdown('AI', by(counts, 'ai.used', 'feature'))}
    ${breakdown(
      'Polls created per day',
      dates.map((d) => ({ label: d, n: sum(counts.filter((c) => c.day === d && c.name === 'poll.created')) })),
      { sort: false },
    )}
    <p><button type="button" class="link-btn" id="logout">Forget the token on this device</button></p>`;
}

async function load(days) {
  if (!token.get()) return login();
  app.innerHTML = '<p class="muted">Loading…</p>';
  try {
    render(await api(`stats?days=${days}`, { headers: { authorization: `Bearer ${token.get()}` } }));
  } catch (e) {
    if (e.status === 403) token.set('');
    login(e.message);
  }
}

app.addEventListener('click', (e) => {
  const d = e.target.closest('[data-days]');
  if (d) load(+d.dataset.days);
  if (e.target.closest('#logout')) {
    token.set('');
    login();
  }
});

load(30);
