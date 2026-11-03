// The organizer's side of a topic poll's page (topic-poll.js): sharing it, picking one, finding a
// date for it, and the organizer tools (organizer.js). Loaded only for the organizer, so guests
// never download it.

import { LIMITS } from './core.js';
import { inviteText } from './invite.js';
import { $, $$, api, copy, esc, forget, saved, toast } from './ui.js';

/** Where "Find a date for it" goes: a date poll named after what was decided, following on from this one.
 *  A vote made from a starter keeps what it was about: "Dinner at Luigi’s", from the dinner template.
 *  `starters` is topic-templates.js. */
export function dateLink(ev, id, starters = null) {
  const picked = ev.options.find((o) => o.id === ev.picked);
  const yesNo = ev.single && ev.options.length === 2 && ev.options[0].label === 'Yes';
  const s = yesNo ? null : starters?.starterOf(ev);
  const title = yesNo ? ev.title : s?.then ? s.then.replace('{option}', () => picked.label) : picked.label;
  const q = new URLSearchParams({ title: title.slice(0, LIMITS.title), after: id });
  if (s?.plan && !ev.brand?.id) q.set('template', s.plan);
  // "Where should we eat?": what was picked is a place.
  if (!yesNo && /^where\b/i.test(ev.title)) q.set('where', picked.label);
  if (ev.brand?.id) q.set('brand', ev.brand.id);
  return `/new?${q}`;
}

/**
 * The organizer's parts of the page. `page`: { id, ctx, ev() (the poll now), st, reload, render,
 * headers, host, shareUrl }. Resolves once organizer.js and the starters have loaded.
 */
export async function organize(page) {
  const { id, ctx, st, shareUrl } = page;
  const [org, starters] = await Promise.all([
    import('./organizer.js').catch(() => null),
    import('./topic-templates.js').catch(() => null),
  ]);
  const panels = {};
  const canShare = !!navigator.share && matchMedia('(pointer: coarse)').matches;

  async function panel(name, open) {
    panels[name] = open;
    $(`#${name}-open`)?.setAttribute('aria-expanded', open);
    if (!open) return ($(`#${name}-box`).innerHTML = '');
    org?.[name]({
      id,
      ev: page.ev(),
      shareUrl,
      headers: page.headers(),
      close: () => panel(name, false),
      panel,
      reload: () => page.reload().then(page.ev),
    });
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
      await api(`events/${id}/finalize`, { method: 'POST', body: { option }, headers: page.headers() });
      if (option != null) page.host?.tell('picked', { option });
      await page.reload();
      scrollTo(0, 0);
      if (option != null) toast('Picked. Now find a date for it.');
    } catch (ex) {
      toast(ex.message);
    }
  }

  return {
    /** Copy link (and Share on phones) in the header, until one is picked. */
    share: () =>
      `<div class="poll-share"><button class="btn btn-primary" id="copy">Copy link</button>${canShare ? '<button class="btn" id="share-sheet">Share</button>' : ''}</div>`,

    /** Under the Decided banner: what's next. */
    decided: () => `<div class="final-tell">
          <a class="btn" href="${esc(dateLink(page.ev(), id, starters))}" data-link id="find-date">Find a date for it</a>
          <button type="button" class="btn" id="copy">Copy link</button>
        </div>
        <button type="button" class="link-btn" id="unpick">Change</button>
        ${ctx.embedded ? '' : `<p class="final-more"><a class="link-btn" data-link id="vote-again" href="/new/topic?copy=${esc(id)}&next">Vote again next time</a></p>`}`,

    /** No guest has answered yet: share the link, or say the group decided anyway (as date polls do). */
    waiting: (
      total,
    ) => `<p class="empty-state muted">${total ? '<b>Only your answer so far.</b>' : 'No answers yet.'} Share the link and the favourite shows here.</p>
          ${st.pickAnyway ? '' : '<p><button type="button" class="link-btn" id="pick-anyway">Pick one anyway</button></p>'}`,

    wire() {
      const ev = page.ev();
      $('#copy')?.addEventListener('click', ({ target: b }) => {
        copy(shareUrl, 'Invite link copied. Paste it in your group chat.');
        if (b.textContent === 'Link copied ✓') return;
        const was = b.textContent;
        b.textContent = 'Link copied ✓'; // for sighted people too
        setTimeout(() => (b.textContent = was), 2e3);
      });
      $('#share-sheet')?.addEventListener('click', () =>
        navigator.share({ title: ev.title, text: inviteText({ ...ev }), url: shareUrl }).catch(() => {}),
      );
      $('#unpick')?.addEventListener('click', () => pick(null));
      for (const b of $$('[data-pick]')) b.onclick = () => askPick(ev.options.find((o) => o.id === +b.dataset.pick));
      $('#pick-anyway')?.addEventListener('click', () => {
        st.pickAnyway = true;
        page.render();
        $('.t-results [data-pick]')?.focus();
      });
      org?.tools($('#org-tools'), {
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
        headers: page.headers(),
        deleted: () => {
          forget(id, 'adminToken', 'participantId', 'editToken');
          ctx.navigate('/new/topic');
        },
      });
      // `#organizer&deadline` (or `&invite`), from My polls: straight to that panel, once.
      const open = ['deadline', 'invite'].find((p) => ctx.hash?.has(p));
      if (open && !panels[open] && !st.deadlineShown) {
        st.deadlineShown = true;
        $('details.organizer').open = true;
        panel(open, true);
      }
    },
  };
}
