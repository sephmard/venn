// The poll page. Phones get two tabs, "Your answer" and "The group"; wide screens show both.
// Option polls and whole-day polls are answered as a list (yes / if needed / no per row);
// hours polls are painted on a grid.

import {
  YES,
  IF_NEEDED,
  DAY_PARTS,
  addDays,
  allDaySpan,
  eventWindows,
  googleCalendarUrl,
  isDaysPoll,
  isOptionsPoll,
  isPartsPoll,
  meetingEnd,
  outlookCalendarUrl,
  partOf,
  rankTimes,
  slotEnd,
  utcToZoned,
} from './core.js';
import { dayChip, isPhone, timeView } from './picker.js';
import {
  $,
  $$,
  api,
  app,
  avatar,
  avatarStack,
  copy,
  dateParts,
  esc,
  fmtDay,
  fmtDow,
  fmtDowLong,
  fmtMonthDay,
  fmtTimeRange,
  fmtWhen,
  forget,
  getConfig,
  lastEmail,
  lastName,
  lengthLabel,
  localTz,
  minutesLabel,
  plural,
  reducedMotion,
  rememberEmail,
  rememberName,
  save,
  saved,
  shortRange,
  shortTime,
  toast,
  tzName,
  tzOptions,
} from './ui.js';

const VOTES = [
  [YES, 'v-yes', 'Yes', '✓'],
  [IF_NEEDED, 'v-maybe', 'If needed', '~'],
  [0, 'v-no', 'No', '✕'],
];

