// A topic poll's page (/e/<id> for polls made at /new/topic): the group votes on options that
// aren't times (places, books, or one yes-or-no question), and the organizer picks one, then can
// find a date for it. Loaded by event.js only for these polls, so date polls never download it.
// Answers use the date polls' rows and colours: Yes, If needed, No on each option, or one pick.

import { IF_NEEDED, YES, isEmail } from './core.js';
import { inviteText } from './invite.js';
import {
  $,
  $$,
  api,
  app,
  avatar,
  copy,
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

/** Where "Find a date for it" goes: a date poll named after what was decided, following on from this one. */
export function dateLink(ev, id) {
  const picked = ev.options.find((o) => o.id === ev.picked);
  const yesNo = ev.single && ev.options.length === 2 && ev.options[0].label === 'Yes';
  const q = new URLSearchParams({ title: yesNo ? ev.title : picked.label, after: id });
  // "Where should we eat?": what was picked is a place.
  if (!yesNo && /^where\b/i.test(ev.title)) q.set('where', picked.label);
  if (ev.brand?.id) q.set('brand', ev.brand.id);
  return `/new?${q}`;
}

/** ctx: { id, ev, navigate, load, authHeaders, embedded, whiteLabel, hash } */
export async function renderTopicPoll(ctx) {
  const { id, navigate, authHeaders } = ctx;
  await styled;
  let ev = ctx.ev;
  const org = ev.isAdmin ? await import('./organizer.js').catch(() => null) : null;
  const host = ctx.embedded
    ? await import('./embed-frame.js').then((m) => m.connect(id, ev.brand, ctx.hash)).catch(() => null)
    : null;
  document.title = ctx.whiteLabel ? ev.title : `${ev.title} · Venn`;
  track('view', { page: 'poll', as: ev.isAdmin ? 'organizer' : saved(id).participantId ? 'answered' : 'guest' });
  if (saved(id).justCreated) forget(id, 'justCreated');
  const shareUrl = `${location.origin}/e/${id}`;
  const canShare = !!navigator.share && matchMedia('(pointer: coarse)').matches;
  const me = () => ev.participants.find((p) => p.id === saved(id).participantId);
  const st = { mine: { ...(me()?.availability || {}) }, touched: new Set(me() ? ev.options.map((o) => String(o.id)) : []) };
  const panels = {};

  async function reload() {
    ev = await ctx.load();
    render();
  }
  async function panel(name, open) {
    panels[name] = open;
    $(`#${name}-open`)?.setAttribute('aria-expanded', open);
    if (!open) return ($(`#${name}-box`).innerHTML = '');
    (await import('./organizer.js'))[name]({
      id,
      ev,
      shareUrl,
      headers: authHeaders(),
      close: () => panel(name, false),
      reload: () => reload().then(() => ev),
    });
  }

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
    app.innerHTML = `
      <article id="event-root" class="poll topic-poll">
        ${ev.brand && ctx.brandBar ? ctx.brandBar(ev.brand, esc) : ''}
        ${guest || ev.brand ? '' : `<p class="retro-top"><label class="switch"><input type="checkbox" role="switch" id="retro-top"${ev.retro ? ' checked' : ''}> Retro look</label></p>`}
        <header class="poll-head">
          <span class="emoji-tile big" aria-hidden="true">${picture ? `<img src="${esc(picture)}" alt="">` : esc(ev.emoji || '🗳️')}</span>
          <div class="poll-head-text">
            <h1 id="ev-title">${esc(ev.title)}</h1>
            <p class="poll-meta">${ev.organizer ? `<span class="host">${avatar(ev.organizer, 'av-xs')}Asked by ${esc(ev.organizer)}</span>` : ''}<span class="answered">${n ? `${plural(n, 'person', 'people')} answered` : 'No answers yet'}</span></p>
            ${ev.description ? `<p class="desc">${esc(ev.description)}</p>` : ''}
            ${loc ? `<p class="where"><span aria-hidden="true">📍</span> ${esc(loc)}</p>` : ''}
          </div>
          ${guest || picked ? '' : `<div class="poll-share"><button class="btn btn-primary" id="copy">Copy link</button>${canShare ? '<button class="btn" id="share-sheet">Share</button>' : ''}</div>`}
        </header>
        ${guest && saved(id).adminToken ? `<p class="org-switch"><span>You made this poll. This is what your guests see.</span><button type="button" class="btn btn-sm" id="org-view">Organizer view</button></p>` : ''}
        ${picked ? decided(picked, guest) : ''}
        <div id="org-tools"></div>
        <div id="notify-box"></div>
        <div id="privacy-box"></div>
        <div class="panels">
          <section class="panel active sheet" aria-labelledby="mine-h">
            <h2 class="panel-title" id="mine-h">${ev.single ? (ev.options[0].label === 'Yes' && ev.options.length === 2 ? 'What do you say?' : 'Pick one') : 'Which would you go with?'}</h2>
            ${answerRows()}
            <div class="topic-you">
              <label for="name">Your name</label>
              <input id="name" type="text" maxlength="80" autocomplete="name" value="${esc(me()?.name || host?.name || lastName())}">
              ${
                ev.requireEmail
                  ? `<label for="email">Your email <span class="muted">(only the organizer sees it)</span></label>
                <input id="email" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${esc(me()?.email || lastEmail())}">`
                  : ''
              }
              ${privacy && `<p class="hint">🔒 ${privacy}</p>`}
            </div>
            <div class="save-bar">
              <div><span id="save-state" class="hint">${me() ? 'Your answer is in. Change it any time.' : ''}</span><div class="error" id="save-err" role="alert"></div></div>
              <button type="button" class="btn btn-primary" id="save">${me() ? 'Update' : 'Submit'}</button>
            </div>
          </section>
          <section class="panel active" aria-labelledby="group-h">
            <div class="sheet">
              <h2 class="panel-title" id="group-h">The group</h2>
              ${hideAll ? `<p>🔒 ${privacy} You'll see what's decided at the top once they pick.</p>` : results(guest)}
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
      ${
        guest
          ? ''
          : `<div class="final-tell">
          <a class="btn" href="${esc(dateLink(ev, id))}" data-link id="find-date">Find a date for it</a>
          <button type="button" class="btn" id="copy">Copy link</button>
        </div>
        <button type="button" class="link-btn" id="unpick">Change</button>`
      }
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

  /** Show this visitor's answer on the rows. */
  function refresh() {
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
    // Once picked, the banner at the top says what was decided.
    const hero =
      ev.picked != null
        ? ''
        : !top.length
          ? `<p class="empty-state muted">No answers yet. Share the link and the favourite shows here.</p>`
          : `<div class="best-hero">
          <p class="kicker">${top.length > 1 ? 'Tied' : ev.single ? 'Most picked so far' : 'Favourite so far'}</p>
          <div class="best-when">${top.map((r) => esc(r.o.label)).join(' <span class="muted">and</span> ')}</div>
          <div class="best-who">${top[0].yes.length + top[0].maybe.length} of ${total} ${ev.single ? 'picked it' : 'would go'}${top[0].maybe.length ? ` (${top[0].maybe.length} if needed)` : ''}</div>
          ${guest || top.length > 1 ? '' : `<button type="button" class="btn btn-primary" data-pick="${top[0].o.id}">Pick ${esc(top[0].o.label)}</button>`}
        </div>`;
    const list = rows
      .map((r) => {
        const pct = (k) => (total ? Math.round((k / total) * 100) : 0);
        const who = names([...r.yes, ...r.maybe.map((x) => `${x} (if needed)`)]);
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

  function wire() {
    refresh();
    $('.topic-rows').addEventListener('click', (e) => {
      const r = e.target.closest('.topic-row');
      if (!r) return;
      const k = r.dataset.opt;
      if (ev.single) {
        st.mine = { [k]: YES }; // a radio button: another pick replaces it
      } else {
        const b = e.target.closest('[data-vote]');
        if (!b) return;
        const v = +b.dataset.vote;
        st.touched.add(k);
        if (v) st.mine[k] = v;
        else delete st.mine[k];
      }
      $('#save-state').textContent = 'Not sent yet';
      refresh();
    });
    // One pick: arrow keys move through the options, as in any radio group.
    if (ev.single)
      $('.topic-rows').addEventListener('keydown', (e) => {
        const all = $$('.topic-row');
        const i = all.indexOf(e.target);
        const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (i < 0 || !step) return;
        e.preventDefault();
        const next = all[(i + step + all.length) % all.length];
        next.click();
        next.focus();
      });
    $('#save').onclick = send;
    $('#copy')?.addEventListener('click', () => copy(shareUrl, 'Invite link copied. Paste it in your group chat.'));
    $('#share-sheet')?.addEventListener('click', () =>
      navigator.share({ title: ev.title, text: inviteText({ ...ev }), url: shareUrl }).catch(() => {}),
    );
    $('#org-view')?.addEventListener('click', () => navigate(`/e/${id}#organizer`));
    $('#unpick')?.addEventListener('click', () => pick(null));
    for (const b of $$('[data-pick]')) b.onclick = () => askPick(ev.options.find((o) => o.id === +b.dataset.pick));
    if (!org) return;
    org.retroSwitch?.({ id, headers: authHeaders(), ev });
    org.tools($('#org-tools'), {
      id,
      ev,
      open: false,
      onToggle: () => {},
      notifyPending: saved(id).notifyPending,
      ai: false,
      panels,
      panel,
      kind: 'topic',
      shareUrl,
      adminToken: saved(id).adminToken,
      headers: authHeaders(),
      deleted: () => {
        forget(id, 'adminToken', 'participantId', 'editToken');
        navigate('/new/topic');
      },
    });
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
      return void (err.textContent = ev.single ? 'Pick one first.' : 'Tap Yes, If needed or No on the options first.');
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
      await reload();
      toast(ev.isAdmin ? 'Saved' : 'Thanks, your answer is in');
    } catch (ex) {
      err.textContent = ex.message;
      $('#save').disabled = false;
    }
  }

  /** "Pick this one?", in the page: once picked, everyone sees it at the top. */
  function askPick(o) {
    const d = $('#pick-check');
    d.innerHTML = `<h2 id="pc-h">Go with ${esc(o.label)}?</h2>
      <p>Everyone with the link sees it at the top of the poll. You can change it later.</p>
      <div class="btn-row"><button type="button" class="btn" id="pc-no">Not yet</button><button type="button" class="btn btn-primary" id="pc-yes">Pick it</button></div>`;
    $('#pc-no').onclick = () => d.close();
    $('#pc-yes').onclick = () => (d.close(), pick(o.id));
    d.showModal();
  }
  async function pick(option) {
    try {
      await api(`events/${id}/finalize`, { method: 'POST', body: { option }, headers: authHeaders() });
      if (option != null) host?.tell('picked', { option });
      await reload();
      scrollTo(0, 0);
      if (option != null) toast('Picked. Now find a date for it.');
    } catch (ex) {
      toast(ex.message);
    }
  }

  render();
  return () => {};
}
