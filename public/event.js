// The poll page. Phones get two tabs, "Your answer" and "The group"; wide screens show both.
// Option polls and whole-day polls are answered as a list (yes / if needed / no per row);
// hours polls are painted on a grid.

import {
  YES,
  IF_NEEDED,
  addDays,
  allDaySpan,
  eventWindows,
  isDaysPoll,
  isOptionsPoll,
  isPartsPoll,
  meetingEnd,
  partOf,
  rankTimes,
  slotEnd,
  utcToZoned,
  isEmail,
} from './core.js';
import { inviteText } from './invite.js';
import { cycleGroup, groupState } from './day-parts.js';
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
  track,
  isPhone,
} from './ui.js';
import { fmtTimeRange, fmtWhen } from './when.js';

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
  // The organizer's tools (Pick, editing, notifications) are for the organizer's link: their private
  // link, or this tab once they've created the poll. On the plain link they see what guests see, with
  // a button back to their tools. Per tab, so a guest link opened later never shows Pick.
  const orgKey = `venn-organizer:${id}`;
  const organizerView = {
    on() {
      try {
        return sessionStorage.getItem(orgKey) === '1';
      } catch {
        return false;
      }
    },
    set() {
      try {
        sessionStorage.setItem(orgKey, '1');
      } catch {
        /* without storage, only the organizer link itself shows the tools */
      }
    },
  };
  const viaOrganizerLink = !!hash.get('admin') || !!saved(id).justCreated;
  if (viaOrganizerLink) organizerView.set();
  const asOrganizer = () => viaOrganizerLink || organizerView.on();
  // Links in notification emails: stop the emails.
  const unsubscribeToken = hash.get('unsubscribe');
  if (location.hash) history.replaceState(null, '', location.pathname);

  app.innerHTML = '<div class="empty muted">Loading…</div>';

  const st = {
    ev: null,
    tz: localTz, // times in this device's time zone; whole-day polls read their days as dates (below)
    mine: {},
    dirty: false,
    focus: null, // participant id highlighted in the group view
    inspect: null, // slot being inspected in the group heatmap
    touched: new Set(), // rows this visitor explicitly answered (so "No" shows as chosen)
    tab: null,
    orgOpen: null, // organizer tools open? Closed until wanted.
  };
  // The edit token also gets your own answer back when the organizer hides everyone's answers.
  const authHeaders = ({ adminToken: a, editToken: e } = saved(id)) => ({
    ...(a && asOrganizer() && { 'x-admin-token': a }),
    ...(e && { 'x-edit-token': e }),
  });

  async function load() {
    st.ev = await api(`events/${id}`, { headers: authHeaders() });
    if (st.ev.retro) import('./retro-look.js').then((m) => m.retroLook(st.ev.retro));
    else document.documentElement.classList.remove('retro');
    if (!st.ev.isAdmin && saved(id).adminToken && asOrganizer()) forget(id, 'adminToken');
    // With the organizer link on another device, the organizer's own answer is still theirs.
    if (st.ev.isAdmin && !saved(id).participantId && st.ev.participants.some((p) => p.id === st.ev.hostId))
      save(id, { participantId: st.ev.hostId });
    const mine = st.ev.participants.find((p) => p.id === saved(id).participantId);
    if (!mine && saved(id).participantId) forget(id, 'participantId', 'editToken');
    return mine;
  }

  try {
    const mine = await load();
    if (mine) st.mine = { ...mine.availability };
    // Everything in a saved answer counts as answered, its "no"s included.
    if (mine) for (const s of st.ev.slots) st.touched.add(String(s));
    // A saved answer with nothing marked means "none of these work".
    st.declined = !!mine && !Object.keys(mine.availability).length;
  } catch (e) {
    document.title = e.status === 404 ? 'Poll not found · Venn' : 'Venn';
    app.innerHTML =
      e.status === 404
        ? `<div class="sheet empty"><h1>Poll not found</h1><p class="muted">This poll may have been deleted, or the link wasn't copied in full. Check the link with whoever sent it.</p><a class="btn btn-primary" href="/new" data-link>Create a Venn</a></div>`
        : `<div class="sheet empty"><h1>Can't open this poll</h1><p class="muted">${esc(e.message)}</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
    if (e.status === 404) import('./finn.js').then((m) => m.lost(app.querySelector('.sheet'))).catch(() => {});
    return () => {};
  }

  const ev = () => st.ev;
  // Organizer-only code (their tools, panels and AI summary) is in a module guests never download,
  // and "Add to your calendar" in one that loads once there's a date to add.
  let calJs = null;
  const loadCal = () => import('./add-to-calendar.js').catch(() => ({ addToCalendar: () => '' })).then((m) => (calJs = m));
  const [org] = await Promise.all([
    st.ev.isAdmin ? import('./organizer.js').catch(() => null) : null,
    st.ev.finalStart != null && loadCal(),
  ]);
  document.title = `${ev().title} · Venn`;
  track('view', { page: 'poll', as: ev().isAdmin ? 'organizer' : saved(id).participantId ? 'answered' : 'guest' });
  const shareUrl = `${location.origin}/e/${id}`;
  const optionsMode = isOptionsPoll(ev());
  const daysMode = isDaysPoll(ev());
  // A date is the same date everywhere: whole days are read in the poll's own zone, where each runs
  // midnight to midnight, so nobody sees "3:00 AM – 3:00 AM".
  if (daysMode) st.tz = ev().timezone;
  const listMode = optionsMode || daysMode; // answered row by row
  const windows = eventWindows(ev());
  const partsMode = isPartsPoll(ev()); // people tap the mornings, afternoons and evenings they're available
  // Options inside a single day can also be shown on a calendar, next to the guest's busy times.
  const calendarOk =
    optionsMode &&
    !partsMode &&
    windows.every(
      (w) => !allDaySpan(w.start, w.end, ev().timezone) && utcToZoned(w.start, st.tz).date === utcToZoned(w.end - 1, st.tz).date,
    );
  // Guests always answer on the list; the organizer can also see the options on a calendar.
  const guest = !ev().isAdmin;
  const viewSwitch = !guest && (calendarOk || daysMode);
  /** Whole days are dates, read in the poll's zone; any other time is read in this device's zone. */
  const zoneOf = (s, e) => (allDaySpan(s, e, ev().timezone) ? ev().timezone : st.tz);
  /** How an option reads: "Sat, Nov 7, evening (6 – 10 PM)" when it's a part of the viewer's day, otherwise its date and time. */
  const when = (s, e) => {
    const p = partsMode && partOf(s, e, st.tz);
    return p
      ? `${fmtDay.format(dateParts(utcToZoned(s, st.tz).date))}, ${p.label.toLowerCase()} (${shortRange(p.start, p.end)})`
      : fmtWhen(s, e, zoneOf(s, e));
  };
  /** `when` as HTML for big type: the times of a day kept together ("Fri, Nov 6," then "7:00 – 9:00 PM"). */
  const bigWhen = (s, e) => {
    const tz = zoneOf(s, e);
    const d = utcToZoned(s, tz).date;
    return partsMode || allDaySpan(s, e, tz) || d !== utcToZoned(e - 1, tz).date
      ? esc(when(s, e)).replace(/\s–/g, '\u00a0–') // a line never starts with the dash
      : [`${fmtDay.format(dateParts(d))},`, fmtTimeRange(s, e, tz)]
          .map((t) => `<span style="white-space:nowrap">${esc(t)}</span>`)
          .join(' ');
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
  // The organizer starts on the group (where Pick and the results are), with their own answer as one
  // line until they choose to change it. Everyone else opening the poll starts on their answer, even
  // when they've given it before; the group is a tap away, and shows once they send it.
  st.tab = ev().isAdmin ? 'group' : 'mine';
  st.orgCompact = ev().isAdmin && !!me();

  // The poll's own picture (poll-image.js), in place of its emoji.
  const picture = ev().image && `/api/events/${encodeURIComponent(id)}/icon.jpg?v=${ev().image.v}`;
  // "Yes to all", "None of these work" and "Clear": above the options for the organizer, under them for guests.
  const quickPills = `<button type="button" class="pill pill-quiet" id="fill">Yes to all</button>
    <button type="button" class="pill pill-quiet" id="decline">None of these work</button>
    <button type="button" class="pill pill-quiet" id="none">Clear</button>`;
  app.innerHTML = `
    <article id="event-root" class="poll">
      ${guest ? '' : `<p class="retro-top"><label class="switch"><input type="checkbox" role="switch" id="retro-top"${ev().retro ? ' checked' : ''}> Retro look</label></p>`}
      <header class="poll-head">
        <span class="emoji-tile big" aria-hidden="true">${picture ? `<img src="${esc(picture)}" alt="">` : esc(ev().emoji || '🗓️')}</span>
        <div class="poll-head-text">
          <h1 id="ev-title"></h1>
          <p class="poll-meta" id="ev-meta"></p>
          <div id="ev-details"></div>
        </div>
        ${guest ? '' : `<div class="poll-share"><button class="btn btn-primary" id="copy">Copy link</button>${canShare ? '<button class="btn" id="share-sheet">Share</button>' : ''}</div>`}
      </header>
      ${
        guest && saved(id).adminToken
          ? `<p class="org-switch"><span>You made this poll. This is what your guests see.</span><button type="button" class="btn btn-sm" id="org-view">Organizer view</button></p>`
          : ''
      }
      <div id="banners"></div>
      <div id="notify-box"></div>
      <div id="privacy-box"></div>
      <div id="writer-box"></div>
      <div class="tabs" role="tablist" aria-label="Poll">
        <button type="button" role="tab" id="tab-mine" aria-controls="panel-mine" data-tab="mine">Your answer</button>
        <button type="button" role="tab" id="tab-group" aria-controls="panel-group" data-tab="group">The group <span class="count" id="group-count"></span></button>
      </div>
      <div class="panels">
        <section class="panel sheet" id="panel-mine" role="tabpanel" aria-labelledby="tab-mine">
          <h2 class="panel-title">${
            ev().finalStart != null
              ? 'The date is picked. Can you make it?'
              : listMode
                ? daysMode
                  ? `Which days are you available?${ev().durationMinutes > 1440 ? ` We need ${lengthLabel(ev().durationMinutes)} in a row.` : ''}`
                  : 'Which of these work for you?'
                : 'When are you available?'
          }</h2>
          <div class="final-answer" id="answer-final" role="group" aria-label="Can you make it?" hidden>
            <button type="button" class="btn" data-final-vote="${YES}">Yes</button>
            <button type="button" class="btn" data-final-vote="${IF_NEEDED}">If needed</button>
            <button type="button" class="btn" data-final-vote="0">No</button>
          </div>
          <div id="answer-full">
          <div class="quick-actions" id="quick-top"${guest ? ' hidden' : ''}>
            ${optionsMode ? '<button type="button" class="pill" id="ai-answer-btn" hidden aria-expanded="false" aria-controls="ai-answer">Answer for me</button>' : ''}
            ${guest ? '' : quickPills}
          </div>
          ${optionsMode ? '<div id="ai-answer" class="ai-panel" hidden></div>' : ''}
          ${
            viewSwitch
              ? `<div class="seg mine-view" role="radiogroup" aria-label="Show the options as">
                        <button type="button" role="radio" data-mine-view="list">List</button>
                        <button type="button" role="radio" data-mine-view="calendar">Calendar</button>
                      </div>`
              : ''
          }
                ${partsMode ? '<p class="hint legend"><span class="sw sw-y"></span>Tap: available <span class="sw sw-m"></span>Tap again: if needed <span class="sw sw-n"></span>Tap again: unavailable</p>' : ''}
                <div id="mine" class="rows"></div>
                <div id="mine-cal" hidden></div>
          ${guest ? `<div class="quick-actions">${quickPills}</div>` : ''}
          </div>
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
            <label for="copy-to">Your email <span class="muted" id="copy-why">(${ev().requireEmail ? 'only the organizer sees it' : 'optional'})</span></label>
            <input id="copy-to" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@example.com">
            <label class="check" hidden><input type="checkbox" id="copy-me" checked> Email me a copy</label>
          </div>
          ${privacy && `<p class="hint">🔒 ${privacy}</p>`}
          <div class="save-bar">
            <div>
              <span id="save-state" class="hint"></span>
              <div class="error" id="save-err" role="alert"></div>
            </div>
            <button type="button" class="btn btn-primary" id="save">Submit</button>
          </div>
          <dialog class="submit-check" id="submit-check" aria-labelledby="sc-h"></dialog>
        </section>
        <section class="panel" id="panel-group" role="tabpanel" aria-labelledby="tab-group">
          ${hideAll ? `<p class="sheet">🔒 ${privacy} You'll see the date at the top once they pick it.</p>` : ''}
          <div class="sheet"${hideAll ? ' hidden' : ''}>
            <div class="sheet-head">
              <h2 class="panel-title" id="best-h">${optionsMode ? 'Best option' : daysMode ? 'Best date' : 'Best time'}</h2>
              <button type="button" class="pill" id="ai-summary-btn" hidden>Summarize with AI</button>
            </div>
            <div id="ai-summary"></div>
            <div id="best"></div>
          </div>
          <div class="sheet"${hideAll ? ' hidden' : ''}>
            <div class="sheet-head">
              <h2 class="panel-title" id="group-h">Everyone's answers</h2>
              ${
                listMode
                  ? ''
                  : `<div class="seg ov-views" role="radiogroup" aria-label="Show everyone's answers as">
                      <button type="button" role="radio" data-gview="list">List</button>
                      <button type="button" role="radio" data-gview="grid">Grid</button>
                    </div>`
              }
            </div>
            <div class="people" id="people" role="group" aria-label="People who answered"></div>
            <div id="overlap"></div>
            ${
              listMode
                ? ''
                : `<div id="grid-wrap" hidden><div class="grid-scroll"><div class="grid readonly" id="group" role="group" aria-label="Everyone's availability"></div></div>
                   <div class="legend" id="legend"></div>
                   <div class="hover-info" id="inspect"></div></div>`
            }
          </div>
          <aside class="sheet grow-card" id="grow" hidden>
            <p><b>Planning something yourself?</b> Make your own Venn in a minute. It's free, and nobody needs an account.</p>
            <a class="btn btn-primary" href="/new" data-link>Create your own Venn</a>
          </aside>
        </section>
      </div>
      ${
        // Guests came to answer: passing the link on waits at the bottom, under everything else.
        guest
          ? `<p class="poll-share guest-share muted" style="text-align:center;margin:16px 0 0">Know someone who should answer too? <button type="button" class="link-btn" id="copy">Copy the link</button></p>`
          : ''
      }
    </article>`;

  // Back to the organizer's tools: the same as opening the organizer link.
  const orgView = $('#org-view');
  if (orgView)
    orgView.onclick = () => {
      location.replace(`${location.pathname}#admin=${saved(id).adminToken}`);
      location.reload();
    };

  // Copy link is the bare link, which chat apps unfurl; the share sheet sends a short nudge with it.
  const shareSheet = () => {
    track('share', { how: 'sheet', from: 'poll' });
    const { title, emoji, organizer, finalStart } = ev();
    // With its own picture, a poll has no emoji to show.
    const text = inviteText({
      title,
      emoji: picture ? '' : emoji,
      organizer,
      pick: optionsMode && !partsMode,
      set: finalStart != null,
    });
    navigator.share({ title, text, url: shareUrl }).catch(() => {});
  };
  org?.retroSwitch({ id, headers: authHeaders(), ev: st.ev });
  $('#copy').onclick = () => {
    track('share', { how: 'copy', from: 'poll' });
    copy(shareUrl, 'Link copied');
  };
  if ($('#share-sheet')) $('#share-sheet').onclick = shareSheet;
  $('#name').value = me()?.name || lastName();
  $('#name').oninput = () => setDirty(true);

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
    if (t === 'group' && !listMode && !partsMode) showBest();
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
  let LG;
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
  }

  // `cellAttrs(slot)` adds the role and state: toggle buttons in your grid, labelled images in the group heatmap.
  function gridHtml(cellClass, cellAttrs = () => '', layout = LG) {
    const { dates, mins, at } = layout;
    const labelEvery = ev().slotMinutes >= 60 ? ev().slotMinutes : 60;
    let h = '<div></div>';
    for (const d of dates) {
      const dt = dateParts(d);
      h += `<div class="day-label"><b>${fmtDow.format(dt)}</b>${fmtMonthDay.format(dt)}</div>`;
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
  const gridCols = (layout = LG) => `auto repeat(${layout.dates.length}, minmax(38px, 1fr))`;
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
  const hasAnswer = () => Object.values(st.mine).some((v) => v > 0) || st.declined || st.touched.size > 0;
  function renderPicks() {
    const box = $('#my-picks');
    const label = (v) =>
      partsMode
        ? windows.filter((w) => st.mine[w.start] === v).map((w) => when(w.start, w.end))
        : rows()
            .filter((r) => groupState(st.mine, r.slots) === v)
            .map((r) => `${fmtDay.format(dateParts(utcToZoned(r.start, st.tz).date))}, ${fmtTimeRange(r.start, r.end, st.tz)}`);
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
    const rest = units().length - yes.length - maybe.length;
    const left = unanswered();
    box.innerHTML = `<p><b>Your answer:</b> ${esc(counts)}${rest > 0 ? `, no to ${rest === 1 ? 'the other one' : `the other ${rest}`}` : ''}${left ? ` <span class="dirty">(${left} not answered, counted as no)</span>` : ''}</p>
      <div class="chips">${shown}${chips.length > max ? `<span class="chip">+${chips.length - max} more</span>` : ''}</div>`;
  }

  /** The date block on the left of a row: weekday, big day number, month. */
  const dateBlock = (d) => {
    const dt = dateParts(d);
    // Whole-day and parts-of-the-day polls name the weekday in the row itself.
    return `<span class="date-block" aria-hidden="true">${daysMode || partsMode ? '' : `<small>${esc(fmtDow.format(dt))}</small>`}<b>${dt.getUTCDate()}</b><small>${esc(dt.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }))}</small></span>`;
  };

  // Every poll is answered a row at a time. An hours poll's row is a stretch of time the organizer
  // offered (its half hours run together on one day), and its answer goes to each of those times.
  const rows = () => {
    if (listMode) return windows.map((w) => ({ ...w, slots: [w.start] }));
    const out = [];
    for (const s of ev().slots) {
      const last = out.at(-1);
      if (last?.end === s && utcToZoned(s, st.tz).date === utcToZoned(last.start, st.tz).date) {
        last.end = slotEnd(ev(), s);
        last.slots.push(s);
      } else out.push({ start: s, end: slotEnd(ev(), s), slots: [s] });
    }
    return out;
  };
  let rowSlots = new Map();
  function renderMineList() {
    let prev = null;
    const rs = rows();
    rowSlots = new Map(rs.map((r) => [String(r.start), r.slots]));
    mineEl.innerHTML = rs
      .map((w) => {
        const d = utcToZoned(w.start, st.tz).date;
        const first = d !== prev;
        prev = d;
        const isFinal = ev().finalStart != null && w.start <= ev().finalStart && ev().finalStart < w.end;
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
      const d = utcToZoned(w.start, zoneOf(w.start, w.end)).date;
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
            ${ws.length > 1 ? allDayBtn(`data-all-day="${d}"`, d) : ''}</div>
          <div class="part-votes">${ws
            .map((w) => {
              const p = partOf(w.start, w.end, st.tz);
              const [name, time] = p
                ? [p.label, shortRange(p.start, p.end)]
                : allDaySpan(w.start, w.end, ev().timezone)
                  ? ['All day', '']
                  : [fmtTimeRange(w.start, w.end, st.tz), ''];
              return `<button type="button" class="part-vote${w.start === ev().finalStart ? ' final' : ''}" data-opt="${w.start}"><b>${esc(name)}</b>${time ? `<small>${esc(time)}</small>` : ''}<span class="pv-state"></span></button>`;
            })
            .join('')}</div>
        </div>`,
      )
      .join('');
    refreshMineParts();
  }
  function refreshMineParts() {
    // Pressed: true = available, mixed = if needed. The state is also written out for screen readers.
    for (const b of $$('.part-vote', mineEl)) $('.pv-state', b).innerHTML = showState(b, allState([b.dataset.opt]));
    for (const b of $$('[data-all-day]', mineEl)) showAllDay(b, partsOfDay(b.dataset.allDay));
  }
  const partsOfDay = (d) =>
    byDay()
      .get(d)
      .map((w) => String(w.start));

  // ----- "All day": a shortcut that marks every part of a day at once, stored as those parts -----
  /** The button, after a row's date. `attrs` says which day it's for. */
  const allDayBtn = (attrs, d) =>
    `<button type="button" class="all-day" ${attrs}><span class="ad-mark" aria-hidden="true"></span>All day<span class="sr-only">, ${esc(fmtDay.format(dateParts(d)))}</span></button>`;
  /** Like groupState, plus 'no' once every one of `slots` has been answered and none is marked:
   * unavailable, which isn't the same as not answered yet. */
  const allState = (slots) => {
    const v = groupState(st.mine, slots);
    return v === 0 && slots.every((s) => st.touched.has(String(s))) ? 'no' : v;
  };
  /** A part of the day's state, shown on its button and said by screen readers. */
  const STATE = {
    [YES]: ['true', '✓ Available'],
    [IF_NEEDED]: ['mixed', '~ If needed'],
    no: ['false', '✕ Unavailable'],
  };
  function showState(b, v) {
    b.dataset.v = v;
    const [pressed, text] = STATE[v] || ['false', '<span class="sr-only">Not answered</span>'];
    b.setAttribute('aria-pressed', pressed);
    return text;
  }
  function showAllDay(b, slots) {
    const v = allState(slots);
    showState(b, v);
    $('.ad-mark', b).textContent = v === YES ? '✓' : v === IF_NEEDED ? '~' : v === 'no' ? '✕' : '';
  }
  /** All available → all if needed → all unavailable → all available. */
  function cycleAll(slots) {
    cycleGroup(st.mine, slots);
    for (const s of slots) st.touched.add(String(s));
    refreshMine();
    changed();
  }
  /** Not answered or unavailable → available → if needed → unavailable. */
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
      if (day) cycleAll(partsOfDay(day.dataset.allDay));
    });

  // ----- the calendar view of the options -----
  let calView = null;
  let timeView = null;
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
    if (!viewSwitch) return;
    for (const b of $$('[data-mine-view]')) b.setAttribute('aria-checked', b.dataset.mineView === st.mineView);
    const cal = st.mineView === 'calendar';
    mineEl.hidden = cal;
    $('#mine-cal').hidden = !cal;
    if (!cal) return;
    if (calView) return calView.render();
    if (daysMode) return renderDays();
    // The calendar's code loads the first time someone opens it; most people answer on the list.
    if (!timeView) return void import('./picker.js').then((m) => ((timeView = m.timeView), renderMineView()));
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
  // ----- whole days, on a month calendar of the poll's days (day-answer.js, loaded when shown) -----
  let dayJs = null;
  function renderDays() {
    if (!dayJs)
      return void import('./day-answer.js').then(
        (m) => ((dayJs = m), $('#mine-cal') && renderMineView()),
        () => ((st.mineView = 'list'), renderMineView()),
      );
    calView = dayJs.dayAnswer($('#mine-cal'), {
      days: windows.map((w) => ({ key: w.start, date: utcToZoned(w.start, ev().timezone).date })),
      value: (s) => st.mine[s] || 0,
      onTap: dayTap,
      final: (s) => finalSet().has(+s),
      span: Math.round(ev().durationMinutes / 1440),
    });
  }
  /**
   * A day on the calendar: available → if needed → blank. Once any day is marked, the blank ones are
   * a no. For a trip, a first tap marks the whole stretch (`trip`, the days' keys) as available.
   */
  function dayTap(s, trip) {
    const v = st.mine[s] || 0;
    if (trip) for (const k of trip) st.mine[k] = YES;
    else if (v === YES) st.mine[s] = IF_NEEDED;
    else if (v === IF_NEEDED) delete st.mine[s];
    else st.mine[s] = YES;
    st.touched.clear();
    if (Object.values(st.mine).some((x) => x > 0)) for (const x of ev().slots) st.touched.add(String(x));
    refreshMine();
    changed();
  }
  $('#panel-mine').addEventListener('click', (e) => {
    const v = e.target.closest('[data-mine-view]');
    if (v) {
      st.mineView = v.dataset.mineView;
      renderMineView();
    }
  });

  function refreshMineList() {
    const people = others().filter((p) => p.id !== me()?.id);
    const answeredBefore = !!me();
    for (const el of $$('[data-opt]', mineEl)) {
      const slots = rowSlots.get(el.dataset.opt) || [el.dataset.opt];
      // An answer from before that marks only some of a row's times shows as neither.
      const v = groupState(st.mine, slots);
      const shown = v === 'some' ? -1 : v > 0 || answeredBefore || st.touched.has(String(slots[0])) ? v : -1;
      el.dataset.v = shown;
      for (const b of $$('[data-vote]', el)) b.setAttribute('aria-checked', +b.dataset.vote === shown);
      const yes = people.filter((p) => groupState(p.availability, slots) === YES).map((p) => p.name);
      const maybe = people.filter((p) => groupState(p.availability, slots) === IF_NEEDED).length;
      $('.row-tally', el).innerHTML =
        yes.length || maybe
          ? `${avatarStack(yes, 4)}<span class="hint">${yes.length ? `${yes.length} yes` : ''}${yes.length && maybe ? ', ' : ''}${maybe ? `${maybe} if needed` : ''}</span>`
          : '';
    }
  }

  if (!partsMode)
    mineEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vote]');
      if (!b) return;
      const row = b.closest('[data-opt]').dataset.opt;
      const v = +b.dataset.vote;
      for (const s of rowSlots.get(row) || [row]) {
        if (v) st.mine[s] = v;
        else delete st.mine[s];
        st.touched.add(String(s));
      }
      refreshMine();
      changed();
    });

  function renderMine() {
    if (partsMode) return renderMineParts();
    renderMineList();
  }
  function refreshMine() {
    calView?.render();
    if (partsMode) return refreshMineParts();
    refreshMineList();
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
    // With "Email me a copy" ticked (it starts ticked), the email is needed for it.
    const needMail = () => {
      const need = ev().requireEmail || (!$('#copy-me').parentNode.hidden && $('#copy-me').checked);
      $('#copy-to').setAttribute('aria-required', need);
      if (!ev().requireEmail) $('#copy-why').textContent = need ? '(for your copy)' : '(optional)';
    };
    $('#copy-me').onchange = needMail;
    needMail();
    if (!c.ai) return;
    aiOn = true;
    if (optionsMode) $('#ai-answer-btn').hidden = $('#quick-top').hidden = false;
    if (ev().isAdmin) $('#ai-summary-btn').hidden = false;
    renderBanners();
  });

  // "Answer for me" loads when it's opened.
  if (optionsMode)
    $('#ai-answer-btn').onclick = async () =>
      (await import('./ai-answer.js')).answerForMe({
        id,
        st,
        done: () => {
          renderMine();
          changed();
        },
      });

  $('#ai-summary-btn').onclick = (e) => org?.summary(e.target, { id, ev: ev(), headers: authHeaders(), when });

  // ----- saving -----
  /** How many rows have no answer yet (they'd count as no). */
  const units = () => (partsMode ? ev().slots.map((s) => [s]) : [...rowSlots.values()]);
  const unanswered = () =>
    st.declined ? 0 : units().filter((sl) => sl.every((s) => !st.mine[s] && !st.touched.has(String(s)))).length;
  /** What's still missing before the answer can be saved, or '' when it can. */
  const needs = () => {
    const name = !$('#name').value.trim();
    const pick = !hasAnswer();
    if (ev().finalStart != null && pick) return name ? 'Add your name and say if you can make it.' : 'Say if you can make it.';
    if (name && pick) return `Add your name and pick at least one ${listMode ? 'option' : 'time'} to submit.`;
    if (name) return 'Add your name to submit.';
    if (pick) return `Pick at least one ${listMode ? 'option' : 'time'} to submit, or choose "None of these work".`;
    return '';
  };
  function setDirty(v) {
    st.dirty = v;
    if (v) $('#save-err').textContent = ''; // an old error goes once the answer changes
    const el = $('#save-state');
    const need = needs();
    $('#save').dataset.ready = !need;
    if (v) {
      // "2 of 14 answered" until every option has an answer, then "Ready to submit" (or what's missing).
      const total = units().length;
      const answered = total - unanswered();
      const count = answered && answered < total ? `${answered} of ${total} answered` : '';
      el.className = need || count ? 'dirty' : 'ok';
      el.textContent = [count, need].filter(Boolean).join('. ') || 'Ready to submit';
    } else {
      el.className = 'hint';
      el.textContent = me() ? 'Submitted' : need;
    }
  }

  /** "Are you sure?" before an answer goes in: who it's from and what it says, then Submit or Go back. */
  function confirmSubmit(name) {
    const d = $('#submit-check');
    d.innerHTML = `<h2 id="sc-h">Submit your answer?</h2>
      <p>Answering as <b>${esc(name)}</b>.${me() ? ' This replaces your last answer.' : ''}</p>
      <div class="sc-picks">${$('#my-picks').innerHTML}</div>
      <div class="sc-actions">
        <button type="button" class="btn" id="sc-no">Go back</button>
        <button type="button" class="btn btn-primary" id="sc-yes">Submit</button>
      </div>`;
    return new Promise((done) => {
      const close = (yes) => {
        d.close();
        done(yes);
      };
      $('#sc-no', d).onclick = () => close(false);
      $('#sc-yes', d).onclick = () => close(true);
      d.oncancel = (e) => {
        e.preventDefault();
        close(false);
      };
      d.onclick = (e) => e.target === d && close(false); // a tap outside the box
      d.showModal();
      $('#sc-yes', d).focus();
    });
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
      (mineEl.hidden ? $('#mine-cal') : mineEl).scrollIntoView({
        behavior: reducedMotion() ? 'auto' : 'smooth',
        block: 'center',
      });
      return;
    }
    const mail = $('#copy-to');
    const okMail = isEmail(mail.value.trim()); // the server's rule
    const wantCopy = !$('#copy-field').hidden && !$('#copy-me').parentNode.hidden && $('#copy-me').checked;
    const badMail = mail.value.trim() ? !okMail : ev().requireEmail || wantCopy;
    mail.setAttribute('aria-invalid', !!badMail);
    if (badMail) {
      err.textContent = mail.value.trim()
        ? 'Check your email address, like name@example.com.'
        : ev().requireEmail
          ? 'Add your email. The organizer asked everyone for one.'
          : 'Add your email for your copy, or untick "Email me a copy".';
      mail.focus();
      return;
    }
    // Someone answering again from another phone would otherwise be counted twice.
    const twin = !me() && ev().participants.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    if (
      twin &&
      !confirm(
        `Someone called ${twin.name} has already answered. If that's you, open your personal link from that phone to change your answer. Answer again as a new person?`,
      )
    )
      return;
    // "Are you sure?" only when some options were left without an answer; a full answer goes straight in.
    if (unanswered() && !(await confirmSubmit(name))) return;
    rememberName(name);
    $('#save').disabled = true;
    try {
      const body = { name, availability: st.mine };
      const email = $('#copy-to').value.trim();
      if (ev().requireEmail) body.email = email;
      const copyTo = wantCopy && email;
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
            headers: authHeaders(),
          });
        } catch (ex) {
          if (ex.status !== 404 && ex.status !== 403) throw ex;
          forget(id, 'participantId', 'editToken');
        }
      }
      // Every answer sent gets a little party; it loads while the answer is sent.
      const party = import('./celebrate.js').catch(() => null);
      if (!saved(id).participantId) {
        // With the organizer link, this is the organizer's own answer.
        const r = await api(`events/${id}/participants`, { method: 'POST', body, headers: authHeaders() });
        save(id, { participantId: r.id, editToken: r.editToken });
        created = true;
      }
      await load();
      setDirty(false);
      if (ev().isAdmin) st.orgCompact = true; // back to one line
      renderAll();
      const sent = `Submitted.${copyTo ? ` A copy is on its way to ${copyTo}.` : ''}`;
      // A party for every answer sent, guests' and the organizer's.
      const host = ev().isAdmin ? '' : ev().organizer;
      const p = (await party)?.celebrate({
        emoji: (!picture && ev().emoji) || '🎉',
        picture,
        heading: created ? 'Answer submitted!' : 'Answer updated!',
        message: ev().isAdmin
          ? 'Your answer is in. Now the fun part: seeing when everyone can make it.'
          : `Finn is so glad you're in. ${host ? `${host} can see it now` : 'Everyone can see it now'}. Thanks for helping bring people together.`,
        button: hideAll ? 'Back to the poll' : 'See everyone’s answers',
        // Guests who enjoyed that are the next organizers: one tap to their own poll of the same kind,
        // with the same plan and their name filled in, and the dates left to them.
        also: ev().isAdmin
          ? null
          : {
              label: 'Planning something? Make yours in 30 seconds',
              href: `/new?from=guest${ev().emoji ? `&template=${encodeURIComponent(ev().emoji)}` : ''}`,
            },
      });
      await p?.shown;
      p?.finish();
      toast(sent);
      if (!$('#save')) return; // they went to make their own poll
      // After the first save here (an organizer's answer may come with the poll), show the group.
      if ((created || !st.savedHere) && !hideAll) {
        st.savedHere = true;
        showTab('group');
        $('#panel-group').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      }
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      if ($('#save')) $('#save').disabled = false;
    }
  };

  $('#leave').onclick = async () => {
    if (!confirm('Remove your answer from this poll?')) return;
    const s = saved(id);
    try {
      await api(`events/${id}/participants/${s.participantId}`, { method: 'DELETE', headers: authHeaders() });
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
    toast('Your answer was removed');
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

  // Everyone's answers as the Venn (overlap.js), with my unsaved edits shown live. It loads just
  // after the page is drawn: guests start on their own answer.
  let overlap = null;
  import('./overlap.js')
    .then((m) => {
      overlap = m;
      renderOverlap();
    })
    .catch(() => {});
  function renderOverlap() {
    const people = others();
    if (!overlap) return;
    $('#overlap').innerHTML = people.length
      ? overlap.overlapHtml({
          ev: ev(),
          people,
          tz: st.tz,
          inspect: st.inspect,
          focus: people.find((p) => p.id === st.focus),
          windows,
          days: daysMode,
          parts: partsMode,
          list: listMode,
          when,
        })
      : '';
  }
  $('#overlap').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ov]');
    if (!b) return;
    st.inspect = String(st.inspect) === b.dataset.ov ? null : b.dataset.ov;
    renderOverlap();
    $(`#overlap [data-ov="${b.dataset.ov}"]`)?.focus();
  });
  // Hours: the list, or the grid of half hours.
  st.gview = 'list';
  function showGroupView() {
    for (const b of $$('[data-gview]')) b.setAttribute('aria-checked', b.dataset.gview === st.gview);
    if ($('#grid-wrap')) $('#grid-wrap').hidden = st.gview !== 'grid';
    $('#overlap').hidden = !listMode && st.gview === 'grid';
  }
  for (const b of $$('[data-gview]'))
    b.onclick = () => {
      st.gview = b.dataset.gview;
      st.inspect = null;
      renderGroup();
    };

  function renderGroup() {
    $('#group-count').textContent = ev().responses ?? (ev().participants.length || '');
    showGroupView();
    renderOverlap();
    if (listMode || st.gview !== 'grid') return;
    const people = others();
    const n = people.length;
    const fs = finalSet();
    const focus = people.find((p) => p.id === st.focus);
    groupEl.style.gridTemplateColumns = gridCols(LG);
    const counts = (s) => [
      people.filter((p) => p.availability[s] === YES).length,
      people.filter((p) => p.availability[s] === IF_NEEDED).length,
    ];
    // Ticks: the best times, as long as the poll asks for, as the card above ranks them.
    const ranked = n ? rankTimes(ev(), ev().slots, people, Infinity) : [];
    const top = ranked[0];
    const tied = top ? ranked.filter((b) => b.yes.length === top.yes.length && b.ifNeeded.length === top.ifNeeded.length) : [];
    const inBest = (s) => tied.some((b) => +s >= b.start && +s < b.end);
    const all = top?.yes.length === n;
    // Each cell says, in words, what its colours show.
    const groupLabel = (s) => {
      const [yes, maybe] = counts(s);
      const no = n - yes - maybe;
      const when = fmtWhen(s, slotEnd(ev(), s), st.tz);
      const best = inBest(s) ? (all ? ". Everyone's available" : '. Part of the best time') : '';
      return `role="img" aria-label="${esc(`${when}: ${yes} of ${n} available${maybe ? `, ${maybe} if needed` : ''}${no ? `, ${no} unavailable` : ''}${best}`)}"`;
    };
    groupEl.innerHTML = gridHtml(
      (s) => {
        let cls = fs.has(s) ? 'final' : '';
        if (String(s) === String(st.inspect)) cls += ' active';
        if (focus) cls += focus.availability[s] === YES ? ' yes' : focus.availability[s] === IF_NEEDED ? ' maybe' : '';
        else if (inBest(s)) cls += all ? ' best all' : ' best';
        return cls;
      },
      groupLabel,
      LG,
    );
    // Each cell shows its mix, in proportion: available, if needed, then unavailable.
    if (!focus && n)
      for (const el of $$('.cell[data-slot]', groupEl)) {
        const [yes, maybe] = counts(el.dataset.slot);
        const a = (100 * yes) / n;
        const b = (100 * (yes + maybe)) / n;
        el.style.background = `linear-gradient(90deg, var(--yes) ${a}%, var(--maybe) ${a}% ${b}%, var(--no-cell) ${b}%)`;
      }
    $('#legend').innerHTML = focus
      ? `<span>Showing <b>${esc(focus.name)}</b></span><span><span class="swatch swatch-yes"></span> available</span><span><span class="swatch swatch-maybe"></span> if needed</span><button class="link-btn" id="unfocus">Show everyone</button>`
      : n
        ? `<span><span class="sw sw-y"></span>Available</span><span><span class="sw sw-m"></span>If needed</span><span><span class="sw sw-nc"></span>Unavailable</span>${
            top
              ? `<span><span class="sw-best" aria-hidden="true">✓</span>${all ? "Everyone's available" : 'Best time'}</span>`
              : ''
          }`
        : '';
    if ($('#unfocus'))
      $('#unfocus').onclick = () => {
        st.focus = null;
        renderGroup();
        renderPeople();
      };
    renderInspect();
    showBest();
  }

  /** Once: scroll the first tick into view, if it's past a phone's right edge. */
  function showBest() {
    const box = groupEl.parentElement;
    const cell = $('.cell.best', groupEl);
    if (st.shownBest || !cell || !box.clientWidth) return;
    st.shownBest = true;
    const past = cell.getBoundingClientRect().right - box.getBoundingClientRect().right;
    if (past > 0) box.scrollLeft += past + 8;
  }

  function renderInspect() {
    const box = $('#inspect');
    if (!box) return;
    const people = others();
    if (!people.length) return (box.innerHTML = '');
    if (st.inspect == null) return (box.innerHTML = '');
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
        ${canPick ? `<button class="btn btn-sm" data-pick="${s}">${ev().finalStart != null ? 'Pick this start time instead' : 'Pick this start time'}</button>` : ''}
      </div>
      <div class="chips">${chips(yes, 'yes')}${chips(maybe, 'maybe')}${chips(no, 'no')}</div>`;
  }
  if (!listMode) {
    const inspectFrom = (e) => {
      const el = e.target.closest('.cell[data-slot]');
      if (!el || el.dataset.slot === String(st.inspect)) return;
      $('.cell.active', groupEl)?.classList.remove('active');
      el.classList.add('active');
      st.inspect = el.dataset.slot;
      renderInspect();
      if (e.type === 'click') $('#inspect').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    };
    groupEl.addEventListener('pointerover', inspectFrom);
    groupEl.addEventListener('click', inspectFrom);
  }

  // A big group: the first few, then "+N more".
  const PEOPLE_SHOWN = 6;
  function renderPeople() {
    const myId = me()?.id;
    const all = ev().participants;
    const fold = all.length > PEOPLE_SHOWN + 1;
    // You, and whoever's on the grid, stay.
    const shown = fold && !st.allPeople ? all.filter((p, i) => i < PEOPLE_SHOWN || p.id === myId || p.id === st.focus) : all;
    const more =
      shown.length < all.length
        ? `<button type="button" class="link-btn" id="people-more">+${all.length - shown.length} more</button>`
        : '';
    const focused = all.find((p) => p.id === st.focus);
    $('#people').innerHTML =
      shown
        .map((p) => {
          return `<span class="chip person${p.id === myId ? ' me' : ''}"><button type="button" class="person-btn" data-person="${esc(p.id)}" aria-pressed="${p.id === st.focus}">${avatar(p.name, 'av-xs')}${esc(p.name)}${p.id === myId ? ' (you)' : ''}</button></span>`;
        })
        .join('') +
      more +
      // The organizer removes someone's answer from them, once tapped: no × on every name.
      (ev().isAdmin && focused && focused.id !== myId
        ? `<button type="button" class="link-btn danger people-rm" data-remove="${esc(focused.id)}">Remove ${esc(focused.name)}'s answer</button>`
        : '');
  }
  $('#people').addEventListener('click', async (e) => {
    if (e.target.closest('#people-more')) {
      st.allPeople = true;
      renderPeople();
      // Focus moves to the first one that was hidden.
      return $$('#people .person-btn')[PEOPLE_SHOWN]?.focus();
    }
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
      $(`#people [data-person="${CSS.escape(chip.dataset.person)}"]`)?.focus();
    }
  });

  // ----- best options -----
  function renderBest() {
    // Once the date is picked, the banner at the top says it: no need for the ranking too.
    const sheet = $('#best').closest('.sheet');
    sheet.hidden = hideAll || ev().finalStart != null;
    if (sheet.hidden) return;
    const people = others();
    const best = rankTimes(ev(), ev().slots, people, 1);
    const n = people.length;
    // Until a guest answers, the only answer is the organizer's own.
    const guests = people.some((p) => p.id !== ev().hostId);
    if (!n) {
      $('#best').innerHTML = `<div class="empty-state">
        <div class="venn-art" aria-hidden="true"><i></i><i></i><i></i></div>
        <p><b>No answers yet.</b></p>
        <button class="btn" data-share>${canShare ? 'Share the poll' : 'Copy invite link'}</button>
      </div>`;
      return;
    }
    if (!best.length) {
      $('#best').innerHTML = '<p class="hint">Nothing works for anyone yet.</p>';
      return;
    }
    // The best one; every other is in everyone's answers just below, once.
    const [first] = best;
    const who = (b) => {
      const can = b.yes.length + b.ifNeeded.length;
      if (can === n && !b.ifNeeded.length) return n === 1 ? 'Works for the one person so far' : `Everyone can make it`;
      if (can === n && n > 1 && !b.yes.length) return `All ${n} can make it if needed`;
      return `${can} of ${n} can make it${b.ifNeeded.length ? `, ${b.ifNeeded.length} if needed` : ''}`;
    };
    const pick = (b) =>
      ev().finalStart === b.start
        ? '<span class="badge-final">✓ Picked</span>'
        : ev().isAdmin
          ? `<button class="btn btn-sm" data-pick="${b.start}">Pick</button>`
          : '';
    // Everyone by their full name, so the organizer knows exactly who can come; long lists fold.
    const names = (b) => {
      const list = [...b.yes.map(esc), ...b.ifNeeded.map((x) => `${esc(x)} <span class="muted">(if needed)</span>`)];
      return list.length ? `<p class="names"><span class="sr-only">Can make it: </span>${list.join(', ')}</p>` : '';
    };
    const missing = (b) => (b.no.length ? `<p class="hint">Can't make it: ${b.no.map(esc).join(', ')}</p>` : '');
    // From 5 people, names are a tap away.
    const big = n >= 5;
    const whoList = (b) =>
      big
        ? `<details class="reveal who-list"><summary>See who</summary>${names(b)}${missing(b)}</details>`
        : names(b) + missing(b);
    const lenNote = !optionsMode && ev().durationMinutes > ev().slotMinutes ? ` (${lengthLabel(ev().durationMinutes)})` : '';
    $('#best').innerHTML = `
      ${ev().isAdmin && !guests ? `<p class="hint only-you">Only your answer so far.</p>` : ''}
      <div class="best-hero${ev().finalStart === first.start ? ' final' : ''}">
        <div class="best-when">${bigWhen(first.start, first.end)}${esc(lenNote)}</div>
        <div class="best-who">${avatarStack([...first.yes, ...first.ifNeeded], 7)}<span>${esc(who(first))}</span></div>
        ${whoList(first)}
        ${pick(first) ? `<div class="btn-row">${pick(first).replace('btn btn-sm', guests ? 'btn btn-primary' : 'btn')}</div>` : ''}
      </div>`;
  }

  // ----- picking the final time -----
  $('#event-root').addEventListener('click', async (e) => {
    if (e.target.closest('[data-share]')) return canShare ? shareSheet() : $('#copy').click();
    // Change the date: the next best dates, right in the banner, each with Pick.
    if (e.target.closest('#change-date, #change-cancel')) {
      st.changing = !!e.target.closest('#change-date');
      renderBanners();
      return (st.changing ? $('#change-list [data-pick]') || $('#change-cancel') : $('#final-h'))?.focus();
    }
    const btn = e.target.closest('[data-pick], #unpick');
    if (!btn) return;
    const start = btn.id === 'unpick' ? null : +btn.dataset.pick;
    const was = ev().finalStart;
    // Picking tells everyone: the date, big, and who can make it, before it goes out.
    if (start != null && !(await confirmPick(start))) return btn.isConnected && btn.focus();
    st.changing = false;
    try {
      await api(`events/${id}/finalize`, { method: 'POST', body: { start }, headers: authHeaders() });
      await load();
      st.celebrate = start != null;
      renderAll();
      if (start != null) $('#banners').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      if (start == null) toast('Date cleared. Pick another one below.');
      else if (was != null) toast('Date changed. Let everyone know, so they can update their calendars.');
    } catch (ex) {
      toast(ex.message);
    }
  });

  /** "Pick this date?": the date in big type and who can make it, then Pick it or Back. */
  function confirmPick(start) {
    let d = $('#pick-check');
    if (!d) {
      d = document.createElement('dialog');
      d.className = 'submit-check pick-check';
      d.id = 'pick-check';
      d.setAttribute('aria-labelledby', 'pc-h');
      document.body.append(d);
    }
    const people = others();
    const r = rankTimes(ev(), ev().slots, people, Infinity).find((x) => x.start === start);
    const end = r ? r.end : meetingEnd(ev(), start);
    const can = r ? r.yes.length + r.ifNeeded.length : 0;
    const changing = ev().finalStart != null;
    d.innerHTML = `<h2 id="pc-h">${changing ? 'Change the date to this?' : `Pick this ${daysMode ? 'date' : 'time'}?`}</h2>
      <p class="pc-when">${bigWhen(start, end)}</p>
      <p>${can} of ${people.length} can make it${r?.ifNeeded.length ? `, ${r.ifNeeded.length} if needed` : ''}.${
        r?.no.length ? ` <span class="muted">Can't: ${r.no.map(esc).join(', ')}</span>` : ''
      }</p>
      ${changing ? '<p class="hint">Anyone who added the old date to their calendar will need to update it.</p>' : ''}
      <div class="sc-actions">
        <button type="button" class="btn" id="pc-no">Back</button>
        <button type="button" class="btn btn-primary" id="pc-yes">${changing ? 'Change it' : 'Pick it'}</button>
      </div>`;
    return new Promise((done) => {
      const close = (yes) => {
        d.close();
        done(yes);
      };
      $('#pc-no', d).onclick = () => close(false);
      $('#pc-yes', d).onclick = () => close(true);
      d.oncancel = (e) => {
        e.preventDefault();
        close(false);
      };
      d.onclick = (e) => e.target === d && close(false); // a tap outside the box
      d.showModal();
      $('#pc-yes', d).focus();
    });
  }

  // ----- organizer: notifications and privacy, from a module only organizers load -----
  const panels = {}; // which organizer panels are open: notify, privacy, writer
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

  // ----- header, banners -----
  function renderHeader() {
    $('#ev-title').textContent = ev().title;
    // The host is already "Hosted by": the count is everyone else who answered.
    const guests = ev().participants.filter((p) => p.id !== ev().hostId);
    const n = (ev().responses ?? ev().participants.length) - (ev().participants.length - guests.length);
    const by = ev().organizer
      ? `<span class="host">${avatar(ev().organizer, 'av-xs')}Hosted by ${esc(ev().organizer)}</span>`
      : '';
    const count = n
      ? `<span class="answered">${avatarStack(
          guests.map((p) => p.name),
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
  }

  /** Change the date: the next best dates, each with its count and Pick, and a way back. */
  function changeList(picked) {
    const people = others();
    const n = people.length;
    const next = rankTimes(ev(), ev().slots, people, 6)
      .filter((b) => b.start !== picked)
      .slice(0, 5);
    const rows = next
      .map(
        (
          b,
        ) => `<li><span><b>${esc(when(b.start, b.end))}</b><small>${b.yes.length + b.ifNeeded.length} of ${n} can make it</small></span>
          <button type="button" class="btn btn-sm" data-pick="${b.start}">Pick</button></li>`,
      )
      .join('');
    return `<div class="change-list" id="change-list">
      <p class="kicker">Change the date to</p>
      ${rows ? `<ol>${rows}</ol>` : '<p>No other date works for anyone yet.</p>'}
      <p class="change-ends"><button type="button" class="link-btn" id="change-cancel">Keep this date</button>
        <button type="button" class="link-btn" id="unpick">Clear the date</button></p>
    </div>`;
  }

  function renderBanners() {
    let h = '';
    if (ev().finalStart != null) {
      const start = ev().finalStart;
      const end = meetingEnd(ev(), start);
      const info = {
        title: ev().title,
        // The event's own note says where it was planned: how the next organizer finds Venn.
        description: [ev().description, shareUrl, `Planned with Venn: ${location.origin}/new`].filter(Boolean).join('\n\n'),
        location: ev().location,
        start,
        end,
        allDay: allDaySpan(start, end, ev().timezone),
        image: picture && { url: location.origin + picture, type: ev().image.type },
      };
      if (!calJs) return void loadCal().then(renderBanners); // the date was just picked
      const day = utcToZoned(start, info.allDay ? ev().timezone : st.tz).date.slice(8);
      // Everyone who gave their email (the organizer sees them when the poll asked for them): invited
      // with the calendar, and one tap from an email to them all, in BCC so they don't see each other's.
      const guests = ev().isAdmin
        ? ev()
            .participants.filter((p) => p.email && p.id !== ev().hostId)
            .map((p) => ({ name: p.name, email: p.email }))
        : [];
      const mailAll =
        guests.length &&
        `mailto:?bcc=${guests.map((g) => encodeURIComponent(g.email)).join(',')}&subject=${encodeURIComponent(
          `It's set: ${ev().title}`,
        )}&body=${encodeURIComponent(`It's set: ${ev().title}, ${when(start, end)}.\n\nAdd it to your calendar: ${shareUrl}\n`)}`;
      const cal = calJs.addToCalendar({ id, info, day, url: shareUrl, guests });
      // One or two big next steps, the rest under More.
      h += `<section class="banner-final${st.celebrate && !reducedMotion() ? ' celebrate' : ''}" aria-labelledby="final-h">
        <p class="kicker">It's happening</p>
        <h2 id="final-h">${bigWhen(start, end)}</h2>
        ${ev().isAdmin && !st.changing ? '<button type="button" class="link-btn final-change" id="change-date" aria-label="Change the date">Change</button>' : ''}
        ${
          ev().isAdmin
            ? `<div class="final-tell">
          <button type="button" class="btn" data-share>${canShare ? 'Send everyone the date' : 'Copy the link for everyone'}</button>
          <details class="final-cal"><summary class="btn">Add to calendar</summary>${cal}</details>
        </div>`
            : cal
        }
        ${ev().isAdmin && st.changing ? changeList(start) : ''}
        ${
          // One quiet link at most: the organizer's email to everyone, or a guest's own Venn.
          ev().isAdmin
            ? mailAll
              ? `<p class="final-more"><a class="link-btn" id="email-all" href="${esc(mailAll)}">Email everyone the date</a></p>`
              : ''
            : `<p class="final-more"><a class="link-btn" data-link href="/new?from=set${ev().emoji ? `&template=${encodeURIComponent(ev().emoji)}` : ''}">Make your own Venn</a></p>`
        }
      </section>`;
    } else if (ev().isAdmin && ev().seriesOf) h += '<div id="series-box"></div>'; // bring last time's group back
    if (org) h += '<div id="org-tools"></div>';
    $('#banners').innerHTML = h;
    // Once the date is set, the banner says how to pass it on, so the invite button steps aside.
    $('.poll-share').hidden = ev().finalStart != null;
    st.celebrate = false;
    // The next one of a plan: bring last time's group back (plan-next.js, for organizers).
    if ($('#series-box')) import('./plan-next.js').then((m) => m.planNext({ id, ev: ev() })).catch(() => {});
    org?.tools($('#org-tools'), {
      id,
      ev: ev(),
      // Closed until wanted, so sharing (above) comes first.
      open: st.orgOpen ?? false,
      onToggle: (open) => (st.orgOpen = open), // stays open or closed across re-renders
      notifyPending: saved(id).notifyPending,
      ai: aiOn,
      panels,
      panel,
      kind: optionsMode && !partsMode ? 'pick' : 'free',
      shareUrl,
      adminToken: saved(id).adminToken,
      headers: authHeaders(),
      deleted: () => {
        forget(id, 'adminToken', 'participantId', 'editToken');
        st.dirty = false;
        navigate('/new');
      },
    });
    // Finn, the Venn dog, has something to say at a few moments: finn.js, loaded after the page.
    import('./finn.js')
      .then((m) => m.react({ id, ev: ev(), meId: saved(id).participantId, anchor: $('#banners') }))
      .catch(() => {});
  }

  function renderMeState() {
    const mine = me();
    $('#leave').hidden = !mine;
    $('#save').textContent = 'Submit';
    const s = saved(id);
    const link = $('#edit-link');
    if (mine) {
      link.hidden = false;
      // Organizers have their organizer link for other devices; guests get a personal link.
      link.innerHTML = `Answering as <b>${esc(mine.name)}</b>.${ev().isAdmin ? '' : ' To change it from another device, <button type="button" class="link-btn" id="copy-edit">copy your personal link</button>.'}`;
      if (!ev().isAdmin)
        $('#copy-edit').onclick = () => copy(`${shareUrl}#edit=${s.participantId}.${s.editToken}`, 'Personal link copied');
    } else link.hidden = true;
    // Guests who just answered are the people most likely to plan the next thing.
    $('#grow').hidden = !mine || ev().isAdmin;
    if (ev().isAdmin) renderOrgAnswer(mine);
  }

  /**
   * The organizer's view of their own tab: the options in their poll, marked as they marked them when
   * creating it, with nothing to submit. "Change my answer" opens the whole form.
   */
  function renderOrgAnswer(mine) {
    const panel = $('#panel-mine');
    let box = $('#org-answer');
    if (!box) {
      box = document.createElement('div');
      box.className = 'org-answer';
      box.id = 'org-answer';
      panel.prepend(box);
    }
    const compact = st.orgCompact && !!mine && !st.dirty;
    panel.classList.toggle('org-compact', compact);
    box.hidden = !compact;
    if (!compact) return;
    const options = partsMode ? windows.map((w) => ({ ...w, slots: [w.start] })) : rows();
    const MARK = { [YES]: '', [IF_NEEDED]: 'If needed', 0: 'Not for you' };
    let prev = null;
    box.innerHTML = `<h2 class="panel-title">Options in your poll</h2>
      <div class="rows">${options
        .map((o) => {
          const d = utcToZoned(o.start, zoneOf(o.start, o.end)).date;
          const first = d !== prev;
          prev = d;
          const v = groupState(st.mine, o.slots);
          const shown = v === 'some' ? 0 : v;
          const what = daysMode
            ? fmtDowLong.format(dateParts(d))
            : partsMode
              ? when(o.start, o.end)
              : fmtTimeRange(o.start, o.end, st.tz);
          return `<div class="row${first ? '' : ' same-day'}" data-v="${shown}">${first ? dateBlock(d) : '<span class="date-block" aria-hidden="true"></span>'}
            <div class="row-main"><div class="row-when">${esc(what)}</div>${MARK[shown] ? `<div class="row-note">${MARK[shown]}</div>` : ''}</div></div>`;
        })
        .join('')}</div>
      <p class="org-change"><button type="button" class="link-btn" id="org-change">Change my answer</button></p>`;
    $('#org-change').onclick = () => {
      st.orgCompact = false;
      renderMeState();
      const title = $(':scope > .panel-title', panel);
      title.tabIndex = -1;
      title.focus();
    };
  }

  /**
   * Once the date is picked, answering is one question for that date: Yes, If needed or No. The
   * rest of the poll is settled, so it steps aside.
   */
  function renderFinalAnswer() {
    const picked = ev().finalStart != null;
    $('#answer-final').hidden = !picked;
    $('#answer-full').hidden = picked;
    if (!picked) return;
    const slots = [...finalSet()];
    const said = st.declined ? 0 : (st.mine[slots[0]] ?? (st.touched.size ? 0 : null));
    for (const b of $$('[data-final-vote]')) b.setAttribute('aria-pressed', said != null && +b.dataset.finalVote === said);
  }
  $('#answer-final').onclick = (e) => {
    const b = e.target.closest('[data-final-vote]');
    if (!b) return;
    const v = +b.dataset.finalVote;
    const slots = [...finalSet()];
    for (const s of slots) v ? (st.mine[s] = v) : delete st.mine[s];
    // An answer about the picked date covers the whole poll: nothing is left "unanswered".
    for (const s of ev().slots) st.touched.add(String(s));
    st.declined = !Object.values(st.mine).some((x) => x > 0);
    refreshMine();
    changed();
    renderFinalAnswer();
  };

  function renderAll() {
    if (!listMode) computeLayout();
    renderHeader();
    renderBanners();
    renderTabs();
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
    renderFinalAnswer();
    setDirty(st.dirty);
  }

  // Pick up other people's answers every 20s while the tab is visible.
  const poll = setInterval(async () => {
    if (document.hidden) return;
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
        refreshMine();
        renderFinalAnswer();
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
    window.removeEventListener('beforeunload', beforeUnload);
  };
}
