// Organizer-only panels on the poll page: notifications, and privacy (with the emails people
// answered with). Loaded when the organizer opens one, so guests never download this code.

import { meetingEnd } from './core.js';
import { $, ago, api, copy, esc, lastEmail, toast } from './ui.js';

// ----- the organizer's tools, at the top of the poll -----

/**
 * ctx: { id, ev, open, onToggle, notifyPending, ai, panels, panel, kind, shareUrl,
 * adminToken, headers, deleted }
 */
export function tools(box, ctx) {
  const { id, ev, panels } = ctx;
  // Edit until someone else answers; after that, start a new poll from this one.
  const copyOnly = ev.participants.some((p) => p.id !== ev.hostId);
  // One closed line, the same before and after a date is picked, so sharing (above) comes first.
  box.innerHTML = `<details class="organizer"${ctx.open ? ' open' : ''}>
    <summary><b>Organizer tools</b>${ctx.notifyPending ? ' <span class="org-note">Check your inbox for its link: we\'ll email you when people answer.</span>' : ''}</summary>
    <div class="btn-row">
      <button class="btn btn-sm" id="notify-open" aria-expanded="${!!panels.notify}" aria-controls="notify-box">Notifications</button>
      ${ctx.ai ? '<button class="btn btn-sm" id="writer-open" aria-controls="writer-box">Write a message</button>' : ''}
      <button class="btn btn-sm" id="privacy-open" aria-expanded="${!!panels.privacy}" aria-controls="privacy-box">Privacy</button>
      <a class="btn btn-sm" href="/new/${ctx.kind}?${copyOnly ? 'copy' : 'edit'}=${id}${copyOnly && ev.finalStart != null ? '&amp;next' : ''}" data-link>${copyOnly ? 'Duplicate' : 'Edit'} poll</a>
    </div>
    <div class="org-private">
      <button class="btn btn-sm" id="copy-admin" aria-describedby="copy-admin-hint">Copy private organizer link</button>
      <p class="hint" id="copy-admin-hint">To manage this poll on another device. Don't share it.</p>
    </div>
    <button class="link-btn danger" id="delete-poll">Delete poll</button>
  </details>`;
  $('details.organizer', box).addEventListener('toggle', (e) => ctx.onToggle(e.target.open));
  // The one link that carries the organizer's secret, and it says so.
  $('#copy-admin').onclick = () =>
    copy(
      `${ctx.shareUrl}#admin=${ctx.adminToken}`,
      'Organizer link copied. Keep it private: anyone with it can change or delete the poll.',
    );
  for (const name of ['notify', 'privacy', 'writer'])
    if ($(`#${name}-open`)) $(`#${name}-open`).onclick = () => ctx.panel(name, !panels[name]);
  $('#delete-poll').onclick = async () => {
    if (!confirm("Delete this poll and everyone's answers? This cannot be undone.")) return;
    try {
      await api(`events/${id}`, { method: 'DELETE', headers: ctx.headers });
      ctx.deleted();
      toast('Poll deleted');
    } catch (ex) {
      toast(ex.message);
    }
  };
}

