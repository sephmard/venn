// An RSVP's page (/e/<id> for polls made at /new/rsvp): the date is set, and guests say Going,
// Maybe or Can't go. The organizer may cap the spots (a waitlist forms), allow plus-ones, and
// approve each RSVP. The server works out who's in and in what order (src/rsvp.js); this page shows
// it. Loaded by event.js only for RSVPs, so other polls never download it.

import { IF_NEEDED, YES, allDaySpan, isEmail, utcToZoned } from './core.js';
import { closesLine, fmtTimeRange, fmtWhen } from './when.js';
import {
  $,
  $$,
  api,
  app,
  avatar,
  dateParts,
  esc,
  fmtDay,
  forget,
  lastEmail,
  lastName,
  localTz,
  plural,
  rememberEmail,
  rememberName,
  save,
  saved,
  toast,
  track,
  tileAttr,
} from './ui.js';

const ANSWERS = [
  [YES, 'Going'],
  [IF_NEEDED, 'Maybe'],
  [0, 'Can’t go'],
];

// This page's own styles, loaded before it's drawn so it never shows unstyled.
const styled = new Promise((done) =>
  document.head.append(
    Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/rsvp.css', onload: done, onerror: done }),
  ),
);

/** The guest list, in groups: [{ key, title, people: [participant] }], empty groups left out. */
export function guestGroups(ev, { organizer = false } = {}) {
  const by = (s) => ev.participants.filter((p) => p.rsvp?.status === s);
  const waitlist = by('waitlist').sort((a, b) => a.rsvp.place - b.rsvp.place);
  return [
    ['going', 'Going', by('going')],
    ['waitlist', 'Waitlist', waitlist],
    // Asking to join, and who was told no: the organizer's business, not the group's.
    ...(organizer
      ? [
          ['requested', 'Asking to join', by('requested')],
          ['declined', 'Not this time', by('declined')],
        ]
      : []),
    ['maybe', 'Maybe', by('maybe')],
    ['no', 'Can’t go', by('no')],
  ]
    .filter(([, , people]) => people.length)
    .map(([key, title, people]) => ({ key, title, people }));
}

/** What someone's RSVP means for them, once it's sent: "You're going", "You're #2 on the waitlist"… */
export function statusLine(ev, r) {
  const who = ev.organizer || 'The organizer';
  switch (r?.status) {
    case 'going':
      return `You’re going${r.guests ? `, with ${plural(r.guests, 'guest')}` : ''}. 🎉`;
    case 'waitlist':
      return `You’re #${r.place} on the waitlist. If a spot opens, it’s yours.`;
    case 'requested':
      return `Request sent. ${who} will let you in.`;
    case 'declined':
      return `${who} couldn’t fit you in this time.`;
    case 'maybe':
      return 'Maybe. Change it any time.';
    case 'no':
      return 'You can’t go. Change it any time.';
    default:
      return '';
  }
}

/** The line under the date: spots left, and whether the organizer approves each RSVP. */
export function spotsLine(ev) {
  const c = ev.rsvpCount || {};
  const { cap, approve } = ev.rsvp || {};
  const parts = [];
  if (cap != null) parts.push(c.spotsLeft ? `${plural(c.spotsLeft, 'spot')} left` : 'Full: new RSVPs join the waitlist');
  if (approve) parts.push('RSVPs need approval');
  return parts.join(' · ');
}

