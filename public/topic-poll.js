// A topic poll's page (/e/<id> for polls made at /new/topic): the group votes on options that
// aren't times (places, books, or one yes-or-no question), and the organizer picks one, then can
// find a date for it. Loaded by event.js only for these polls, so date polls never download it.
// Answers use the date polls' rows and colours: Yes, If needed, No on each option, or one pick.

import { IF_NEEDED, YES, isEmail } from './core.js';
import { closesLine } from './when.js';
import {
  $,
  $$,
  api,
  app,
  avatar,
  esc,
  forget,
  lastEmail,
  lastName,
  plural,
  rememberEmail,
  rememberName,
  save,
  saved,
  toast,
  track,
  tileAttr,
} from './ui.js';

const VOTES = [
  [YES, 'v-yes', 'Yes', '✓'],
  [IF_NEEDED, 'v-maybe', 'If needed', '~'],
  [0, 'v-no', 'No', '✕'],
];

// This page's own styles, loaded before it's drawn so it never shows unstyled.
const styled = new Promise((done) =>
  document.head.append(
    Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/topic.css', onload: done, onerror: done }),
  ),
);

/**
 * Votes per option, best first: [{ o, yes: [names], maybe: [names], score }]. Yes and if needed both
 * count; more yeses break a tie; then the order the organizer gave.
 */
export function tally(ev) {
  return ev.options
    .map((o, i) => {
      const yes = [];
      const maybe = [];
      for (const p of ev.participants) {
        const v = p.availability[o.id];
        if (v === YES) yes.push(p.name);
        else if (v === IF_NEEDED) maybe.push(p.name);
      }
      return { o, i, yes, maybe, score: yes.length + maybe.length };
    })
    .sort((a, b) => b.score - a.score || b.yes.length - a.yes.length || a.i - b.i);
}

/** The options level with the leader (same yes and if needed), when there are answers. */
export function leaders(rows) {
  const [top] = rows;
  if (!top?.score) return [];
  return rows.filter((r) => r.score === top.score && r.yes.length === top.yes.length);
}

/**
 * What the leader is called, without claiming more agreement than there is: "Favourite" only when
 * it also has the most yeses. One that leads on "if needed" alone works for the most people, or
 * for everyone; nobody named it their favourite.
 */
export function leaderLabel(rows, { single = false, total = 0 } = {}) {
  const top = leaders(rows);
  if (top.length > 1) return 'Tied';
  if (single) return 'Most picked so far';
  const [lead] = top;
  if (lead.yes.length && !rows.some((r) => r.yes.length > lead.yes.length)) return 'Favourite so far';
  return lead.score >= total ? 'Everyone could go' : 'Works for the most so far';
}