/** The AI summary of the answers so far. ctx: { id, ev, headers, when(start, end) } */
export async function summary(btn, { id, ev, headers, when }) {
  btn.disabled = true;
  btn.textContent = 'Summarizing…';
  try {
    const r = await api(`events/${id}/ai/summary`, { method: 'POST', body: {}, headers });
    const rec =
      r.recommendedStart == null
        ? ''
        : `<div class="ai-rec">
            <div><b>Suggested:</b> ${esc(when(r.recommendedStart, meetingEnd(ev, r.recommendedStart)))}${r.reason ? `<div class="hint">${esc(r.reason)}</div>` : ''}</div>
            ${ev.finalStart === r.recommendedStart ? '' : `<button class="btn btn-sm" data-pick="${r.recommendedStart}">Pick this</button>`}
          </div>`;
    $('#ai-summary').innerHTML =
      `<div class="ai-card"><p>${esc(r.summary)}</p>${rec}<p class="hint">Written by AI from the answers so far. Double-check before deciding.</p></div>`;
  } catch (ex) {
    toast(ex.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Summarize with AI';
  }
}

/** Show "Loading…" in a panel's box, then the panel, or what went wrong. */
async function showPanel(box, path, ctx, render) {
  box.innerHTML = '<div class="sheet hint">Loading…</div>';
  try {
    render(ctx, await api(path, { headers: ctx.headers }));
    box.scrollIntoView({ block: 'nearest' });
  } catch (ex) {
    box.innerHTML = `<div class="sheet error">${esc(ex.message)}</div>`;
  }
}

// ----- notifications -----

/** ctx: { id, ev, shareUrl, headers, close } */
export const notify = (ctx) => showPanel($('#notify-box'), `events/${ctx.id}/notifications`, ctx, renderNotify);

function renderNotify(ctx, s) {
  const { id, ev, shareUrl, headers } = ctx;
  const box = $('#notify-box');
  const delivery = (d) =>
    d
      ? `${d.ok ? '✓ Delivered' : '✕ Failed'}${d.status ? ` (HTTP ${d.status})` : d.error ? ` (${esc(d.error)})` : ''} ${ago(d.at)}`
      : 'Nothing sent yet';
  const emailStatus = !s.email ? '' : `<span class="ok">✓ On.</span> Last email: ${delivery(s.lastDelivery.email)}`;
  const sample = JSON.stringify(
    {
      event: 'response.created',
      sentAt: new Date().toISOString(),
      poll: { id, title: ev.title, url: shareUrl, responses: ev.participants.length + 1, finalStart: null },
      response: { name: 'Ana' },
      bestTime: { start: '…', end: '…', available: 3, ifNeeded: 1, label: '…' },
    },
    null,
    2,
  );
  box.innerHTML = `
    <section class="sheet" aria-labelledby="notify-h">
      <div class="sheet-head">
        <h2 id="notify-h">Notifications</h2>
        <button type="button" class="link-btn" id="notify-close">Close</button>
      </div>
      <p class="hint">Find out when someone answers, changes their answers or removes them.</p>
      <form id="notify-form" class="stack" novalidate>
        <fieldset class="notify-way">
          <legend>Email</legend>
          ${
            s.emailAvailable
              ? `<label for="n-email">Send emails to</label>
                <input id="n-email" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${esc(s.email || lastEmail())}">
                <p class="hint">${emailStatus || "We'll email you each time someone answers."}</p>`
              : `<p class="hint" id="email-off">Email isn't switched on for this Venn server yet. Until it is, use a custom notification below, for example a Slack or Discord channel.</p>`
          }
        </fieldset>
        <details class="notify-way custom"${s.webhookUrl || !s.emailAvailable ? ' open' : ''}>
          <summary>Custom notifications <span class="muted">(webhooks, for Slack, Discord, Zapier or your own app)</span></summary>
          <label for="n-hook">Webhook URL</label>
          <input id="n-hook" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://hooks.slack.com/services/…" value="${esc(s.webhookUrl || '')}">
          <p class="hint">Slack and Discord webhook links get a readable message. Any other <code>https://</code> address gets JSON.</p>
          ${
            s.webhookSecret
              ? `<div class="secret-row">
                  <span>Signing secret</span><code>${esc(s.webhookSecret)}</code>
                  <button type="button" class="btn btn-sm" id="copy-secret">Copy</button>
                  <button type="button" class="btn btn-sm" id="test-hook">Send test</button>
                </div>
                <p class="hint" id="hook-status">Last delivery: ${delivery(s.lastDelivery.webhook)}</p>`
              : ''
          }
          <details class="dev">
            <summary>For developers: what Venn sends</summary>
            <p class="hint">A <code>POST</code> each time someone answers. <code>event</code> is <code>response.created</code>, <code>response.updated</code>, <code>response.deleted</code> or <code>test</code>.</p>
            <pre class="code" tabindex="0" aria-label="Example request body"><code>${esc(sample)}</code></pre>
            <p class="hint">Check that it came from Venn: <code>X-Venn-Signature</code> is <code>sha256=</code> plus the HMAC-SHA256 of <code>"&lt;X-Venn-Timestamp&gt;.&lt;raw body&gt;"</code>, keyed with your signing secret. Requests time out after 5 seconds and aren't retried.</p>
            <p class="hint"><a href="https://docs.venn.day/notifications.html#webhooks" target="_blank" rel="noopener">Webhook docs, with a verification example</a></p>
          </details>
        </details>
        <div class="btn-row"><button class="btn btn-primary" type="submit">Save notifications</button></div>
        <div class="error" id="notify-err" role="alert"></div>
      </form>
    </section>`;
  $('#notify-close').onclick = () => ctx.close();
  if ($('#copy-secret')) $('#copy-secret').onclick = () => copy(s.webhookSecret, 'Secret copied');
  if ($('#test-hook'))
    $('#test-hook').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await api(`events/${id}/notifications/test`, { method: 'POST', body: {}, headers: headers });
        toast(r.ok ? 'Test sent' : `Test failed${r.status ? ` (HTTP ${r.status})` : r.error ? ` (${r.error})` : ''}`);
        renderNotify(ctx, await api(`events/${id}/notifications`, { headers: headers }));
      } catch (ex) {
        toast(ex.message);
        e.target.disabled = false;
      }
    };
  $('#notify-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = { webhookUrl: $('#n-hook').value.trim() || null };
    if ($('#n-email')) body.email = $('#n-email').value.trim() || null;
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    $('#notify-err').textContent = '';
    try {
      const next = await api(`events/${id}/notifications`, { method: 'PUT', body, headers: headers });
      renderNotify(ctx, next);
      toast(
        next.email && next.email !== s.email ? `Saved. We'll email ${next.email} when people answer.` : 'Notifications saved',
      );
    } catch (ex) {
      $('#notify-err').textContent = ex.message;
      if (btn) btn.disabled = false;
    }
  };
}