export async function renderEvent(id, navigate) {
  // Organizer and personal edit links carry their secret in the URL fragment,
  // which is never sent to the server. Move it to local storage and tidy the URL.
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('admin')) save(id, { adminToken: hash.get('admin') });
  if (hash.get('edit')) {
    const [participantId, editToken] = hash.get('edit').split('.');
    if (participantId && editToken) save(id, { participantId, editToken });
  }
  // Links in notification emails: stop the emails.
  const unsubscribeToken = hash.get('unsubscribe');
  if (location.hash) history.replaceState(null, '', location.pathname);

  app.innerHTML = '<div class="empty muted">Loading…</div>';

  const st = {
    ev: null,
    tz: saved(id).tz || localTz,
    mine: {},
    brush: YES,
    dirty: false,
    focus: null, // participant id highlighted in the group view
    inspect: null, // slot being inspected in the group heatmap
    touched: new Set(), // rows this visitor explicitly answered (so "No" shows as chosen)
    tab: null,
    fresh: !!saved(id).justCreated, // the organizer just created this poll
    orgOpen: null, // organizer tools open? Starts open for a fresh poll.
  };
  // The edit token also gets your own answer back when the organizer hides everyone's answers.
  const authHeaders = ({ adminToken: a, editToken: e } = saved(id)) => ({
    ...(a && { 'x-admin-token': a }),
    ...(e && { 'x-edit-token': e }),
  });

  async function load() {
    st.ev = await api(`events/${id}`, { headers: authHeaders() });
    if (!st.ev.isAdmin && saved(id).adminToken) forget(id, 'adminToken');
    const mine = st.ev.participants.find((p) => p.id === saved(id).participantId);
    if (!mine && saved(id).participantId) forget(id, 'participantId', 'editToken');
    return mine;
  }

  try {
    const mine = await load();
    if (mine) st.mine = { ...mine.availability };
    // A saved answer with nothing marked means "none of these work".
    st.declined = !!mine && !Object.keys(mine.availability).length;
  } catch (e) {
    app.innerHTML = `<div class="sheet empty"><h1>Poll not found</h1><p class="muted">${esc(e.message)}</p><a class="btn btn-primary" href="/new" data-link>Start a new poll</a></div>`;
    return () => {};
  }

  const ev = () => st.ev;
  document.title = `${ev().title} · Venn`;
  const shareUrl = `${location.origin}/e/${id}`;
  const optionsMode = isOptionsPoll(ev());
  const daysMode = isDaysPoll(ev());
  const listMode = optionsMode || daysMode; // answered row by row
  const windows = eventWindows(ev());
  const partsMode = isPartsPoll(ev()); // people tap the mornings, afternoons and evenings they're free
  // Options inside a single day can also be shown on a calendar, next to the guest's busy times.
  const calendarOk =
    optionsMode &&
    !partsMode &&
    windows.every(
      (w) => !allDaySpan(w.start, w.end, ev().timezone) && utcToZoned(w.start, st.tz).date === utcToZoned(w.end - 1, st.tz).date,
    );
  /** How an option reads: "Sat, Nov 7, evening (6 – 10 PM)" in parts polls, otherwise its date and time. */
  const when = (s, e) => {
    const p = partsMode && partOf(s, e, ev().timezone);
    return p
      ? `${fmtDay.format(dateParts(utcToZoned(s, ev().timezone).date))}, ${p.label.toLowerCase()} (${shortRange(p.start, p.end)})`
      : fmtWhen(s, e, st.tz);
  };
  const canShare = !!navigator.share && matchMedia('(pointer: coarse)').matches;
  // What the organizer keeps private from guests.
  const hideAll = !ev().isAdmin && ev().hideResults;
  const privacy = ev().isAdmin
    ? ''
    : hideAll
      ? "Only the organizer sees everyone's answers."
      : ev().hideNames
        ? 'Only the organizer sees who answered.'
        : '';
  const me = () => ev().participants.find((p) => p.id === saved(id).participantId);
  // A new poll opens on the organizer's own answer, ready to adjust; after that, on the group.
  st.tab = !st.fresh && (me() || (ev().isAdmin && ev().participants.length)) ? 'group' : 'mine';

  // Reading busy times from Google, Outlook or a calendar file comes back later.
  const calMenu = `<button type="button" class="pill soon" id="cal-btn" disabled aria-describedby="cal-soon">Check my calendar <span class="badge-soon" id="cal-soon">Coming soon</span></button>`;

  app.innerHTML = `
    <article id="event-root" class="poll">
      <header class="poll-head">
        <span class="emoji-tile big" aria-hidden="true">${esc(ev().emoji || '🗓️')}</span>
        <div class="poll-head-text">
          <h1 id="ev-title"></h1>
          <p class="poll-meta" id="ev-meta"></p>
          <div id="ev-details"></div>
        </div>
        <div class="poll-share">
          <button class="btn btn-primary" id="copy">${canShare ? 'Share the poll' : 'Copy invite link'}</button>
        </div>
      </header>
      <div id="banners"></div>
      <div id="notify-box"></div>
      <div id="privacy-box"></div>
      <div id="ai-box"></div>
      <div class="tabs" role="tablist" aria-label="Poll">
        <button type="button" role="tab" id="tab-mine" aria-controls="panel-mine" data-tab="mine">Your answer</button>
        <button type="button" role="tab" id="tab-group" aria-controls="panel-group" data-tab="group">The group <span class="count" id="group-count"></span></button>
      </div>
      <div class="panels">
        <section class="panel sheet" id="panel-mine" role="tabpanel" aria-labelledby="tab-mine">
          <h2 class="panel-title">${listMode ? (daysMode ? 'Which days are you free?' : 'Which of these work for you?') : 'When are you free?'}</h2>
          <div class="quick-actions">
            ${calMenu}
            ${optionsMode ? '<button type="button" class="pill" id="ai-answer-btn" hidden aria-expanded="false" aria-controls="ai-answer">Answer for me</button>' : ''}
            <button type="button" class="pill pill-quiet" id="fill">${listMode ? 'Yes to all' : 'All'}</button>
            <button type="button" class="pill pill-quiet" id="decline">None of these work</button>
            <button type="button" class="pill pill-quiet" id="none">Clear</button>
          </div>
          ${
            optionsMode
              ? `<div id="ai-answer" class="ai-panel" hidden>
                  <label for="ai-prefs">What works for you?</label>
                  <textarea id="ai-prefs" rows="2" maxlength="600" placeholder="No Mondays. Weekends are best. I'm away on the 12th."></textarea>
                  <label class="check" id="ai-use-cal-row" hidden><input type="checkbox" id="ai-use-cal" checked> Also use the busy times from my calendar</label>
                  <div class="btn-row">
                    <button type="button" class="btn btn-primary btn-sm" id="ai-answer-go">Fill in my answers</button>
                    <span class="hint">Sent to Anthropic's Claude to fill in. You can change anything before saving.</span>
                  </div>
                </div>`
              : ''
          }
          ${
            listMode
              ? `${
                  calendarOk
                    ? `<div class="seg mine-view" role="radiogroup" aria-label="Show the options as">
                        <button type="button" role="radio" data-mine-view="list">List</button>
                        <button type="button" role="radio" data-mine-view="calendar">Calendar</button>
                      </div>`
                    : ''
                }
                ${partsMode ? '<p class="hint">Tap each time you\'re free. Tap again for "if needed", and once more to clear it.</p>' : ''}
                <div id="mine" class="rows"></div>
                <div id="mine-cal" hidden></div>`
              : `<div class="seg brush" role="group" aria-label="Brush">
                  <button type="button" data-brush="${YES}"><span class="swatch swatch-yes"></span>Free</button>
                  <button type="button" data-brush="${IF_NEEDED}"><span class="swatch swatch-maybe"></span>If needed</button>
                  <button type="button" data-brush="0"><span class="swatch swatch-no"></span>Busy</button>
                </div>
                <p class="hint">Drag across the times you're free. On a phone, tap or drag.</p>
                <div class="tv-strip" id="hour-days" role="group" aria-label="Days" hidden></div>
                <div class="grid-scroll"><div class="grid" id="mine" role="group" aria-label="Your availability. Use the arrow keys to move and Space to mark a time."></div></div>`
          }
          <div class="my-picks" id="my-picks" aria-live="polite" hidden></div>
          <div class="mine-footer">
            <p class="hint" id="edit-link" hidden></p>
            <button type="button" class="link-btn danger" id="leave" hidden>Remove my answer</button>
          </div>
          <div>
            <label for="name">Your name</label>
            <input id="name" type="text" maxlength="80" autocomplete="name">
          </div>
          <div id="copy-field"${ev().requireEmail ? '' : ' hidden'}>
            <label for="copy-to">Your email <span class="muted">(${ev().requireEmail ? 'the organizer asks for it, and only they see it' : 'optional'})</span></label>
            <input id="copy-to" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@example.com">
            <label class="check" hidden><input type="checkbox" id="copy-me" checked> Email me a copy of my answer and a link to change it</label>
          </div>
          ${privacy && `<p class="hint">🔒 ${privacy}</p>`}
          <div class="save-bar">
            <div>
              <span id="save-state" class="hint"></span>
              <div class="error" id="save-err" role="alert"></div>
            </div>
            <button type="button" class="btn btn-primary" id="save">Save</button>
          </div>
        </section>
        <section class="panel" id="panel-group" role="tabpanel" aria-labelledby="tab-group">
          ${hideAll ? `<p class="sheet">🔒 ${privacy} You'll see the date at the top once they pick it.</p>` : ''}
          <div class="sheet"${hideAll ? ' hidden' : ''}>
            <div class="sheet-head">
              <h2 class="panel-title" id="best-h">${optionsMode ? 'Best options' : daysMode ? 'Best dates' : 'Best times'}</h2>
              <button type="button" class="pill" id="ai-summary-btn" hidden>Summarize with AI</button>
            </div>
            <div id="ai-summary"></div>
            <div id="best"></div>
          </div>
          <div class="sheet"${hideAll ? ' hidden' : ''}>
            <h2 class="panel-title" id="group-h">Everyone's answers</h2>
            <div class="people" id="people" role="group" aria-label="People who answered"></div>
            ${
              listMode
                ? '<div id="group"></div>'
                : `<div class="grid-scroll"><div class="grid readonly" id="group" role="group" aria-label="Everyone's availability"></div></div>
                   <div class="legend" id="legend"></div>
                   <div class="hover-info" id="inspect"></div>`
            }
          </div>
          <aside class="sheet grow-card" id="grow" hidden>
            <p><b>Planning something yourself?</b> Make your own poll in a minute. It's free, and nobody needs an account.</p>
            <a class="btn btn-primary" href="/new" data-link>Create your own poll</a>
          </aside>
        </section>
      </div>
      <details class="tz-line">
        <summary id="tz-summary"></summary>
        <label for="tz">Show times in</label>
        <select id="tz">${tzOptions(st.tz)}</select>
      </details>
    </article>`;

  $('#copy').onclick = () =>
    canShare
      ? navigator.share({ title: ev().title, text: `When works for you? ${ev().title}`, url: shareUrl }).catch(() => {})
      : copy(shareUrl, 'Invite link copied');
  $('#name').value = me()?.name || lastName();
  $('#name').oninput = () => setDirty(true);
  $('#tz').onchange = (e) => {
    st.tz = e.target.value;
    save(id, { tz: st.tz });
    renderAll();
  };

  // ----- tabs (phones) -----
  function renderTabs() {
    for (const t of $$('[data-tab]')) {
      const on = t.dataset.tab === st.tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
    }
    $('#panel-mine').classList.toggle('active', st.tab === 'mine');
    $('#panel-group').classList.toggle('active', st.tab === 'group');
  }
  const showTab = (t, focus) => {
    st.tab = t;
    renderTabs();
    if (focus) $(`#tab-${t}`).focus();
  };
  $('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) showTab(t.dataset.tab);
  });
  $('.tabs').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') showTab(st.tab === 'mine' ? 'group' : 'mine', true);
  });

  // ----- grid layout (hours polls) in the viewer's time zone -----
  let L, LG;
  function computeLayout() {
    const dates = new Set(),
      mins = new Set(),
      at = new Map();
    for (const s of ev().slots) {
      const z = utcToZoned(s, st.tz);
      dates.add(z.date);
      mins.add(z.minutes);
      at.set(`${z.date}|${z.minutes}`, s);
    }
    LG = { dates: [...dates].sort(), mins: [...mins].sort((a, b) => a - b), at };
    // Phones paint one day at a time, picked from a strip of days.
    const oneDay = isPhone() && LG.dates.length > 1;
    if (oneDay && !LG.dates.includes(st.hourDay)) st.hourDay = LG.dates[0];
    L = oneDay ? { ...LG, dates: [st.hourDay] } : LG;
    const strip = $('#hour-days');
    strip.hidden = !oneDay;
    if (oneDay)
      strip.innerHTML = LG.dates
        .map((d) => {
          const n = ev().slots.filter((s) => st.mine[s] && utcToZoned(s, st.tz).date === d).length;
          return `<button type="button" class="tv-chip" data-hour-day="${d}" aria-pressed="${d === st.hourDay}">${dayChip(d, n ? '✓' : '')}</button>`;
        })
        .join('');
  }

  // `cellAttrs(slot)` adds the role and state: toggle buttons in your grid, labelled images in the group heatmap.
  // In your own grid the day names are buttons that mark the whole day at once.
  function gridHtml(cellClass, cellAttrs = () => '', layout = L, dayButtons = false) {
    const { dates, mins, at } = layout;
    const labelEvery = ev().slotMinutes >= 60 ? ev().slotMinutes : 60;
    let h = '<div></div>';
    for (const d of dates) {
      const dt = dateParts(d);
      h += dayButtons
        ? `<button type="button" class="day-label day-fill" data-fill-day="${d}"><b>${fmtDow.format(dt)}</b>${fmtMonthDay.format(dt)}<span class="sr-only">: mark the whole day</span></button>`
        : `<div class="day-label"><b>${fmtDow.format(dt)}</b>${fmtMonthDay.format(dt)}</div>`;
    }
    mins.forEach((m, r) => {
      h += `<div class="time-label">${m % labelEvery === 0 ? minutesLabel(m) : ''}</div>`;
      dates.forEach((d, c) => {
        const s = at.get(`${d}|${m}`);
        const hour = m % 60 === 0 && r > 0 ? ' hour' : '';
        if (s == null) h += `<div class="cell void${hour}"></div>`;
        else
          h += `<div class="cell${hour} ${cellClass(s)}" data-slot="${s}" data-r="${r}" data-c="${c}" tabindex="-1" ${cellAttrs(s)}></div>`;
      });
    });
    return h;
  }
  const gridCols = (layout = L) => `auto repeat(${layout.dates.length}, minmax(38px, 1fr))`;
  const finalSet = () => {
    const set = new Set();
    const f = ev().finalStart;
    if (f != null) for (const s of ev().slots) if (s >= f && s < meetingEnd(ev(), f)) set.add(s);
    return set;
  };

  // ----- my answers -----
  const mineEl = $('#mine');
  // Everyone's answers, with my unsaved edits shown live.
  const others = () => ev().participants.map((p) => (p.id === me()?.id ? { ...p, availability: st.mine } : p));
  const changed = () => {
    if (Object.values(st.mine).some((v) => v > 0)) st.declined = false;
    setDirty(true);
    renderGroup();
    renderBest();
    renderPicks();
  };

  // ----- what I've picked so far, in words -----
  const hasAnswer = () => Object.values(st.mine).some((v) => v > 0) || st.declined || (listMode && st.touched.size > 0);
  /** Runs of free slots on each day of an hours poll: "Sat, Nov 7: 9 AM – 12 PM". */
  function hourRuns(v) {
    const runs = [];
    let cur = null;
    for (const s of ev().slots) {
      const z = utcToZoned(s, st.tz);
      const end = utcToZoned(slotEnd(ev(), s), st.tz);
      const to = end.date === z.date ? end.minutes : 1440;
      if (st.mine[s] === v && cur && cur.date === z.date && cur.to === z.minutes) cur.to = to;
      else if (st.mine[s] === v) runs.push((cur = { date: z.date, from: z.minutes, to }));
      else cur = null;
    }
    return runs.map((r) => `${fmtDay.format(dateParts(r.date))}, ${shortRange(r.from, r.to)}`);
  }
  function renderPicks() {
    const box = $('#my-picks');
    const label = (v) =>
      listMode ? windows.filter((w) => st.mine[w.start] === v).map((w) => when(w.start, w.end)) : hourRuns(v);
    const yes = label(YES);
    const maybe = label(IF_NEEDED);
    box.hidden = !hasAnswer();
    if (box.hidden) return;
    if (!yes.length && !maybe.length) {
      box.innerHTML = `<p><b>Your answer:</b> none of these work for you.</p>`;
      return;
    }
    const max = 6;
    const chips = [...yes.map((t) => [t, 'yes', '✓']), ...maybe.map((t) => [t, 'maybe', '~'])];
    const shown = chips
      .slice(0, max)
      .map(([t, cls, icon]) => `<span class="chip ${cls}"><span aria-hidden="true">${icon}</span> ${esc(t)}</span>`)
      .join('');
    const counts = [yes.length ? `${yes.length} yes` : '', maybe.length ? `${maybe.length} if needed` : '']
      .filter(Boolean)
      .join(', ');
    box.innerHTML = `<p><b>Your answer:</b> ${esc(counts)}${listMode ? `, no to the other ${windows.length - yes.length - maybe.length}` : ''}</p>
      <div class="chips">${shown}${chips.length > max ? `<span class="chip">+${chips.length - max} more</span>` : ''}</div>`;
  }

  /** The date block on the left of a row: weekday, big day number, month. */
  const dateBlock = (d) => {
    const dt = dateParts(d);
    // Whole-day polls name the weekday in the row itself.
    return `<span class="date-block" aria-hidden="true">${daysMode || partsMode ? '' : `<small>${esc(fmtDow.format(dt))}</small>`}<b>${dt.getUTCDate()}</b><small>${esc(dt.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }))}</small></span>`;
  };

  function renderMineList() {
    let prev = null;
    mineEl.innerHTML = windows
      .map((w) => {
        const d = utcToZoned(w.start, st.tz).date;
        const first = d !== prev;
        prev = d;
        const isFinal = w.start === ev().finalStart;
        const label = fmtWhen(w.start, w.end, st.tz);
        return `<div class="row${first ? '' : ' same-day'}${isFinal ? ' final' : ''}" data-opt="${w.start}">
          ${first ? dateBlock(d) : '<span class="date-block" aria-hidden="true"></span>'}
          <div class="row-main">
            <div class="row-when">${esc(daysMode ? fmtDowLong.format(dateParts(d)) : fmtTimeRange(w.start, w.end, st.tz))}${isFinal ? ' <span class="badge">Picked</span>' : ''}</div>
            ${st.aiNotes?.[w.start] ? `<div class="row-note">${esc(st.aiNotes[w.start])}</div>` : ''}
            <div class="row-tally"></div>
          </div>
          <div class="vote" role="radiogroup" aria-label="${esc(label)}">
            ${VOTES.map(([v, cls, text, icon]) => `<button type="button" role="radio" data-vote="${v}" class="${cls}" aria-label="${text}"><span aria-hidden="true">${icon}</span><span class="vote-text">${text}</span></button>`).join('')}
          </div>
        </div>`;
      })
      .join('');
    refreshMineList();
  }

  // ----- parts of the day: a row per day, a button per part -----
  const byDay = () => {
    const days = new Map();
    for (const w of windows) {
      const d = utcToZoned(w.start, ev().timezone).date;
      if (!days.has(d)) days.set(d, []);
      days.get(d).push(w);
    }
    return days;
  };
  function renderMineParts() {
    mineEl.innerHTML = [...byDay()]
      .map(
        ([d, ws]) => `<div class="row parts-row">${dateBlock(d)}
          <div class="row-main"><div class="row-when">${esc(fmtDowLong.format(dateParts(d)))}</div>
            ${ws.length > 1 ? `<button type="button" class="link-btn all-day" data-all-day="${d}">Free all day<span class="sr-only">, ${esc(fmtDay.format(dateParts(d)))}</span></button>` : ''}</div>
          <div class="part-votes">${ws
            .map((w) => {
              const p = partOf(w.start, w.end, ev().timezone);
              return `<button type="button" class="part-vote${w.start === ev().finalStart ? ' final' : ''}" data-opt="${w.start}"><b>${esc(p.label)}</b><small>${esc(shortRange(p.start, p.end))}</small><span class="pv-state"></span></button>`;
            })
            .join('')}</div>
        </div>`,
      )
      .join('');
    refreshMineParts();
  }
  function refreshMineParts() {
    for (const b of $$('.part-vote', mineEl)) {
      const v = st.mine[b.dataset.opt] || 0;
      b.dataset.v = v;
      // Pressed: true = free, mixed = if needed. The state is also written out for screen readers.
      b.setAttribute('aria-pressed', v === YES ? 'true' : v === IF_NEEDED ? 'mixed' : 'false');
      $('.pv-state', b).innerHTML =
        v === YES ? '✓ Free' : v === IF_NEEDED ? '~ If needed' : '<span class="sr-only">Not marked</span>';
    }
  }
  /** Not marked or no → yes → if needed → no. */
  function cycle(s) {
    const v = st.mine[s] || 0;
    if (v === YES) st.mine[s] = IF_NEEDED;
    else if (v === IF_NEEDED) delete st.mine[s];
    else st.mine[s] = YES;
    st.touched.add(String(s));
    refreshMine();
    changed();
  }
  if (partsMode)
    mineEl.addEventListener('click', (e) => {
      const b = e.target.closest('.part-vote');
      if (b) cycle(b.dataset.opt);
      const day = e.target.closest('[data-all-day]');
      if (day)
        markAll(
          byDay()
            .get(day.dataset.allDay)
            .map((w) => String(w.start)),
          YES,
        );
    });

  // ----- the calendar view of the options -----
  let calView = null;
  st.mineView = 'list';
  const pieces = (start, end) => {
    // Split an interval into per-day pieces in the viewer's time zone.
    const out = [];
    let d = utcToZoned(start, st.tz).date;
    const last = utcToZoned(end - 1, st.tz).date;
    for (let i = 0; d <= last && i < 60; d = addDays(d, 1), i++) {
      const a = d === utcToZoned(start, st.tz).date ? utcToZoned(start, st.tz).minutes : 0;
      const b = d === last ? utcToZoned(end, st.tz).minutes || 1440 : 1440;
      if (b > a) out.push({ date: d, from: a, to: b });
    }
    return out;
  };
  function renderMineView() {
    if (!calendarOk) return;
    for (const b of $$('[data-mine-view]')) b.setAttribute('aria-checked', b.dataset.mineView === st.mineView);
    const cal = st.mineView === 'calendar';
    mineEl.hidden = cal;
    $('#mine-cal').hidden = !cal;
    if (!cal) return;
    if (calView) return calView.render();
    const days = [...new Set(windows.map((w) => utcToZoned(w.start, st.tz).date))].sort();
    const mins = windows.flatMap((w) => [utcToZoned(w.start, st.tz).minutes, utcToZoned(w.end, st.tz).minutes || 1440]);
    const from = Math.max(0, Math.floor((Math.min(...mins) - 60) / 60) * 60);
    const to = Math.min(1440, Math.ceil((Math.max(...mins) + 60) / 60) * 60);
    const answered = () => !!me();
    calView = timeView($('#mine-cal'), {
      days,
      label: 'Options',
      views: isPhone() ? ['day'] : ['week', 'day'],
      range: () => [from, to],
      busy: () => (st.lastBusy || []).flatMap((b) => pieces(b.start, b.end)),
      blocks: () =>
        windows.map((w) => {
          const v = st.mine[w.start] || 0;
          const shown = v > 0 || answered() || st.touched.has(String(w.start)) ? v : 'none';
          const z = utcToZoned(w.start, st.tz);
          const to2 = utcToZoned(w.end, st.tz).minutes || 1440;
          const state = shown === YES ? 'Yes' : shown === IF_NEEDED ? 'If needed' : shown === 0 ? 'No' : 'Not answered';
          return {
            key: String(w.start),
            date: z.date,
            from: z.minutes,
            to: to2,
            cls: `ans-${shown}`,
            label: `${shown === YES ? '✓ ' : shown === IF_NEEDED ? '~ ' : ''}${shortRange(z.minutes, to2)}`,
            short: `${shown === YES ? '✓ ' : shown === IF_NEEDED ? '~ ' : ''}${shortTime(z.minutes)}`,
            title: `${shortRange(z.minutes, to2)}, ${fmtDay.format(dateParts(z.date))}: ${state}. Tap to change`,
          };
        }),
      onBlock: cycle,
      marks: (d) => String(windows.filter((w) => utcToZoned(w.start, st.tz).date === d).length),
    });
  }
  $('#panel-mine').addEventListener('click', (e) => {
    const v = e.target.closest('[data-mine-view]');
    if (v) {
      st.mineView = v.dataset.mineView;
      renderMineView();
    }
    const day = e.target.closest('[data-hour-day]');
    if (day) {
      st.hourDay = day.dataset.hourDay;
      computeLayout();
      renderMine();
    }
  });

  function refreshMineList() {
    const people = others().filter((p) => p.id !== me()?.id);
    const answeredBefore = !!me();
    for (const el of $$('[data-opt]', mineEl)) {
      const s = el.dataset.opt;
      const v = st.mine[s] || 0;
      const shown = v > 0 || answeredBefore || st.touched.has(s) ? v : -1;
      el.dataset.v = shown;
      for (const b of $$('[data-vote]', el)) b.setAttribute('aria-checked', +b.dataset.vote === shown);
      const yes = people.filter((p) => p.availability[s] === YES).map((p) => p.name);
      const maybe = people.filter((p) => p.availability[s] === IF_NEEDED).length;
      $('.row-tally', el).innerHTML =
        yes.length || maybe
          ? `${avatarStack(yes, 4)}<span class="hint">${yes.length ? `${yes.length} yes` : ''}${yes.length && maybe ? ', ' : ''}${maybe ? `${maybe} if needed` : ''}</span>`
          : '';
    }
  }

  if (listMode)
    mineEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vote]');
      if (!b) return;
      const s = b.closest('[data-opt]').dataset.opt;
      const v = +b.dataset.vote;
      if (v) st.mine[s] = v;
      else delete st.mine[s];
      st.touched.add(s);
      refreshMine();
      changed();
    });

  function renderMine() {
    if (partsMode) return renderMineParts();
    if (listMode) return renderMineList();
    mineEl.style.gridTemplateColumns = gridCols();
    const pressed = (s) => (st.mine[s] === YES ? 'true' : st.mine[s] === IF_NEEDED ? 'mixed' : 'false');
    mineEl.innerHTML = gridHtml(
      (s) => (st.mine[s] === YES ? 'yes' : st.mine[s] === IF_NEEDED ? 'maybe' : '') + (finalSet().has(s) ? ' final' : ''),
      (s) => `role="button" aria-pressed="${pressed(s)}" aria-label="${esc(fmtWhen(s, slotEnd(ev(), s), st.tz))}"`,
      L,
      true,
    );
    const first = $('.cell[data-slot]', mineEl);
    if (first) first.tabIndex = 0;
  }
  function refreshMine() {
    calView?.render();
    if (partsMode) return refreshMineParts();
    if (listMode) return refreshMineList();
    for (const el of $$('.cell[data-slot]', mineEl)) {
      const v = st.mine[el.dataset.slot];
      el.classList.toggle('yes', v === YES);
      el.classList.toggle('maybe', v === IF_NEEDED);
      el.setAttribute('aria-pressed', v === YES ? 'true' : v === IF_NEEDED ? 'mixed' : 'false');
    }
  }

  // ----- painting (hours polls) -----
  let drag = null;
  const pos = (el) => ({ r: +el.dataset.r, c: +el.dataset.c });
  function paintRect(a, b) {
    st.mine = { ...drag.snapshot };
    const [r0, r1] = [Math.min(a.r, b.r), Math.max(a.r, b.r)];
    const [c0, c1] = [Math.min(a.c, b.c), Math.max(a.c, b.c)];
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const s = L.at.get(`${L.dates[c]}|${L.mins[r]}`);
        if (s == null) continue;
        if (drag.value) st.mine[s] = drag.value;
        else delete st.mine[s];
      }
    refreshMine();
  }
  const endPaint = () => {
    if (!drag) return;
    drag = null;
    changed();
  };
  /** Mark every slot in `slots` with `v`, or clear them all when they already are. */
  function markAll(slots, v) {
    const all = slots.every((s) => (st.mine[s] || 0) === v);
    for (const s of slots) {
      if (v && !all) st.mine[s] = v;
      else delete st.mine[s];
      st.touched.add(String(s));
    }
    refreshMine();
    changed();
  }
  if (!listMode) {
    mineEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fill-day]');
      if (!b) return;
      const slots = ev().slots.filter((s) => utcToZoned(s, st.tz).date === b.dataset.fillDay);
      markAll(slots, st.brush);
    });
    mineEl.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.cell[data-slot]');
      if (!el || e.button > 0) return;
      e.preventDefault();
      const cur = st.mine[el.dataset.slot] || 0;
      drag = { anchor: pos(el), snapshot: { ...st.mine }, value: cur === st.brush ? 0 : st.brush };
      paintRect(drag.anchor, drag.anchor);
    });
    mineEl.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('#mine .cell[data-slot]');
      if (el) paintRect(drag.anchor, pos(el));
    });
    // Keyboard: arrows move, Space or Enter paints with the current brush.
    mineEl.addEventListener('keydown', (e) => {
      const el = e.target.closest('.cell[data-slot]');
      if (!el) return;
      let { r, c } = pos(el);
      const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (moves[e.key]) {
        e.preventDefault();
        for (let i = 0; i < 200; i++) {
          r += moves[e.key][0];
          c += moves[e.key][1];
          if (r < 0 || c < 0 || r >= L.mins.length || c >= L.dates.length) return;
          const next = $(`.cell[data-r="${r}"][data-c="${c}"]`, mineEl);
          if (next) {
            el.tabIndex = -1;
            next.tabIndex = 0;
            next.focus();
            return;
          }
        }
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        const s = el.dataset.slot;
        if ((st.mine[s] || 0) === st.brush || !st.brush) delete st.mine[s];
        else st.mine[s] = st.brush;
        refreshMine();
        changed();
      }
    });
    for (const b of $$('[data-brush]'))
      b.onclick = () => {
        st.brush = +b.dataset.brush;
        renderBrush();
      };
  }
  window.addEventListener('pointerup', endPaint);
  window.addEventListener('pointercancel', endPaint);
  function renderBrush() {
    for (const b of $$('[data-brush]')) b.setAttribute('aria-pressed', +b.dataset.brush === st.brush);
  }

  $('#fill').onclick = () => {
    st.mine = Object.fromEntries(ev().slots.map((s) => [s, YES]));
    for (const s of ev().slots) st.touched.add(String(s));
    refreshMine();
    changed();
  };
  $('#none').onclick = () => {
    st.mine = {};
    st.declined = false;
    st.touched.clear();
    refreshMine();
    changed();
  };
  // Saying no to everything is an answer too: it shows as a row of No in the group.
  $('#decline').onclick = () => {
    st.mine = {};
    st.declined = true;
    for (const s of ev().slots) st.touched.add(String(s));
    refreshMine();
    changed();
  };

  // ----- AI: answer for me, and the organizer's summary -----
  let aiOn = false;
  getConfig().then((c) => {
    // Guests can get their answer by email. Optional, and on by default once they give an address.
    $('#copy-field').hidden = !c.email && !ev().requireEmail;
    $('#copy-me').parentNode.hidden = !c.email;
    $('#copy-to').value = me()?.email || lastEmail();
    if (!c.ai) return;
    aiOn = true;
    if (optionsMode) $('#ai-answer-btn').hidden = false;
    if (ev().isAdmin) $('#ai-summary-btn').hidden = false;
    renderBanners();
  });

  if (optionsMode) {
    $('#ai-answer-btn').onclick = () => {
      const panel = $('#ai-answer');
      panel.hidden = !panel.hidden;
      $('#ai-answer-btn').setAttribute('aria-expanded', !panel.hidden);
      $('#ai-use-cal-row').hidden = !st.lastBusy;
      if (!panel.hidden) $('#ai-prefs').focus();
    };
    $('#ai-answer-go').onclick = async (e) => {
      const preferences = $('#ai-prefs').value.trim();
      if (!preferences) return $('#ai-prefs').focus();
      const busy = st.lastBusy && $('#ai-use-cal').checked ? st.lastBusy : [];
      if (Object.keys(st.mine).length && !confirm('Replace your current answers with AI suggestions?')) return;
      e.target.disabled = true;
      e.target.textContent = 'Thinking…';
      try {
        const { answers } = await api(`events/${id}/ai/answer`, { method: 'POST', body: { preferences, busy, timezone: st.tz } });
        st.mine = {};
        st.aiNotes = {};
        for (const [s, a] of Object.entries(answers)) {
          if (a.answer) st.mine[s] = a.answer;
          if (a.note) st.aiNotes[s] = a.note;
          st.touched.add(s);
        }
        $('#ai-answer').hidden = true;
        renderMine();
        changed();
        toast('Filled in your answers. Check them, then save.');
      } catch (ex) {
        toast(ex.message);
      } finally {
        e.target.disabled = false;
        e.target.textContent = 'Fill in my answers';
      }
    };
  }

  $('#ai-summary-btn').onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Summarizing…';
    try {
      const r = await api(`events/${id}/ai/summary`, { method: 'POST', body: {}, headers: authHeaders() });
      const rec =
        r.recommendedStart == null
          ? ''
          : `<div class="ai-rec">
              <div><b>Suggested:</b> ${esc(when(r.recommendedStart, meetingEnd(ev(), r.recommendedStart)))}${r.reason ? `<div class="hint">${esc(r.reason)}</div>` : ''}</div>
              ${ev().finalStart === r.recommendedStart ? '' : `<button class="btn btn-sm" data-pick="${r.recommendedStart}">Pick this</button>`}
            </div>`;
      $('#ai-summary').innerHTML =
        `<div class="ai-card"><p>${esc(r.summary)}</p>${rec}<p class="hint">Written by AI from the answers so far. Double-check before deciding.</p></div>`;
    } catch (ex) {
      toast(ex.message);
    } finally {
      e.target.disabled = false;
      e.target.textContent = 'Summarize with AI';
    }
  };

  // ----- saving -----
  /** What's still missing before the answer can be saved, or '' when it can. */
  const needs = () => {
    const name = !$('#name').value.trim();
    const pick = !hasAnswer();
    if (name && pick) return `Add your name and pick at least one ${listMode ? 'option' : 'time'} to save.`;
    if (name) return 'Add your name to save.';
    if (pick) return `Pick at least one ${listMode ? 'option' : 'time'} to save, or choose "None of these work".`;
    return '';
  };
  function setDirty(v) {
    st.dirty = v;
    const el = $('#save-state');
    const need = needs();
    $('#save').dataset.ready = !need;
    if (v) {
      el.className = 'dirty';
      el.textContent = 'Not saved yet';
      if (listMode) {
        const answered = ev().slots.filter((s) => st.mine[s] || st.touched.has(String(s))).length;
        el.textContent += `, ${answered} of ${ev().slots.length} answered`;
      }
      if (need) el.textContent += `. ${need}`;
    } else {
      el.className = 'hint';
      el.textContent = me() ? 'Saved' : need;
    }
  }

  $('#save').onclick = async () => {
    const err = $('#save-err');
    err.textContent = '';
    const name = $('#name').value.trim();
    if (!name) {
      err.textContent = 'Add your name so everyone knows who you are.';
      $('#name').focus();
      return;
    }
    if (!hasAnswer()) {
      err.textContent = `Pick at least one ${listMode ? 'option' : 'time'} that works, or choose "None of these work".`;
      $('#mine').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
      return;
    }
    rememberName(name);
    $('#save').disabled = true;
    try {
      const body = { name, availability: st.mine };
      const email = $('#copy-to').value.trim();
      if (ev().requireEmail) body.email = email;
      const copyTo = !$('#copy-field').hidden && !$('#copy-me').parentNode.hidden && $('#copy-me').checked && email;
      if (copyTo) {
        body.copyTo = copyTo;
        rememberEmail(copyTo);
      }
      const s = saved(id);
      let created = false;
      if (s.participantId) {
        try {
          await api(`events/${id}/participants/${s.participantId}`, {
            method: 'PUT',
            body,
            headers: { 'x-edit-token': s.editToken },
          });
        } catch (ex) {
          if (ex.status !== 404 && ex.status !== 403) throw ex;
          forget(id, 'participantId', 'editToken');
        }
      }
      if (!saved(id).participantId) {
        const r = await api(`events/${id}/participants`, { method: 'POST', body });
        save(id, { participantId: r.id, editToken: r.editToken });
        created = true;
      }
      await load();
      setDirty(false);
      renderAll();
      // After the first save of a visit, show the group: that's what people want to see next. An
      // organizer's answer already exists when the poll is new, so their first save counts too.
      const first = created || !st.saved;
      st.saved = true;
      toast(
        `${first ? "Saved. Here's how everyone's answers line up." : 'Saved.'}${copyTo ? ` A copy is on its way to ${copyTo}.` : ''}`,
      );
      if (first) {
        showTab('group');
        $('#panel-group').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      }
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      $('#save').disabled = false;
    }
  };

  $('#leave').onclick = async () => {
    if (!confirm('Remove your answer from this poll?')) return;
    const s = saved(id);
    try {
      await api(`events/${id}/participants/${s.participantId}`, { method: 'DELETE', headers: { 'x-edit-token': s.editToken } });
    } catch (ex) {
      if (ex.status !== 404) return toast(ex.message);
    }
    forget(id, 'participantId', 'editToken');
    st.mine = {};
    st.declined = false;
    st.touched.clear();
    await load();
    setDirty(false);
    renderAll();
  };

  const beforeUnload = (e) => {
    if (st.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);

  // ----- the group -----
  const groupEl = $('#group');

  function renderGroupList() {
    const people = others();
    if (!people.length) {
      groupEl.innerHTML = '';
      return;
    }
    const top = rankTimes(ev(), ev().slots, people, 1)[0];
    const topCount = top ? top.yes.length + top.ifNeeded.length : -1;
    const isTop = (s) => !daysMode && people.filter((p) => p.availability[s]).length === topCount && topCount > 0;
    const cls = (w) => [isTop(w.start) ? 'top' : '', w.start === ev().finalStart ? 'final' : ''].join(' ');
    const head = windows
      .map((w) => {
        const z = utcToZoned(w.start, st.tz);
        const time = optionsMode && !allDaySpan(w.start, w.end, st.tz) ? fmtTimeRange(w.start, w.end, st.tz).split(' – ')[0] : '';
        return `<th class="${cls(w)}" scope="col"><span class="m-day">${esc(fmtDow.format(dateParts(z.date)))}</span><span class="m-date">${esc(fmtMonthDay.format(dateParts(z.date)))}</span>${time ? `<span class="m-time">${esc(time)}</span>` : ''}</th>`;
      })
      .join('');
    const myId = me()?.id;
    const rows = people
      .map((p) => {
        const cells = windows
          .map((w) => {
            const v = p.availability[w.start];
            return v === YES
              ? `<td class="m-yes ${cls(w)}"><span aria-hidden="true">✓</span><span class="sr-only">Yes</span></td>`
              : v === IF_NEEDED
                ? `<td class="m-maybe ${cls(w)}"><span aria-hidden="true">~</span><span class="sr-only">If needed</span></td>`
                : `<td class="m-no ${cls(w)}"><span aria-hidden="true">✕</span><span class="sr-only">No</span></td>`;
          })
          .join('');
        return `<tr class="${p.id === st.focus ? 'focus' : ''}"><th scope="row">${avatar(p.name, 'av-sm')}<span>${esc(p.name)}${p.id === myId ? ' <span class="muted">(you)</span>' : ''}</span></th>${cells}</tr>`;
      })
      .join('');
    const totals = windows
      .map((w) => {
        const n = people.filter((p) => p.availability[w.start]).length;
        return `<td class="${cls(w)}"><b>${n}</b></td>`;
      })
      .join('');
    groupEl.innerHTML = `<div class="matrix-scroll" tabindex="0" role="region" aria-label="Everyone's answers"><table class="matrix">
      <thead><tr><th></th>${head}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th scope="row">Can come</th>${totals}</tr></tfoot>
    </table></div>
    <p class="hint">✓ yes, ~ if needed, ✕ no. ${daysMode ? '' : 'The most popular are highlighted.'}</p>`;
  }

  // Parts of the day: a day-by-part table, shaded by how many people are free.
  function renderGroupParts() {
    const people = others();
    const n = people.length;
    if (!n) return (groupEl.innerHTML = '');
    const parts = DAY_PARTS.filter((p) => windows.some((w) => partOf(w.start, w.end, ev().timezone)?.key === p.key));
    const rows = [...byDay()]
      .map(([d, ws]) => {
        const cells = parts
          .map((p) => {
            const w = ws.find((x) => partOf(x.start, x.end, ev().timezone)?.key === p.key);
            if (!w) return '<td></td>';
            const yes = people.filter((x) => x.availability[w.start] === YES).length;
            const maybe = people.filter((x) => x.availability[w.start] === IF_NEEDED).length;
            const label = `${when(w.start, w.end)}: ${yes} of ${n} free${maybe ? `, ${maybe} if needed` : ''}`;
            return `<td><button type="button" class="heat-btn${String(w.start) === String(st.inspect) ? ' active' : ''}${w.start === ev().finalStart ? ' final' : ''}" data-inspect="${w.start}" style="--a:${((yes + maybe / 2) / n).toFixed(2)}" aria-label="${esc(label)}">${yes + maybe}</button></td>`;
          })
          .join('');
        return `<tr><th scope="row">${esc(fmtDay.format(dateParts(d)))}</th>${cells}</tr>`;
      })
      .join('');
    groupEl.innerHTML = `<div class="matrix-scroll"><table class="heat-table">
        <thead><tr><th></th>${parts.map((p) => `<th scope="col">${esc(p.label)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="hint">How many people are free. Darker means more. Tap one to see who.</p>
      <div class="hover-info" id="parts-inspect"></div>`;
    renderPartsInspect();
  }
  function renderPartsInspect() {
    const box = $('#parts-inspect');
    if (!box || st.inspect == null) return;
    const s = +st.inspect;
    const w = windows.find((x) => x.start === s);
    if (!w) return;
    const people = others();
    const chips = (list, cls) =>
      list.map((p) => `<span class="chip ${cls}">${avatar(p.name, 'av-xs')}${esc(p.name)}</span>`).join('');
    box.innerHTML = `
      <div class="sheet-head">
        <b>${esc(when(w.start, w.end))}</b>
        ${ev().isAdmin && ev().finalStart !== s ? `<button class="btn btn-sm" data-pick="${s}">Pick this</button>` : ''}
      </div>
      <div class="chips">${chips(
        people.filter((p) => p.availability[s] === YES),
        'yes',
      )}${chips(
        people.filter((p) => p.availability[s] === IF_NEEDED),
        'maybe',
      )}${chips(
        people.filter((p) => !p.availability[s]),
        'no',
      )}</div>`;
  }
  groupEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-inspect]');
    if (!b) return;
    st.inspect = b.dataset.inspect;
    renderGroupParts();
  });

  function renderGroup() {
    $('#group-count').textContent = ev().responses ?? (ev().participants.length || '');
    if (partsMode) return renderGroupParts();
    if (listMode) return renderGroupList();
    const people = others();
    const n = people.length;
    const fs = finalSet();
    const focus = people.find((p) => p.id === st.focus);
    groupEl.style.gridTemplateColumns = gridCols(LG);
    // Each heatmap cell says, in words, what its colour shows.
    const groupLabel = (s) => {
      const yes = people.filter((p) => p.availability[s] === YES).length;
      const maybe = people.filter((p) => p.availability[s] === IF_NEEDED).length;
      const when = fmtWhen(s, slotEnd(ev(), s), st.tz);
      return `role="img" aria-label="${esc(`${when}: ${yes} of ${n} free${maybe ? `, ${maybe} if needed` : ''}`)}"`;
    };
    groupEl.innerHTML = gridHtml(
      (s) => {
        let cls = fs.has(s) ? 'final' : '';
        if (String(s) === String(st.inspect)) cls += ' active';
        if (focus) cls += focus.availability[s] === YES ? ' yes' : focus.availability[s] === IF_NEEDED ? ' maybe' : '';
        return cls;
      },
      groupLabel,
      LG,
    );
    if (!focus)
      for (const el of $$('.cell[data-slot]', groupEl)) {
        const s = el.dataset.slot;
        let score = 0;
        for (const p of people) score += p.availability[s] === YES ? 1 : p.availability[s] === IF_NEEDED ? 0.5 : 0;
        if (score > 0) el.style.background = `rgba(var(--heat), ${0.15 + 0.85 * (score / n)})`;
      }
    const scale = [0.2, 0.4, 0.6, 0.8, 1]
      .map((a) => `<span style="background:rgba(var(--heat),${0.15 + 0.85 * a})"></span>`)
      .join('');
    $('#legend').innerHTML = focus
      ? `<span>Showing <b>${esc(focus.name)}</b></span><span><span class="swatch swatch-yes"></span> free</span><span><span class="swatch swatch-maybe"></span> if needed</span><button class="link-btn" id="unfocus">Show everyone</button>`
      : n
        ? `<span>0/${n}</span><span class="heat-scale">${scale}</span><span>${n}/${n} free</span>`
        : '';
    if ($('#unfocus'))
      $('#unfocus').onclick = () => {
        st.focus = null;
        renderGroup();
        renderPeople();
      };
    renderInspect();
  }

  function renderInspect() {
    const box = $('#inspect');
    if (!box) return;
    const people = others();
    if (!people.length) return (box.innerHTML = '');
    if (st.inspect == null)
      return (box.innerHTML =
        '<p class="hint">Hover or tap a time to see who\'s free. Tap a name to see just their answers.</p>');
    const s = +st.inspect;
    const yes = people.filter((p) => p.availability[s] === YES);
    const maybe = people.filter((p) => p.availability[s] === IF_NEEDED);
    const no = people.filter((p) => !p.availability[s]);
    const chips = (list, cls) =>
      list.map((p) => `<span class="chip ${cls}">${avatar(p.name, 'av-xs')}${esc(p.name)}</span>`).join('');
    const canPick = ev().isAdmin && rankTimes(ev(), ev().slots, people, 999).some((b) => b.start === s);
    box.innerHTML = `
      <div class="sheet-head">
        <b>${esc(fmtWhen(s, slotEnd(ev(), s), st.tz))}</b>
        ${canPick ? `<button class="btn btn-sm" data-pick="${s}">Pick this start time</button>` : ''}
      </div>
      <div class="chips">${chips(yes, 'yes')}${chips(maybe, 'maybe')}${chips(no, 'no')}</div>
      <p class="hint">${yes.length} free, ${maybe.length} if needed, ${no.length} busy</p>`;
  }
  if (!listMode) {
    const inspectFrom = (e) => {
      const el = e.target.closest('.cell[data-slot]');
      if (!el || el.dataset.slot === String(st.inspect)) return;
      $('.cell.active', groupEl)?.classList.remove('active');
      el.classList.add('active');
      st.inspect = el.dataset.slot;
      renderInspect();
    };
    groupEl.addEventListener('pointerover', inspectFrom);
    groupEl.addEventListener('click', inspectFrom);
  }

  function renderPeople() {
    const myId = me()?.id;
    $('#people').innerHTML = ev()
      .participants.map((p) => {
        const canDelete = p.id === myId || ev().isAdmin;
        return `<span class="chip person${p.id === myId ? ' me' : ''}" data-person="${esc(p.id)}" role="button" tabindex="0" aria-pressed="${p.id === st.focus}">${avatar(p.name, 'av-xs')}${esc(p.name)}${p.id === myId ? ' (you)' : ''}${canDelete && p.id !== myId ? `<button data-remove="${esc(p.id)}" aria-label="Remove ${esc(p.name)}'s answer" title="Remove">×</button>` : ''}</span>`;
      })
      .join('');
  }
  $('#people').addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      e.stopPropagation();
      const p = ev().participants.find((x) => x.id === rm.dataset.remove);
      if (!p || !confirm(`Remove ${p.name}'s answer?`)) return;
      try {
        await api(`events/${id}/participants/${p.id}`, { method: 'DELETE', headers: authHeaders() });
        if (st.focus === p.id) st.focus = null;
        await load();
        renderAll();
      } catch (ex) {
        toast(ex.message);
      }
      return;
    }
    const chip = e.target.closest('[data-person]');
    if (chip) {
      st.focus = st.focus === chip.dataset.person ? null : chip.dataset.person;
      renderPeople();
      renderGroup();
    }
  });
  $('#people').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-person]')) {
      e.preventDefault();
      e.target.click();
    }
  });

  // ----- best options -----
  function renderBest() {
    const people = others();
    const best = rankTimes(ev(), ev().slots, people, 5);
    const n = people.length;
    if (!n) {
      $('#best').innerHTML = `<div class="empty-state">
        <div class="venn-art" aria-hidden="true"><i></i><i></i><i></i></div>
        <p><b>No answers yet.</b> Send the invite link to your group. The best ${optionsMode ? 'options' : daysMode ? 'dates' : 'times'} show up here as people answer.</p>
        <button class="btn" data-share>${canShare ? 'Share the poll' : 'Copy invite link'}</button>
      </div>`;
      return;
    }
    if (!best.length) {
      $('#best').innerHTML = '<p class="hint">Nothing works for anyone yet.</p>';
      return;
    }
    const [first, ...rest] = best;
    const who = (b) => {
      const can = b.yes.length + b.ifNeeded.length;
      if (can === n && !b.ifNeeded.length) return n === 1 ? 'Works for the one person so far' : `Everyone can make it`;
      return `${can} of ${n} can make it${b.ifNeeded.length ? `, ${b.ifNeeded.length} if needed` : ''}`;
    };
    const pick = (b) =>
      ev().isAdmin && ev().finalStart !== b.start ? `<button class="btn btn-sm" data-pick="${b.start}">Pick</button>` : '';
    // Everyone by their full name, so the host knows exactly who can come.
    const names = (b) => {
      const list = [...b.yes.map(esc), ...b.ifNeeded.map((x) => `${esc(x)} <span class="muted">(if needed)</span>`)];
      return list.length ? `<p class="names"><span class="sr-only">Can make it: </span>${list.join(', ')}</p>` : '';
    };
    const missing = (b) => (b.no.length ? `<p class="hint">Can't make it: ${b.no.map(esc).join(', ')}</p>` : '');
    const lenNote = !optionsMode && ev().durationMinutes > ev().slotMinutes ? ` (${lengthLabel(ev().durationMinutes)})` : '';
    $('#best').innerHTML = `
      <div class="best-hero${ev().finalStart === first.start ? ' final' : ''}">
        <div class="best-when">${esc(when(first.start, first.end))}${esc(lenNote)}</div>
        <div class="best-who">${avatarStack([...first.yes, ...first.ifNeeded], 7)}<span>${esc(who(first))}</span></div>
        ${names(first)}
        ${missing(first)}
        ${pick(first) ? `<div class="btn-row">${pick(first).replace('btn btn-sm', 'btn btn-primary')}</div>` : ''}
      </div>
      ${
        rest.length
          ? `<h3 class="sub">Also good</h3><ol class="best">${rest
              .map(
                (b) => `<li>
                  <div class="grow">
                    <div class="when">${esc(when(b.start, b.end))}</div>
                    <div class="best-who small">${avatarStack([...b.yes, ...b.ifNeeded], 4)}<span>${esc(who(b))}</span></div>
                    ${names(b)}
                  </div>
                  ${pick(b)}
                </li>`,
              )
              .join('')}</ol>`
          : ''
      }`;
  }

  // ----- picking the final time -----
  $('#event-root').addEventListener('click', async (e) => {
    if (e.target.closest('[data-share]')) return $('#copy').click();
    const btn = e.target.closest('[data-pick], #unpick');
    if (!btn) return;
    const start = btn.id === 'unpick' ? null : +btn.dataset.pick;
    try {
      await api(`events/${id}/finalize`, { method: 'POST', body: { start }, headers: authHeaders() });
      await load();
      st.celebrate = start != null;
      renderAll();
      if (start != null) $('#banners').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      toast(start == null ? 'Final date cleared' : "It's set. Share the link so everyone can add it to their calendar.");
    } catch (ex) {
      toast(ex.message);
    }
  });

  // ----- organizer: notifications and privacy, from a module only organizers load -----
  const panels = {}; // which organizer panels are open: notify, privacy
  async function panel(name, open) {
    panels[name] = open;
    $(`#${name}-open`)?.setAttribute('aria-expanded', open);
    if (!open) return ($(`#${name}-box`).innerHTML = '');
    (await import('./organizer.js'))[name]({
      id,
      ev: ev(),
      shareUrl,
      headers: authHeaders(),
      close: () => panel(name, false),
      reload: () => load().then(() => (renderAll(), ev())),
    });
  }

  // ----- organizer: AI-written messages -----
  function toggleWriter() {
    const box = $('#ai-box');
    if (box.innerHTML) return (box.innerHTML = '');
    const kinds = [
      ['invite', 'Invite'],
      ['reminder', 'Reminder'],
      ['announcement', 'Final date'],
    ];
    box.innerHTML = `
      <section class="sheet" aria-labelledby="ai-write-h">
        <div class="sheet-head">
          <h2 id="ai-write-h">Write a message</h2>
          <button type="button" class="link-btn" id="ai-write-close">Close</button>
        </div>
        <p class="hint">AI drafts a message to paste into your group chat or an email.</p>
        <div class="seg" role="group" aria-label="Message type">
          ${kinds.map(([k, l]) => `<button type="button" data-kind="${k}"${k === 'announcement' && ev().finalStart == null ? ' disabled title="Pick the final date first"' : ''}>${l}</button>`).join('')}
        </div>
        <div id="ai-write-out"></div>
      </section>`;
    $('#ai-write-close').onclick = () => (box.innerHTML = '');
    for (const b of $$('[data-kind]', box))
      b.onclick = async () => {
        for (const x of $$('[data-kind]', box)) x.setAttribute('aria-pressed', x === b);
        const out = $('#ai-write-out');
        out.innerHTML = '<p class="hint">Writing…</p>';
        try {
          const { message } = await api(`events/${id}/ai/message`, {
            method: 'POST',
            body: { kind: b.dataset.kind },
            headers: authHeaders(),
          });
          out.innerHTML = `<label for="ai-msg" class="sr-only">Message</label><textarea id="ai-msg" rows="5">${esc(message)}</textarea><div class="btn-row"><button type="button" class="btn btn-sm btn-primary" id="ai-msg-copy">Copy</button></div>`;
          $('#ai-msg-copy').onclick = () => copy($('#ai-msg').value, 'Message copied');
        } catch (ex) {
          out.innerHTML = `<p class="error">${esc(ex.message)}</p>`;
        }
      };
  }

  // ----- header, banners -----
  function renderHeader() {
    $('#ev-title').textContent = ev().title;
    const n = ev().responses ?? ev().participants.length;
    const by = ev().organizer
      ? `<span class="host">${avatar(ev().organizer, 'av-xs')}Hosted by ${esc(ev().organizer)}</span>`
      : '';
    const count = n
      ? `<span class="answered">${avatarStack(
          ev().participants.map((p) => p.name),
          4,
        )}${plural(n, 'person', 'people')} answered</span>`
      : '<span class="answered">No answers yet</span>';
    $('#ev-meta').innerHTML = by + count;
    const loc = ev().location;
    const isLink = /^https?:\/\//i.test(loc || '');
    const where = loc
      ? `<p class="where"><span aria-hidden="true">📍</span> ${isLink ? `<a href="${esc(loc)}" target="_blank" rel="noopener noreferrer">${esc(loc)}</a>` : `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}" target="_blank" rel="noopener noreferrer">${esc(loc)}</a>`}</p>`
      : '';
    const what =
      !optionsMode && ev().durationMinutes > ev().slotMinutes
        ? `<p class="hint">Looking for ${daysMode ? `${lengthLabel(ev().durationMinutes)} in a row` : `${lengthLabel(ev().durationMinutes)}`}.</p>`
        : '';
    $('#ev-details').innerHTML = where + (ev().description ? `<p class="note">${esc(ev().description)}</p>` : '') + what;
    $('#tz-summary').textContent =
      st.tz === ev().timezone
        ? `Times are in ${tzName(st.tz)}`
        : `Times are in your time zone, ${tzName(st.tz)}. The host is in ${tzName(ev().timezone)}.`;
  }

  function renderBanners() {
    let h = '';
    if (ev().finalStart != null) {
      const start = ev().finalStart;
      const end = meetingEnd(ev(), start);
      const info = {
        title: ev().title,
        description: [ev().description, shareUrl].filter(Boolean).join('\n\n'),
        location: ev().location,
        start,
        end,
        allDay: allDaySpan(start, end, ev().timezone),
      };
      h += `<section class="banner-final${st.celebrate && !reducedMotion() ? ' celebrate' : ''}" aria-labelledby="final-h">
        <p class="kicker">It's happening</p>
        <h2 id="final-h">${esc(when(start, end))}</h2>
        <div class="btn-row">
          <a class="btn btn-sm" href="${esc(googleCalendarUrl(info))}" target="_blank" rel="noopener">Google Calendar</a>
          <a class="btn btn-sm" href="${esc(outlookCalendarUrl(info))}" target="_blank" rel="noopener">Outlook</a>
          <a class="btn btn-sm" href="/api/events/${esc(id)}/event.ics">Apple / other (.ics)</a>
          ${ev().isAdmin ? '<button class="link-btn" id="unpick">Change the date</button>' : ''}
        </div>
      </section>`;
    }
    if (ev().isAdmin) {
      const fresh = st.fresh;
      h += `<details class="organizer"${(st.orgOpen ?? fresh) ? ' open' : ''}>
        <summary><b>${fresh ? 'Your poll is ready.' : "You're the host."}</b> ${fresh ? 'Share the invite link with your group.' : 'Organizer tools'}</summary>
        <p class="hint">When you're ready, press <b>Pick</b> on the best ${listMode && !daysMode ? 'option' : 'date'} in the group view. To manage this poll from another device, keep your private organizer link, and don't share it.</p>
        ${fresh && saved(id).notifyPending ? '<p class="hint"><b>Check your inbox</b> for your poll\'s link. We\'ll email you when people answer.</p>' : ''}
        <div class="btn-row">
          <button class="btn btn-sm${fresh ? ' btn-primary' : ''}" id="notify-open" aria-expanded="${!!panels.notify}" aria-controls="notify-box">${fresh ? 'Get notified when people answer' : 'Notifications'}</button>
          ${aiOn ? '<button class="btn btn-sm" id="ai-write-open" aria-controls="ai-box">Write a message</button>' : ''}
          <button class="btn btn-sm" id="privacy-open" aria-expanded="${!!panels.privacy}" aria-controls="privacy-box">Privacy</button>
          ${
            // Edit until someone else answers; after that, start a new poll from this one.
            ev().participants.some((p) => p.id !== ev().hostId)
              ? `<a class="btn btn-sm" href="/new/${optionsMode && !partsMode ? 'pick' : 'free'}?copy=${id}" data-link>Duplicate poll</a>`
              : `<a class="btn btn-sm" href="/new/${optionsMode && !partsMode ? 'pick' : 'free'}?edit=${id}" data-link>Edit poll</a>`
          }
          <button class="btn btn-sm" id="copy-admin">Copy organizer link</button>
          <button class="link-btn danger" id="delete-poll">Delete poll</button>
        </div>
      </details>`;
    }
    $('#banners').innerHTML = h;
    st.celebrate = false;
    // Keep the organizer tools open or closed across re-renders.
    $('details.organizer')?.addEventListener('toggle', (e) => (st.orgOpen = e.target.open));
    if ($('#copy-admin'))
      $('#copy-admin').onclick = () => copy(`${shareUrl}#admin=${saved(id).adminToken}`, 'Organizer link copied');
    for (const name of ['notify', 'privacy'])
      if ($(`#${name}-open`)) $(`#${name}-open`).onclick = () => panel(name, !panels[name]);
    if ($('#ai-write-open')) $('#ai-write-open').onclick = () => toggleWriter();
    if ($('#delete-poll'))
      $('#delete-poll').onclick = async () => {
        if (!confirm("Delete this poll and everyone's answers? This cannot be undone.")) return;
        try {
          await api(`events/${id}`, { method: 'DELETE', headers: authHeaders() });
          forget(id, 'adminToken', 'participantId', 'editToken');
          st.dirty = false;
          navigate('/new');
          toast('Poll deleted');
        } catch (ex) {
          toast(ex.message);
        }
      };
  }

  function renderMeState() {
    const mine = me();
    $('#leave').hidden = !mine;
    $('#save').textContent = mine ? 'Save changes' : 'Save my answer';
    const s = saved(id);
    const link = $('#edit-link');
    if (mine) {
      link.hidden = false;
      link.innerHTML = `Answering as <b>${esc(mine.name)}</b>. To change it from another device, <button type="button" class="link-btn" id="copy-edit">copy your personal link</button>.`;
      $('#copy-edit').onclick = () => copy(`${shareUrl}#edit=${s.participantId}.${s.editToken}`, 'Personal link copied');
    } else link.hidden = true;
    // Guests who just answered are the people most likely to plan the next thing.
    $('#grow').hidden = !mine || ev().isAdmin;
  }

  function renderAll() {
    if (!listMode) computeLayout();
    renderHeader();
    renderBanners();
    renderTabs();
    renderBrush();
    renderMine();
    // The calendar view is built for the viewer's time zone: rebuild it when that changes.
    calView?.cleanup();
    calView = null;
    renderMineView();
    renderPeople();
    renderGroup();
    renderBest();
    renderMeState();
    renderPicks();
    setDirty(st.dirty);
  }

  // Pick up other people's answers every 20s while the tab is visible.
  const poll = setInterval(async () => {
    if (document.hidden || drag) return;
    try {
      const before = JSON.stringify(ev().participants) + ev().finalStart;
      await load();
      if (JSON.stringify(ev().participants) + ev().finalStart !== before) {
        renderHeader();
        renderBanners();
        renderPeople();
        renderGroup();
        renderBest();
        renderMeState();
        if (listMode) refreshMine();
      }
    } catch {}
  }, 20_000);

  renderAll();
  if (saved(id).justCreated) forget(id, 'justCreated');

  if (unsubscribeToken)
    api(`events/${id}/notifications/unsubscribe`, { method: 'POST', body: { token: unsubscribeToken } })
      .then(() => toast("Done. You won't get more emails about this poll."))
      .catch((ex) => toast(ex.message));

  return () => {
    calView?.cleanup();
    clearInterval(poll);
    window.removeEventListener('pointerup', endPaint);
    window.removeEventListener('pointercancel', endPaint);
    window.removeEventListener('beforeunload', beforeUnload);
  };
}