/** ctx: { id, ev, navigate, load, authHeaders, embedded, whiteLabel, hash, brandBar } */
export async function renderRsvp(ctx) {
  const { id, navigate, authHeaders } = ctx;
  const orgJs = ctx.ev.isAdmin ? import('./rsvp-organizer.js') : null;
  const calJs = import('./add-to-calendar.js').catch(() => null);
  await styled;
  let ev = ctx.ev;
  const host = ctx.embedded
    ? await import('./embed-frame.js').then((m) => m.connect(id, ev.brand, ctx.hash)).catch(() => null)
    : null;
  document.title = ctx.whiteLabel ? ev.title : `${ev.title} · Venn`;
  track('view', { page: 'poll', as: ev.isAdmin ? 'organizer' : saved(id).participantId ? 'answered' : 'guest' });
  if (saved(id).justCreated) forget(id, 'justCreated');
  const shareUrl = `${location.origin}/e/${id}`;
  const key = String(ev.options[0].start);
  const me = () => ev.participants.find((p) => p.id === saved(id).participantId);
  const st = { said: me() ? (me().availability[key] ?? 0) : null, guests: me()?.rsvp?.guests || 0 };
  const invited = [(ctx.hash?.get('invited') || '').toLowerCase()].find(isEmail) || '';
  const cal = await calJs;

  async function reload() {
    ev = await ctx.load();
    render();
  }
  const org = ev.isAdmin
    ? await orgJs
        .then((m) => m.organize({ id, ctx, shareUrl, host, reload, ev: () => ev, headers: authHeaders }))
        .catch(() => null)
    : null;

  /** The date, big, and a way to put it in a calendar. */
  function when() {
    const { start, end } = ev.options[0];
    const tz = allDaySpan(start, end, ev.timezone) ? ev.timezone : localTz;
    const d = utcToZoned(start, tz).date;
    const oneDay = d === utcToZoned(end - 1, tz).date;
    const big = oneDay
      ? `<span class="nowrap">${esc(fmtDay.format(dateParts(d)))},</span> <span class="nowrap">${esc(fmtTimeRange(start, end, tz))}</span>`
      : esc(fmtWhen(start, end, tz));
    const info = {
      title: ev.title,
      description: [ev.description, shareUrl].filter(Boolean).join('\n\n'),
      location: ev.location,
      start,
      end,
      allDay: !!allDaySpan(start, end, ev.timezone),
    };
    // The organizer's calendar invites everyone going who gave their email (add-to-calendar.js).
    const guests = ev.isAdmin
      ? ev.participants.filter((p) => p.email && p.rsvp?.status === 'going').map((p) => ({ name: p.name, email: p.email }))
      : [];
    const add = cal ? cal.addToCalendar({ id, info, day: d.slice(8), url: shareUrl, guests }) : '';
    return `<section class="banner-final rsvp-when" aria-labelledby="final-h">
      <p class="kicker">${ev.isAdmin ? 'It’s happening' : 'You’re invited'}</p>
      <h2 id="final-h">${big}</h2>
      ${add ? `<details class="final-cal"><summary class="btn">Add to calendar</summary>${add}</details>` : ''}
    </section>`;
  }

  function render() {
    const guest = !ev.isAdmin;
    const hideAll = guest && ev.hideResults;
    const privacy = guest
      ? hideAll
        ? 'Only the organizer sees the guest list.'
        : ev.hideNames
          ? 'Only the organizer sees who’s coming.'
          : ''
      : '';
    const c = ev.rsvpCount || {};
    const picture = ev.image && `/api/events/${encodeURIComponent(id)}/icon.jpg?v=${ev.image.v}`;
    const closed = ev.deadline != null && Date.now() >= ev.deadline;
    const locked = guest && closed;
    const spots = spotsLine(ev);
    const mine = me();
    const plus = ev.rsvp?.plusOnes || 0;
    app.innerHTML = `
      <article id="event-root" class="poll rsvp-poll">
        ${ev.brand && ctx.brandBar ? ctx.brandBar(ev.brand, esc) : ''}
        <header class="poll-head">
          <span class="emoji-tile big"${tileAttr(ev.tile)} aria-hidden="true">${picture ? `<img src="${esc(picture)}" alt="">` : esc(ev.emoji || '🎟️')}</span>
          <div class="poll-head-text">
            <h1 id="ev-title">${esc(ev.title)}</h1>
            <p class="poll-meta">${ev.organizer ? `<span class="host">${avatar(ev.organizer, 'av-xs')}By ${esc(ev.organizer)}</span>` : ''}<span class="answered">${c.going ? `${c.going} going` : 'No RSVPs yet'}</span></p>
            ${ev.description ? `<p class="desc">${esc(ev.description)}</p>` : ''}
            ${ev.location ? `<p class="where"><span aria-hidden="true">📍</span> ${esc(ev.location)}</p>` : ''}
          </div>
          ${guest ? '' : org?.share() || ''}
        </header>
        ${guest && saved(id).adminToken ? `<p class="org-switch"><span>You made this. This is what your guests see.</span><button type="button" class="btn btn-sm" id="org-view">Organizer view</button></p>` : ''}
        ${when()}
        ${spots ? `<p class="rsvp-spots" id="rsvp-spots">${esc(spots)}</p>` : ''}
        ${ev.deadline != null ? closesLine(ev.deadline, 'RSVPs') : ''}
        <div id="org-tools">${ev.isAdmin && !org ? '<p class="hint">Couldn’t load the organizer tools. Reload the page.</p>' : ''}</div>
        <div id="rsvp-box"></div>
        <div id="notify-box"></div>
        <div id="invite-box"></div>
        <div id="deadline-box"></div>
        <div id="privacy-box"></div>
        <div class="panels">
          ${
            guest
              ? `<section class="panel active sheet" aria-labelledby="mine-h">
            <h2 class="panel-title" id="mine-h">Are you coming?</h2>
            <div class="final-answer" id="answer-final" role="group" aria-labelledby="mine-h"${locked ? ' inert' : ''}>
              ${ANSWERS.map(([v, text]) => `<button type="button" class="btn" data-final-vote="${v}">${text}</button>`).join('')}
            </div>
            ${
              plus
                ? `<div class="rsvp-plus" id="rsvp-plus" hidden>
              <label for="guests">Bringing</label>
              <select id="guests">${Array.from({ length: plus + 1 }, (_, n) => `<option value="${n}">${n ? `+${n}` : 'Just me'}</option>`).join('')}</select>
            </div>`
                : ''
            }
            <div class="topic-you">
              <label for="name">Your name</label>
              <input id="name" type="text" maxlength="80" autocomplete="name" value="${esc(mine?.name || host?.name || lastName())}">
              <div id="note-slot"></div>
              ${
                ev.requireEmail
                  ? `<label for="email">Your email <span class="muted">(only the organizer sees it)</span></label>
                <input id="email" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${esc(mine?.email || invited || lastEmail())}">`
                  : ''
              }
              ${privacy && `<p class="hint">🔒 ${privacy}</p>`}
            </div>
            <div class="save-bar">
              <div><span id="save-state" class="hint">${locked ? 'RSVPs are closed.' : esc(statusLine(ev, mine?.rsvp))}</span><div class="error" id="save-err" role="alert"></div></div>
              <button type="button" class="btn btn-primary" id="save"${locked ? ' disabled' : ''}>${mine ? 'Update RSVP' : 'RSVP'}</button>
            </div>
          </section>`
              : ''
          }
          <section class="panel active" aria-labelledby="group-h">
            <div class="sheet">
              <h2 class="panel-title" id="group-h">Guest list</h2>
              ${hideAll ? `<p>🔒 ${privacy}</p>` : `${list(guest)}<div id="notes-slot"></div>`}
              ${
                guest && mine && !ctx.embedded && !ctx.whiteLabel
                  ? '<p class="grow-line"><a class="link-btn" data-link id="make-yours" href="/new/rsvp?from=guest">Planning something? Make yours in a minute</a></p>'
                  : ''
              }
            </div>
          </section>
        </div>
      </article>`;
    wire();
  }

  /** Everyone's RSVP, by group: names with their plus-ones; for the organizer, Approve and Decline. */
  function list(guest) {
    const groups = guestGroups(ev, { organizer: !guest });
    if (!groups.length)
      return `<p class="empty-state muted">${guest ? 'Nobody’s going yet.' : 'No RSVPs yet. Share the link and they show here.'}</p>`;
    const c = ev.rsvpCount || {};
    const count = (g) => (g.key === 'going' ? c.going : g.people.length);
    return groups
      .map(
        (g) => `<div class="rsvp-group" data-group="${g.key}">
        <h3 class="kicker">${esc(g.title)} <span class="rsvp-n">${count(g)}</span></h3>
        <ol class="rsvp-list">${g.people
          .map(
            (p) => `<li>
            <span class="rsvp-who">${avatar(p.name, 'av-xs')}<b>${esc(p.name)}</b>${p.rsvp.guests ? ` <span class="muted">+${p.rsvp.guests}</span>` : ''}</span>
            ${guest ? '' : org?.actions(p) || ''}
          </li>`,
          )
          .join('')}</ol>
      </div>`,
      )
      .join('');
  }

  /** Show this visitor's choice, not sent yet or sent. */
  function refresh() {
    for (const b of $$('[data-final-vote]')) b.setAttribute('aria-pressed', String(st.said === +b.dataset.finalVote));
    if ($('#rsvp-plus')) $('#rsvp-plus').hidden = st.said !== YES;
    if ($('#guests')) $('#guests').value = String(st.guests);
  }

  function wire() {
    refresh();
    import('./answer-note.js').then((m) => m.mountNotes(id, ev, me())).catch(() => {});
    $('#answer-final')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-final-vote]');
      if (!b) return;
      st.said = +b.dataset.finalVote;
      $('#save-state').textContent = 'Not sent yet';
      refresh();
      if (st.said === YES) $('#guests')?.focus();
    });
    $('#guests')?.addEventListener('change', (e) => {
      st.guests = +e.target.value;
      $('#save-state').textContent = 'Not sent yet';
    });
    if ($('#save')) $('#save').onclick = send;
    $('#org-view')?.addEventListener('click', () => navigate(`/e/${id}#organizer`));
    org?.wire();
  }

  async function send() {
    const name = $('#name').value.trim();
    const err = $('#save-err');
    err.textContent = '';
    if (st.said == null) return void (err.textContent = 'Tap Going, Maybe or Can’t go first.');
    if (!name) return ((err.textContent = 'Add your name so the organizer knows who’s coming.'), $('#name').focus());
    const email = $('#email')?.value.trim();
    if ($('#email') && !isEmail(email || ''))
      return ((err.textContent = 'Add your email. The organizer asked everyone for one.'), $('#email').focus());
    const body = {
      name,
      availability: st.said ? { [key]: st.said } : {},
      guests: st.said === YES ? st.guests : 0,
      note: $('#note')?.value,
      ...(email && { email }),
    };
    $('#save').disabled = true;
    try {
      const pid = saved(id).participantId;
      const updated = !!(pid && me());
      if (updated) await api(`events/${id}/participants/${pid}`, { method: 'PUT', body, headers: authHeaders() });
      else {
        const r = await api(`events/${id}/participants`, { method: 'POST', body, headers: authHeaders() });
        save(id, { participantId: r.id, editToken: r.editToken });
      }
      rememberName(name);
      if (email) rememberEmail(email);
      host?.tell('answered', { updated });
      await reload();
      toast(statusLine(ev, me()?.rsvp) || 'Saved');
    } catch (ex) {
      err.textContent = ex.message;
      $('#save').disabled = false;
    }
  }

  render();
  return () => {};
}
