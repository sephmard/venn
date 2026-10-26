// Organizer-only panels on the poll page: notifications, and privacy (with the emails people
// answered with). Loaded when the organizer opens one, so guests never download this code.

import { $, ago, api, copy, esc, lastEmail, toast } from './ui.js';

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
  ['requireEmail', 'Ask everyone for their email', 'Only you see the emails.'],
  ['hideNames', 'Hide names from guests', 'Guests see how many people can make each date, but not who.'],
  ['hideResults', "Hide everyone's answers from guests", 'Only you see the answers. Guests see the date once you pick it.'],
];

/** ctx: { id, ev, headers, close, reload } */
export function privacy(ctx) {
  const { id, ev, headers } = ctx;
  const box = $('#privacy-box');
  const withEmail = ev.participants.filter((p) => p.email);
  const emails = withEmail.length
    ? `<ul class="email-list">${withEmail.map((p) => `<li><b>${esc(p.name)}</b> <span>${esc(p.email)}</span></li>`).join('')}</ul>
       <div class="btn-row"><button type="button" class="btn btn-sm" id="copy-emails">Copy all emails</button></div>`
    : `<p class="hint">${ev.requireEmail ? 'No answers yet.' : 'Turn on "Ask everyone for their email" to collect them.'}</p>`;
  box.innerHTML = `
    <section class="sheet" aria-labelledby="privacy-h">
      <div class="sheet-head">
        <h2 id="privacy-h">Privacy</h2>
        <button type="button" class="link-btn" id="privacy-close">Close</button>
      </div>
      <form id="privacy-form" class="stack-sm" novalidate>
        ${SETTINGS.map(
          ([key, label, hint]) =>
            `<div><label class="switch"><input type="checkbox" role="switch" name="${key}"${ev[key] ? ' checked' : ''}> ${label}</label><p class="hint">${hint}</p></div>`,
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
