// The organizer's side of an RSVP's page (rsvp-poll.js): sharing it, letting people in when RSVPs
// wait for approval, the guest list's settings (spots, plus-ones, approval), and the organizer
// tools (organizer.js). Loaded only for the organizer, so guests never download it.

import { inviteText } from './invite.js';
import { fields, values, wireFields } from './rsvp-fields.js';
import { $, $$, api, copy, esc, forget, saved, toast } from './ui.js';

/**
 * The organizer's parts of the page. `page`: { id, ctx, ev() (the poll now), reload, headers, host,
 * shareUrl }. Resolves once organizer.js has loaded.
 */
export async function organize(page) {
  const { id, ctx, shareUrl } = page;
  const org = await import('./organizer.js').catch(() => null);
  const panels = {};
  const canShare = !!navigator.share && matchMedia('(pointer: coarse)').matches;

  async function panel(name, open) {
    panels[name] = open;
    $(`#${name}-open`)?.setAttribute('aria-expanded', open);
    if (!open) return ($(`#${name}-box`).innerHTML = '');
    if (name === 'rsvp') return settings();
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

  /** Spots, plus-ones and approval: changed any time, and the list follows. */
  function settings() {
    const { cap = null, plusOnes = 0, approve = false } = page.ev().rsvp || {};
    const box = $('#rsvp-box');
    box.innerHTML = `
      <section class="sheet" aria-labelledby="rsvp-h">
        <div class="sheet-head">
          <h2 id="rsvp-h">RSVP settings</h2>
          <button type="button" class="link-btn" id="rsvp-close">Close</button>
        </div>
        <form id="rsvp-form" class="stack-sm rsvp-settings" novalidate>
          ${fields({ cap, plusOnes, approve })}
          <div class="btn-row"><button class="btn btn-primary" type="submit">Save</button></div>
          <div class="error" id="rsvp-err" role="alert"></div>
        </form>
      </section>`;
    wireFields(box);
    box.scrollIntoView({ block: 'nearest' });
    $('#rsvp-close').onclick = () => panel('rsvp', false);
    $('#rsvp-form').onsubmit = async (e) => {
      e.preventDefault();
      $('#rsvp-err').textContent = '';
      try {
        await api(`events/${id}/rsvp`, { method: 'PUT', body: values(box), headers: page.headers() });
        await page.reload();
        toast('Saved');
      } catch (ex) {
        $('#rsvp-err').textContent = ex.message;
      }
    };
  }

  async function approve(pid, approved) {
    try {
      await api(`events/${id}/participants/${pid}/approval`, { method: 'PUT', body: { approved }, headers: page.headers() });
      await page.reload();
    } catch (ex) {
      toast(ex.message);
    }
  }

  return {
    /** Copy link (and Share on phones) in the header. */
    share: () =>
      `<div class="poll-share"><button class="btn" id="copy">Copy link</button>${canShare ? '<button class="btn" id="share-sheet">Share</button>' : ''}</div>`,

    /** On a guest's row: Approve and Decline while they're asking, Let in once declined. */
    actions: (p) => {
      const s = p.rsvp?.status;
      const name = esc(p.name);
      if (s === 'requested')
        return `<span class="rsvp-acts"><button type="button" class="btn btn-sm" data-approve="${esc(p.id)}" aria-label="Approve ${name}">Approve</button><button type="button" class="link-btn" data-decline="${esc(p.id)}" aria-label="Decline ${name}">Decline</button></span>`;
      if (s === 'declined')
        return `<span class="rsvp-acts"><button type="button" class="link-btn" data-approve="${esc(p.id)}" aria-label="Let ${name} in">Let in</button></span>`;
      return '';
    },

    wire() {
      const ev = page.ev();
      $('#copy')?.addEventListener('click', ({ target: b }) =>
        copy(shareUrl, 'Invite link copied. Paste it in your group chat.', b),
      );
      $('#share-sheet')?.addEventListener('click', () =>
        navigator.share({ title: ev.title, text: inviteText({ ...ev, mode: 'rsvp' }), url: shareUrl }).catch(() => {}),
      );
      for (const b of $$('[data-approve]')) b.onclick = () => approve(b.dataset.approve, true);
      for (const b of $$('[data-decline]')) b.onclick = () => approve(b.dataset.decline, false);
      org?.tools($('#org-tools'), {
        id,
        ev,
        open: false,
        onToggle: () => {},
        notifyPending: saved(id).notifyPending,
        ai: false,
        panels,
        panel,
        kind: 'rsvp',
        shareUrl,
        adminToken: saved(id).adminToken,
        headers: page.headers(),
        deleted: () => {
          forget(id, 'adminToken', 'participantId', 'editToken');
          ctx.navigate('/new/rsvp');
        },
      });
      // The RSVP's settings, first among the tools.
      $('#org-tools .btn-row')?.insertAdjacentHTML(
        'afterbegin',
        `<button class="btn btn-sm" id="rsvp-open" aria-expanded="${!!panels.rsvp}" aria-controls="rsvp-box">RSVP settings</button>`,
      );
      $('#rsvp-open')?.addEventListener('click', () => panel('rsvp', !panels.rsvp));
      if (panels.rsvp) settings();
      const open = ['deadline', 'invite'].find((p) => ctx.hash?.has(p));
      if (open && !panels[open] && !page.shown) {
        page.shown = true;
        $('details.organizer').open = true;
        panel(open, true);
      }
    },
  };
}