// ----- privacy -----

const SETTINGS = [
  ['requireEmail', 'Ask guests for their email'],
  ['hideNames', 'Hide names from guests'],
  ['hideResults', 'Hide answers from guests'],
];

/** ctx: { id, ev, headers, close, reload } */
export function privacy(ctx) {
  const { id, ev, headers } = ctx;
  const box = $('#privacy-box');
  const withEmail = ev.participants.filter((p) => p.email);
  const emails = withEmail.length
    ? `<ul class="email-list">${withEmail.map((p) => `<li><b>${esc(p.name)}</b> <span>${esc(p.email)}</span></li>`).join('')}</ul>
       <div class="btn-row"><button type="button" class="btn btn-sm" id="copy-emails">Copy all emails</button></div>`
    : '<p class="hint">No emails yet.</p>';
  box.innerHTML = `
    <section class="sheet" aria-labelledby="privacy-h">
      <div class="sheet-head">
        <h2 id="privacy-h">Privacy</h2>
        <button type="button" class="link-btn" id="privacy-close">Close</button>
      </div>
      <form id="privacy-form" class="stack-sm" novalidate>
        ${SETTINGS.map(
          ([key, label]) =>
            `<div><label class="switch"><input type="checkbox" role="switch" name="${key}"${ev[key] ? ' checked' : ''}> ${label}</label></div>`,
        ).join('')}
        <div class="btn-row"><button class="btn btn-primary" type="submit">Save privacy settings</button></div>
        <div class="error" id="privacy-err" role="alert"></div>
      </form>
      <h3>Emails <span class="muted">(${withEmail.length})</span></h3>
      ${emails}
    </section>`;
  box.scrollIntoView({ block: 'nearest' });
  $('#privacy-close').onclick = () => ctx.close();
  if ($('#copy-emails'))
    $('#copy-emails').onclick = () =>
      copy(
        withEmail.map((p) => p.email).join(', '),
        `${withEmail.length === 1 ? '1 email' : `${withEmail.length} emails`} copied`,
      );
  $('#privacy-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(SETTINGS.map(([key]) => [key, e.target.elements[key].checked]));
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    $('#privacy-err').textContent = '';
    try {
      await api(`events/${id}/settings`, { method: 'PUT', body, headers });
      toast('Privacy settings saved');
      privacy({ ...ctx, ev: await ctx.reload() });
    } catch (ex) {
      $('#privacy-err').textContent = ex.message;
      if (btn) btn.disabled = false;
    }
  };
}

// ----- AI-written messages -----

const KINDS = [
  ['invite', 'Invite'],
  ['reminder', 'Reminder'],
  ['announcement', 'Final date'],
];

/** ctx: { id, ev, headers, close } */
export function writer(ctx) {
  const box = $('#writer-box');
  box.innerHTML = `
    <section class="sheet" aria-labelledby="ai-write-h">
      <div class="sheet-head">
        <h2 id="ai-write-h">Write a message</h2>
        <button type="button" class="link-btn" id="ai-write-close">Close</button>
      </div>
      <p class="hint">AI drafts a message to paste into your group chat or an email.</p>
      <div class="seg" role="group" aria-label="Message type">
        ${KINDS.map(([k, l]) => `<button type="button" data-kind="${k}"${k === 'announcement' && ctx.ev.finalStart == null ? ' disabled title="Pick the final date first"' : ''}>${l}</button>`).join('')}
      </div>
      <div id="ai-write-out"></div>
    </section>`;
  $('#ai-write-close').onclick = () => ctx.close();
  for (const b of box.querySelectorAll('[data-kind]'))
    b.onclick = async () => {
      for (const x of box.querySelectorAll('[data-kind]')) x.setAttribute('aria-pressed', x === b);
      const out = $('#ai-write-out');
      out.innerHTML = '<p class="hint">Writing…</p>';
      try {
        const { message } = await api(`events/${ctx.id}/ai/message`, {
          method: 'POST',
          body: { kind: b.dataset.kind },
          headers: ctx.headers,
        });
        out.innerHTML = `<label for="ai-msg" class="sr-only">Message</label><textarea id="ai-msg" rows="5">${esc(message)}</textarea><div class="btn-row"><button type="button" class="btn btn-sm btn-primary" id="ai-msg-copy">Copy</button></div>`;
        $('#ai-msg-copy').onclick = () => copy($('#ai-msg').value, 'Message copied');
      } catch (ex) {
        out.innerHTML = `<p class="error">${esc(ex.message)}</p>`;
      }
    };
}