/** ctx: { id, ev, navigate, load, authHeaders, embedded, whiteLabel, hash } */
export async function renderTopicPoll(ctx) {
  const { id, navigate, authHeaders } = ctx;
  await styled;
  let ev = ctx.ev;
  const host = ctx.embedded
    ? await import('./embed-frame.js').then((m) => m.connect(id, ev.brand, ctx.hash)).catch(() => null)
    : null;
  document.title = ctx.whiteLabel ? ev.title : `${ev.title} · Venn`;
  track('view', { page: 'poll', as: ev.isAdmin ? 'organizer' : saved(id).participantId ? 'answered' : 'guest' });
  if (saved(id).justCreated) forget(id, 'justCreated');
  const shareUrl = `${location.origin}/e/${id}`;
  const me = () => ev.participants.find((p) => p.id === saved(id).participantId);
  const st = { mine: { ...(me()?.availability || {}) }, touched: new Set(me() ? ev.options.map((o) => String(o.id)) : []) };
  // An answer not sent yet stays on this device (drafts.js) until it's sent, as on a date poll.
  // Not inside another website (/embed), nor in a brand template's preview: those answers aren't kept.
  const drafts = ctx.embedded || id === 'preview' ? null : await import('./drafts.js').catch(() => null);
  const draftKey = `venn:answer-draft:${id}`;
  const draft = ctx.embedded
    ? null
    : drafts?.cleanAnswerDraft(
        drafts.readStored(localStorage, draftKey),
        ev.options.map((o) => o.id),
      );
  if (draft) Object.assign(st, { mine: draft.mine, touched: new Set(draft.touched), draft: true, draftName: draft.name });
  else drafts?.dropStored(localStorage, draftKey);
  const keepDraft = () =>
    drafts?.writeStored(localStorage, draftKey, {
      mine: st.mine,
      touched: [...st.touched],
      name: $('#name')?.value ?? '',
      at: Date.now(),
    });

  async function reload() {
    ev = await ctx.load();
    render();
  }
  // `#invited=<email>`: an invitation's link (src/invites.js).
  const invited = [(ctx.hash?.get('invited') || '').toLowerCase()].find(isEmail) || '';
  // The organizer's side (sharing, picking, their tools) loads only for them: topic-organizer.js.
  const org = ev.isAdmin
    ? await import('./topic-organizer.js')
        .then((m) => m.organize({ id, ctx, st, shareUrl, host, reload, render, ev: () => ev, headers: authHeaders }))
        .catch(() => null)
    : null;

  function render() {
    const guest = !ev.isAdmin;
    const picked = ev.options.find((o) => o.id === ev.picked);
    const hideAll = guest && ev.hideResults;
    const privacy = guest
      ? hideAll
        ? "Only the organizer sees everyone's answers."
        : ev.hideNames
          ? 'Only the organizer sees who answered.'
          : ''
      : '';
    const others = ev.participants.filter((p) => p.id !== ev.hostId);
    const n = (ev.responses ?? ev.participants.length) - (ev.participants.length - others.length);
    const picture = ev.image && `/api/events/${encodeURIComponent(id)}/icon.jpg?v=${ev.image.v}`;
    const loc = ev.location;
    // When voting closes (src/deadline.js), until one is picked; after it, only the organizer votes.
    const closed = ev.deadline != null && !picked && Date.now() >= ev.deadline;
    const closes = ev.deadline != null && !picked ? closesLine(ev.deadline) : '';
    const locked = guest && closed;
    // Decided, as on a date poll: are you in? A pick-one vote's tally stays as decided: no question.
    const final = picked && !ev.single;
    app.innerHTML = `
      <article id="event-root" class="poll topic-poll">
        ${ev.brand && ctx.brandBar ? ctx.brandBar(ev.brand, esc) : ''}
        <header class="poll-head">
          <span class="emoji-tile big"${tileAttr(ev.tile)} aria-hidden="true">${picture ? `<img src="${esc(picture)}" alt="">` : esc(ev.emoji || '🗳️')}</span>
          <div class="poll-head-text">
            <h1 id="ev-title">${esc(ev.title)}</h1>
            <p class="poll-meta">${ev.organizer ? `<span class="host">${avatar(ev.organizer, 'av-xs')}Asked by ${esc(ev.organizer)}</span>` : ''}<span class="answered">${n ? `${plural(n, 'person', 'people')} answered` : 'No answers yet'}</span></p>
            ${ev.description ? `<p class="desc">${esc(ev.description)}</p>` : ''}
            ${loc ? `<p class="where"><span aria-hidden="true">📍</span> ${esc(loc)}</p>` : ''}
            ${closes}
          </div>
          ${guest || picked ? '' : org?.share() || ''}
        </header>
        ${guest && saved(id).adminToken ? `<p class="org-switch"><span>You made this poll. This is what your guests see.</span><button type="button" class="btn btn-sm" id="org-view">Organizer view</button></p>` : ''}
        ${picked ? decided(picked, guest) : ''}
        <div id="org-tools">${ev.isAdmin && !org ? '<p class="hint" role="alert">Couldn’t load the organizer tools. Reload the page.</p>' : ''}</div>
        <div id="notify-box"></div>
        <div id="invite-box"></div>
        <div id="deadline-box"></div>
        <div id="privacy-box"></div>
        <div class="panels">
          ${
            picked && ev.single
              ? ''
              : `<section class="panel active sheet" aria-labelledby="mine-h">
            <h2 class="panel-title" id="mine-h">${final ? 'It’s decided. Are you in?' : ev.single ? (ev.options[0].label === 'Yes' && ev.options.length === 2 ? 'What do you say?' : 'Pick one') : 'Which would you go with?'}</h2>
            ${
              final
                ? `<div class="final-answer" id="answer-final" role="group" aria-labelledby="mine-h">${VOTES.map(([v, , text]) => `<button type="button" class="btn" data-final-vote="${v}">${text}</button>`).join('')}</div>`
                : locked
                  ? `<div inert class="topic-locked">${answerRows()}</div>`
                  : answerRows()
            }
            <div class="topic-you">
              <label for="name">Your name</label>
              <input id="name" type="text" maxlength="80" autocomplete="name" value="${esc(st.draftName || me()?.name || host?.name || lastName())}">
              ${
                ev.requireEmail
                  ? `<label for="email">Your email <span class="muted">(only the organizer sees it)</span></label>
                <input id="email" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${esc(me()?.email || invited || lastEmail())}">`
                  : ''
              }
              ${privacy && `<p class="hint">🔒 ${privacy}</p>`}
              ${guest && me() && !picked && !ctx.embedded ? '<div class="tell-me" id="tell-me" hidden></div>' : ''}
            </div>
            <div class="save-bar">
              <div><span id="save-state" class="hint">${locked ? `Answers are closed. ${esc(ev.organizer || 'The organizer')} is picking one.` : st.draft ? 'Not sent yet' : me() ? 'Your answer is in. Change it any time.' : ''}</span><div class="error" id="save-err" role="alert"></div></div>
              <button type="button" class="btn btn-primary" id="save"${locked ? ' disabled' : ''}>${me() ? 'Update answer' : 'Submit'}</button>
            </div>
          </section>`
          }
          <section class="panel active" aria-labelledby="group-h">
            <div class="sheet">
              <h2 class="panel-title" id="group-h">The group</h2>
              ${hideAll ? `<p>🔒 ${privacy} You'll see what's decided at the top once they pick.</p>` : results(guest)}
              ${
                // A guest who's voted may have a plan of their own (as date polls' #grow)
                guest && me() && !ctx.embedded && !ctx.whiteLabel
                  ? '<p class="grow-line"><a class="link-btn" data-link id="make-yours" href="/new/topic?from=guest">Planning something? Make yours in 30 seconds</a></p>'
                  : ''
              }
            </div>
          </section>
        </div>
        <dialog class="submit-check" id="pick-check" aria-labelledby="pc-h"></dialog>
      </article>`;
    wire();
  }

  /** The banner once the organizer has picked: what was decided, and for them, what's next. */
  function decided(picked, guest) {
    return `<section class="banner-final" aria-labelledby="final-h">
      <p class="kicker">Decided</p>
      <h2 id="final-h">${esc(picked.label)}</h2>
      ${guest ? '' : org?.decided() || ''}
    </section>`;
  }

  function answerRows() {
    if (ev.single)
      return `<div class="rows topic-rows" role="radiogroup" aria-labelledby="mine-h">${ev.options
        .map(
          (o) =>
            `<button type="button" class="row topic-row topic-one" role="radio" data-opt="${o.id}" aria-checked="false"><span class="row-when">${esc(o.label)}</span>${o.id === ev.picked ? ' <span class="badge">Picked</span>' : ''}</button>`,
        )
        .join('')}</div>`;
    return `<div class="rows topic-rows">${ev.options
      .map(
        (o) => `<div class="row topic-row" data-opt="${o.id}">
          <div class="row-main"><div class="row-when">${esc(o.label)}${o.id === ev.picked ? ' <span class="badge">Picked</span>' : ''}</div></div>
          <div class="vote" role="radiogroup" aria-label="${esc(o.label)}">
            ${VOTES.map(([v, cls, text, icon]) => `<button type="button" role="radio" data-vote="${v}" class="${cls}" aria-label="${text}"><span aria-hidden="true">${icon}</span><span class="vote-text">${text}</span></button>`).join('')}
          </div>
        </div>`,
      )
      .join('')}</div>`;
  }

  /** Show this visitor's answer. */
  function refresh() {
    const said = st.mine[ev.picked] ?? (st.touched.has(String(ev.picked)) ? 0 : null);
    for (const b of $$('[data-final-vote]')) b.setAttribute('aria-pressed', String(said === +b.dataset.finalVote));
    for (const r of $$('.topic-row')) {
      const k = r.dataset.opt;
      const v = st.mine[k] ?? (st.touched.has(k) ? 0 : null);
      if (ev.single) {
        r.setAttribute('aria-checked', String(v === YES));
        r.dataset.v = v === YES ? '2' : '';
        r.tabIndex = v === YES || (!Object.keys(st.mine).length && r === $('.topic-row')) ? 0 : -1;
        continue;
      }
      if (v == null) delete r.dataset.v;
      else r.dataset.v = String(v);
      for (const b of $$('[data-vote]', r)) b.setAttribute('aria-checked', String(v != null && +b.dataset.vote === v));
    }
  }

  /** Everyone's answers: the favourite so far, then every option with its yeses. */
  function results(guest) {
    const rows = tally(ev);
    const top = leaders(rows);
    const total = ev.responses ?? ev.participants.length;
    const names = (list) => (ev.hideNames && guest ? '' : list.map(esc).join(', '));
    // No guest has answered yet (the organizer's own answer doesn't count): the options, without
    // empty bars or Pick, until the organizer says the group decided anyway (as date polls do).
    const waiting = !guest && ev.picked == null && !(total - ev.participants.filter((p) => p.id === ev.hostId).length);
    const pickable = !waiting || st.pickAnyway;
    // Once picked, the banner at the top says what was decided.
    const hero =
      ev.picked != null
        ? ''
        : waiting && org
          ? org.waiting(total)
          : waiting || !top.length
            ? `<p class="empty-state muted">No answers yet. Share the link and the favourite shows here.</p>`
            : `<div class="best-hero">
          <p class="kicker">${leaderLabel(rows, { single: ev.single, total })}</p>
          <div class="best-when">${top.map((r) => esc(r.o.label)).join(' <span class="muted">and</span> ')}</div>
          <div class="best-who">${top[0].yes.length + top[0].maybe.length} of ${total} ${ev.single ? 'picked it' : 'would go'}${top[0].maybe.length ? ` (${top[0].maybe.length} if needed)` : ''}</div>
          ${guest || top.length > 1 ? '' : `<button type="button" class="btn" data-pick="${top[0].o.id}">Pick ${esc(top[0].o.label)}</button>`}
        </div>`;
    const list = rows
      .map((r) => {
        const pct = (k) => (total ? Math.round((k / total) * 100) : 0);
        const who = names([...r.yes, ...r.maybe.map((x) => `${x} (if needed)`)]);
        if (waiting)
          return `<li class="t-result"><div class="t-line"><b>${esc(r.o.label)}</b></div>
          ${pickable ? `<button type="button" class="link-btn" data-pick="${r.o.id}">Pick this</button>` : ''}</li>`;
        return `<li class="t-result${r.o.id === ev.picked ? ' final' : ''}">
          <div class="t-line"><b>${esc(r.o.label)}</b><span class="t-count">${ev.single ? plural(r.yes.length, 'vote') : `${r.yes.length} yes`}${r.maybe.length ? ` · ${r.maybe.length} if needed` : ''}</span></div>
          <div class="t-bar" aria-hidden="true"><span class="t-yes" style="width:${pct(r.yes.length)}%"></span><span class="t-maybe" style="width:${pct(r.maybe.length)}%"></span></div>
          ${who ? `<p class="t-who">${who}</p>` : ''}
          ${guest || r.o.id === ev.picked || (top.length === 1 && r === top[0] && ev.picked == null) ? '' : `<button type="button" class="link-btn" data-pick="${r.o.id}">Pick this</button>`}
        </li>`;
      })
      .join('');
    return `${hero}<ol class="best t-results">${list}</ol>`;
  }

  /** Yes, If needed or No (v) on option k, not sent yet. */
  function answer(k, v) {
    if (ev.single) st.mine = { [k]: YES };
    else {
      st.touched.add(k);
      if (v) st.mine[k] = v;
      else delete st.mine[k];
    }
    $('#save-state').textContent = 'Not sent yet';
    st.draft = true;
    keepDraft();
    refresh();
  }

  function wire() {
    refresh();
    $('#mine-h')?.parentElement.addEventListener('click', (e) => {
      const r = e.target.closest('.topic-row');
      const b = e.target.closest('[data-vote]');
      const f = e.target.closest('[data-final-vote]');
      if (f) answer(String(ev.picked), +f.dataset.finalVote);
      else if (r && (ev.single || b)) answer(r.dataset.opt, b && +b.dataset.vote);
    });
    $('#name')?.addEventListener('input', () => st.draft && keepDraft());
    // One pick: arrow keys move through the options, as in any radio group.
    if (ev.single)
      $('.topic-rows')?.addEventListener('keydown', (e) => {
        const all = $$('.topic-row');
        const i = all.indexOf(e.target);
        const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (i < 0 || !step) return;
        e.preventDefault();
        const next = all[(i + step + all.length) % all.length];
        next.click();
        next.focus();
      });
    if ($('#save')) $('#save').onclick = send;
    $('#org-view')?.addEventListener('click', () => navigate(`/e/${id}#organizer`));
    // Once a guest's answer is in: hear what's decided (decided-alert.js).
    if ($('#tell-me'))
      import('./decided-alert.js')
        .then((m) =>
          m.decidedAlert($('#tell-me'), {
            id,
            participantId: me().id,
            headers: authHeaders(),
            email: me().email,
            required: ev.requireEmail,
          }),
        )
        .catch(() => {});
    org?.wire();
  }

  async function send() {
    const name = $('#name').value.trim();
    const err = $('#save-err');
    err.textContent = '';
    if (!name) return ((err.textContent = 'Add your name so people know who answered.'), $('#name').focus());
    const email = $('#email')?.value.trim();
    if ($('#email') && !isEmail(email || ''))
      return ((err.textContent = 'Add your email. The organizer asked everyone for one.'), $('#email').focus());
    if (!Object.keys(st.mine).length && !st.touched.size)
      return void (err.textContent = ev.single ? 'Pick one first.' : 'Tap Yes, If needed or No first.');
    const body = { name, availability: st.mine, ...(email && { email }) };
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
      drafts?.dropStored(localStorage, draftKey);
      Object.assign(st, { draft: false, draftName: '' });
      await reload();
      toast(ev.isAdmin ? 'Saved' : updated ? 'Answer updated.' : 'Thanks, your answer is in');
    } catch (ex) {
      err.textContent = ex.message;
      $('#save').disabled = false;
    }
  }

  render();
  if (draft) toast('Your answers are back. Submit when you’re ready.');
  return () => {};
}
