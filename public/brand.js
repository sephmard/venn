// Brand templates (/brand): an organization's own template, with its logo, colour and font, and what
// its polls start with. No accounts: saving gives a share link for the team (/new?brand=<id>) and a
// private manage link (/brand/<id>#admin=<token>), kept in this browser too, like a poll's organizer
// link. See src/brands.js. Loaded only on these pages.

import { BUTTONS, CORNERS, FONTS, LOGO_SIZES, brandLook } from './brand-look.js';
import { $, $$, api, app, esc, forget, save, saved, toast } from './ui.js';

// The create pages' styles (forms, the sticky bar), and this page's own.
const sheet = (href) =>
  new Promise((done) =>
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href, onload: done, onerror: done })),
  );
await Promise.all([sheet('/create.css'), sheet('/brand.css')]);

const DEFAULT_ACCENT = '#0b7a5c';
// A page of its own starts white, with light grey cards and near-black text.
const OWN = { bg: '#ffffff', surface: '#f4f4f5', text: '#16181a' };
// Answers of its own start as Venn's: available, if needed, unavailable.
const KEY = { yes: '#0b7a5c', maybe: '#e0a12e', no: '#f0b2a6' };
// The logo: made small here, to fit a 320 × 160 box (the server takes at most 100 KB).
const LOGO_BOX = [320, 160];
const LOGO_MAX = 100_000;

const key = (id) => `brand:${id}`;
/** The templates made or managed in this browser, newest first: [{ id, name }]. */
function mine() {
  try {
    return JSON.parse(localStorage.getItem('venn:brands')) || [];
  } catch {
    return [];
  }
}
function remember(id, name) {
  try {
    localStorage.setItem('venn:brands', JSON.stringify([{ id, name }, ...mine().filter((b) => b.id !== id)].slice(0, 20)));
  } catch {}
}
function unremember(id) {
  try {
    localStorage.setItem('venn:brands', JSON.stringify(mine().filter((b) => b.id !== id)));
  } catch {}
  forget(key(id), 'adminToken');
}

const shareUrl = (id) => `${location.origin}/new?brand=${id}`;
// Managed through an account (no token on this device): the link that opens it for the account.
const manageUrl = (id, token) => `${location.origin}/brand/${id}${token ? `#admin=${token}` : '#organizer'}`;

/** Make a picked file into a small logo: a PNG data URL (or WebP or JPEG, if that's too big). */
export async function shrinkLogo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) =>
      Object.assign(new Image(), { onload: (e) => ok(e.target), onerror: bad, src: url }),
    );
    // An SVG without a size of its own fills the box.
    const [w, h] = img.naturalWidth && img.naturalHeight ? [img.naturalWidth, img.naturalHeight] : LOGO_BOX;
    // Small logos are drawn bigger (up to the box), so they stay sharp at the large size.
    const scale = Math.min(LOGO_BOX[0] / w, LOGO_BOX[1] / h);
    const c = Object.assign(document.createElement('canvas'), {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
    });
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    const fits = (d) => (d.length - d.indexOf(',') - 1) * 0.75 <= LOGO_MAX;
    for (const [type, q] of [['image/png'], ['image/webp', 0.9]]) {
      const d = c.toDataURL(type, q);
      if (d.startsWith(`data:${type}`) && fits(d)) return d;
    }
    // JPEG has no transparency: on white.
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** /brand (a new template) or /brand/<id> (managing one, or seeing it from its link). */
export async function renderBrand(id) {
  brandLook(null); // this page keeps Venn's own look (retro by default); the preview shows the brand's
  // The manage link's token, from the fragment: kept here, and out of the address bar.
  const m = id && location.hash.match(/^#admin=([A-Za-z0-9]+)$/);
  if (m) {
    save(key(id), { adminToken: m[1] });
    history.replaceState(null, '', location.pathname);
  }
  const token = id && saved(key(id)).adminToken;
  // From My polls (account.js): the account stands in for the manage link.
  const viaAccount = !!id && location.hash === '#organizer';
  if (viaAccount) history.replaceState(null, '', location.pathname);
  let brand = null;
  if (id) {
    app.innerHTML = '<div class="empty muted">Loading…</div>';
    try {
      brand = await api(`brands/${id}`, {
        headers: { ...(token && { 'x-admin-token': token }), ...((token || viaAccount) && { 'x-organizer': '1' }) },
      });
    } catch (e) {
      document.title = 'Brand template not found · Venn';
      if (e.status === 404) unremember(id);
      app.innerHTML = `<div class="sheet empty"><h1>${e.status === 404 ? 'Brand template not found' : "Can't open this template"}</h1><p class="muted">${esc(e.status === 404 ? 'It may have been deleted, or the link wasn’t copied in full.' : e.message)}</p><a class="btn btn-primary" href="/brand" data-link>Make a brand template</a></div>`;
      return;
    }
    if (!brand.isAdmin && token) forget(key(id), 'adminToken');
  }
  if (brand && !brand.isAdmin) return showPublic(brand);
  if (brand) remember(id, brand.name);
  return showForm(brand, token);
}

/** Someone with the share link, not the manage link: the template, and one button to use it. */
function showPublic(b) {
  document.title = `${b.name} · Venn`;
  app.innerHTML = `
    <div class="create brand-page">
      <h1>${esc(b.name)}’s template</h1>
      <p><a class="btn btn-primary btn-lg" href="/new?brand=${esc(b.id)}" data-link>Make a poll with it</a></p>
      ${previewBox(false)}
    </div>`;
  livePreview(() => ({ brand: b, view: 'guest' }))();
}

/** Making a template, or (with `b`) changing one. */
function showForm(b, token) {
  document.title = b ? `${b.name} · Brand template · Venn` : 'Brand template · Venn';
  const v = (k) => esc(b?.[k] || '');
  const others = mine().filter((x) => x.id !== b?.id);
  let logo = b?.logo || null; // what shows: the saved one's URL, or a new one's data URL
  let logoChanged = false;
  app.innerHTML = `
    <form id="brand-form" class="create brand-page" novalidate>
      <h1>${b ? 'Your brand template' : 'Make a brand template'}</h1>
      <p class="lede create-lede">Polls your team makes from it show your logo, colours and fonts to everyone.</p>
      ${b ? links(b.id, token) : ''}
      ${previewBox(true)}
      <section class="sheet" aria-labelledby="org-h">
        <h2 id="org-h">Your organization</h2>
        <label for="b-name">Name <span class="req" aria-hidden="true">Required</span></label>
        <input id="b-name" type="text" maxlength="60" value="${v('name')}" placeholder="Acme Inc." aria-required="true" autocomplete="organization">
        <div>
          <span class="label" id="logo-l">Logo</span>
          <div class="logo-row">
            <div class="logo-box" id="logo-box" aria-hidden="true"></div>
            <div class="logo-actions">
              <button type="button" class="btn" id="logo-pick" aria-describedby="logo-l"></button>
              <button type="button" class="link-btn" id="logo-remove">Remove</button>
            </div>
          </div>
          <input type="file" id="logo-file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden>
        </div>
        <div id="logo-more">
          <span class="label" id="size-l">Logo size</span>
          <div class="seg" role="radiogroup" aria-labelledby="size-l">
            ${Object.entries(LOGO_SIZES)
              .map(
                ([k, [name]]) =>
                  `<button type="button" role="radio" data-logo-size="${k}" aria-checked="${k === (b?.logoSize || 'small')}">${name}</button>`,
              )
              .join('')}
          </div>
          <label class="switch"><input type="checkbox" role="switch" id="b-show-name"${b?.hideName ? '' : ' checked'}> Name next to the logo</label>
        </div>
      </section>
      <section class="sheet" aria-labelledby="colours-h">
        <h2 id="colours-h">Colours</h2>
        <div class="color-row">
          <label for="b-accent">Buttons and links</label>
          <input id="b-accent" type="color" value="${esc(b?.accent || DEFAULT_ACCENT)}">
        </div>
        <div>
          <span class="label" id="page-l">Page</span>
          <div class="seg" role="radiogroup" aria-labelledby="page-l">
            <button type="button" role="radio" data-page="venn" aria-checked="${!b?.bg}">Venn’s light and dark</button>
            <button type="button" role="radio" data-page="own" aria-checked="${!!b?.bg}">Your own</button>
          </div>
        </div>
        <div class="color-grid" id="own-colours"${b?.bg ? '' : ' hidden'}>
          ${[
            ['bg', 'Background'],
            ['surface', 'Cards'],
            ['text', 'Text'],
          ]
            .map(
              ([k, l]) =>
                `<div class="color-row"><label for="b-${k}">${l}</label><input id="b-${k}" type="color" value="${esc(b?.[k] || OWN[k])}"></div>`,
            )
            .join('')}
        </div>
        <div>
          <span class="label" id="answers-l">Answers</span>
          <div class="seg" role="radiogroup" aria-labelledby="answers-l">
            <button type="button" role="radio" data-answers="venn" aria-checked="${!hasKey(b)}">Venn’s</button>
            <button type="button" role="radio" data-answers="own" aria-checked="${hasKey(b)}">Your own</button>
          </div>
        </div>
        <div class="color-grid" id="own-answers"${hasKey(b) ? '' : ' hidden'}>
          ${[
            ['yes', 'Available'],
            ['maybe', 'If needed'],
            ['no', 'Unavailable'],
          ]
            .map(
              ([k, l]) =>
                `<div class="color-row"><label for="b-${k}">${l}</label><input id="b-${k}" type="color" value="${esc(b?.[k] || KEY[k])}"></div>`,
            )
            .join('')}
        </div>
      </section>
      <section class="sheet" aria-labelledby="type-h">
        <h2 id="type-h">Type and shape</h2>
        ${fontPicker('font', 'Headings', b?.font)}
        ${fontPicker('bodyFont', 'Text', b?.bodyFont)}
        <div>
          <span class="label" id="corners-l">Corners</span>
          <div class="seg" role="radiogroup" aria-labelledby="corners-l">
            ${Object.entries(CORNERS)
              .map(
                ([k, [name, r]]) =>
                  `<button type="button" role="radio" data-corners="${k}" aria-checked="${k === (b?.corners || 'soft')}"><span class="corner-swatch" style="border-radius:${Math.round(r / 2.5)}px" aria-hidden="true"></span>${name}</button>`,
              )
              .join('')}
          </div>
        </div>
        <div>
          <span class="label" id="buttons-l">Buttons</span>
          <div class="seg" role="radiogroup" aria-labelledby="buttons-l">
            ${Object.entries(BUTTONS)
              .map(
                ([k, name]) =>
                  `<button type="button" role="radio" data-buttons="${k}" aria-checked="${k === (b?.buttons || 'pill')}"><span class="corner-swatch button-swatch${k === 'pill' ? ' is-pill' : ''}" aria-hidden="true"></span>${name}</button>`,
              )
              .join('')}
          </div>
        </div>
      </section>
      <section class="sheet" aria-labelledby="starts-h">
        <h2 id="starts-h">Every poll starts with</h2>
        <label for="b-title">Name of the poll</label>
        <input id="b-title" type="text" maxlength="120" value="${v('title')}" placeholder="Team lunch">
        <label for="b-where">Where</label>
        <input id="b-where" type="text" maxlength="200" value="${v('where')}" placeholder="The office, or a video link">
        <label for="b-note">Note for everyone</label>
        <textarea id="b-note" maxlength="1000" placeholder="What everyone should know">${v('note')}</textarea>
      </section>
      ${
        others.length
          ? `<section class="sheet" aria-labelledby="mine-h"><h2 id="mine-h">Your other templates</h2><ul class="brand-list">${others
              .map((x) => `<li><a href="/brand/${esc(x.id)}" data-link>${esc(x.name)}</a></li>`)
              .join('')}</ul></section>`
          : ''
      }
      <div class="create-bar">
        <div class="create-sum">
          ${b ? '<button type="button" class="link-btn danger" id="b-delete">Delete template</button>' : ''}
          <span class="error" id="err" role="alert"></span>
        </div>
        <button class="btn btn-primary btn-lg" type="submit" id="submit">${b ? 'Save changes' : 'Save template'}</button>
      </div>
    </form>`;

  const picked = (attr, key = attr) => $(`[data-${attr}][aria-checked="true"]`)?.dataset[key] || '';
  const own = () => picked('page') === 'own';
  const ownKey = () => picked('answers') === 'own';
  const fields = () => ({
    name: $('#b-name').value.trim(),
    accent: $('#b-accent').value,
    ...(own() && { bg: $('#b-bg').value, surface: $('#b-surface').value, text: $('#b-text').value }),
    font: picked('font'),
    bodyFont: picked('body-font', 'bodyFont'),
    ...(ownKey() && { yes: $('#b-yes').value, maybe: $('#b-maybe').value, no: $('#b-no').value }),
    corners: picked('corners') === 'soft' ? '' : picked('corners'),
    buttons: picked('buttons') === 'pill' ? '' : picked('buttons'),
    logoSize: picked('logo-size', 'logoSize') === 'small' ? '' : picked('logo-size', 'logoSize'),
    hideName: !$('#b-show-name').checked,
    title: $('#b-title').value.trim(),
    where: $('#b-where').value.trim(),
    note: $('#b-note').value.trim(),
  });
  // The preview shows the template as it's made; the page keeps Venn's own look.
  const send = livePreview(() => ({
    brand: { ...fields(), name: $('#b-name').value.trim() || 'Your organization', logo },
    view: picked('view') || 'guest',
  }));
  const show = () => {
    send();
    $('#logo-box').innerHTML = logo ? `<img src="${esc(logo)}" alt="">` : '<span>No logo yet</span>';
    $('#logo-pick').textContent = logo ? 'Change logo' : 'Upload logo';
    $('#logo-remove').hidden = $('#logo-more').hidden = !logo;
  };
  show();
  for (const el of ['#b-name', '#b-accent', '#b-bg', '#b-surface', '#b-text', '#b-yes', '#b-maybe', '#b-no', '#b-title'])
    $(el).addEventListener('input', show);
  $('#b-show-name').addEventListener('change', show);
  // Each row of choices (page, fonts, corners) is one radio group.
  $('#brand-form').addEventListener('click', (e) => {
    const btn = e.target.closest('[role="radio"]');
    if (!btn) return;
    for (const x of $$('[role="radio"]', btn.parentElement)) x.setAttribute('aria-checked', String(x === btn));
    $('#own-colours').hidden = !own();
    $('#own-answers').hidden = !ownKey();
    show();
  });
  $('#logo-pick').onclick = () => $('#logo-file').click();
  $('#logo-file').onchange = async () => {
    const file = $('#logo-file').files[0];
    if (!file) return;
    try {
      logo = await shrinkLogo(file);
      logoChanged = true;
      show();
    } catch {
      toast("That file isn't a picture Venn can use. Try a PNG, JPEG or SVG.");
    }
  };
  $('#logo-remove').onclick = () => {
    logo = null;
    logoChanged = true;
    $('#logo-file').value = '';
    show();
  };
  for (const c of $$('[data-copy]'))
    c.onclick = () =>
      navigator.clipboard.writeText(c.dataset.copy).then(
        () => toast('Copied.'),
        () => prompt('Copy this:', c.dataset.copy),
      );
  if ($('#b-delete'))
    $('#b-delete').onclick = () => {
      // Asked in the page, never with confirm() (in-app browsers block it).
      const bar = $('#b-delete').parentElement;
      bar.innerHTML = `<span>Delete it? Its polls go back to Venn’s look.</span> <button type="button" class="link-btn danger" id="b-really">Delete</button> <button type="button" class="link-btn" id="b-keep">Keep</button>`;
      $('#b-keep').onclick = () => showForm(b, token);
      $('#b-really').onclick = async () => {
        try {
          await api(`brands/${b.id}`, { method: 'DELETE', headers: { 'x-admin-token': token } });
          unremember(b.id);
          history.replaceState(null, '', '/brand');
          renderBrand(null);
          toast('Template deleted.');
        } catch (e) {
          $('#err').textContent = e.message;
        }
      };
    };

  $('#brand-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = fields();
    $('#err').textContent = '';
    if (!body.name) {
      $('#err').textContent = 'Add your organization’s name';
      return $('#b-name').focus();
    }
    $('#submit').disabled = true;
    try {
      let id = b?.id;
      let admin = token;
      const headers = () => ({ 'x-admin-token': admin });
      if (b) await api(`brands/${id}`, { method: 'PUT', body, headers: headers() });
      else ({ id, adminToken: admin } = await api('brands', { method: 'POST', body }));
      save(key(id), { adminToken: admin });
      remember(id, body.name);
      if (logoChanged)
        await (logo
          ? api(`brands/${id}/logo`, { method: 'PUT', body: { logo }, headers: headers() })
          : api(`brands/${id}/logo`, { method: 'DELETE', headers: headers() }));
      if (b) {
        $('#submit').disabled = false;
        logoChanged = false;
        return toast('Saved. New polls from it look like this.');
      }
      history.replaceState(null, '', `/brand/${id}`);
      showReady(id, admin, body.name);
    } catch (ex) {
      $('#err').textContent = ex.message;
      $('#submit').disabled = false;
    }
  };
  if (!b) $('#b-name').focus();
}

/** Whether a template has answer colours of its own. */
const hasKey = (b) => !!(b?.yes || b?.maybe || b?.no);

/** A row of fonts to choose from, each shown in itself; the first is Venn's own. */
const fontPicker = (key, label, value = '') => `
  <div>
    <span class="label" id="${key}-l">${label}</span>
    <div class="font-grid" role="radiogroup" aria-labelledby="${key}-l">
      <button type="button" role="radio" data-${key === 'font' ? 'font' : 'body-font'}="" aria-checked="${!value}">Venn</button>
      ${Object.entries(FONTS)
        .map(
          ([k, [name, stack]]) =>
            `<button type="button" role="radio" data-${key === 'font' ? 'font' : 'body-font'}="${k}" aria-checked="${k === value}" style="font-family:${esc(stack)}">${name}</button>`,
        )
        .join('')}
    </div>
  </div>`;

/**
 * The live preview: the real poll page in a frame (brand-demo.js), with a sample poll in the
 * template's look, as a guest or (with `views`) the organizer sees it. Returns the HTML, and `send`
 * gives the frame the template as it is now.
 */
const previewBox = (views) => `
  <div id="preview-box" class="preview-box">
    <p class="pv-top">
      ${
        views
          ? `<span class="seg" role="radiogroup" aria-label="Preview as"><button type="button" role="radio" data-view="guest" aria-checked="true">Guest</button><button type="button" role="radio" data-view="organizer" aria-checked="false">Organizer</button></span>`
          : '<span class="label">Preview</span>'
      }
      <button type="button" class="link-btn" id="pv-toggle" aria-expanded="true" aria-controls="pv-frame">Hide</button>
    </p>
    <iframe id="pv-frame" src="/brand/preview" title="Preview of a poll from this template"></iframe>
  </div>`;

function livePreview(get) {
  const frame = $('#pv-frame');
  let timer;
  const send = () => {
    clearTimeout(timer);
    timer = setTimeout(() => frame.contentWindow?.postMessage(get(), location.origin), 120);
  };
  // The frame says when it's ready (and again if it reloads).
  const ready = (e) => e.source === frame.contentWindow && e.data?.previewReady && send();
  addEventListener('message', ready);
  // On a phone the preview stays pinned over the form; it can be folded away.
  $('#pv-toggle').onclick = () => {
    const open = frame.hidden;
    frame.hidden = !open;
    $('#pv-toggle').setAttribute('aria-expanded', String(open));
    $('#pv-toggle').textContent = open ? 'Hide' : 'Show';
  };
  return send;
}

/** The template's two links: one for the team, one to keep. */
const links = (id, token) => `
  <section class="sheet brand-links" aria-labelledby="links-h">
    <h2 id="links-h">Share with your team</h2>
    <p class="hint">Anyone with this link makes polls in your look.</p>
    <p class="link-row"><input type="text" readonly value="${esc(shareUrl(id))}" aria-label="Link for your team"><button type="button" class="btn btn-primary" data-copy="${esc(shareUrl(id))}">Copy link</button></p>
    <p class="hint">Your manage link changes this template. Keep it private, as nobody can send it to you again.</p>
    <p class="link-row"><input type="text" readonly value="${esc(manageUrl(id, token))}" aria-label="Your manage link"><button type="button" class="btn" data-copy="${esc(manageUrl(id, token))}">Copy</button></p>
    <p><a class="btn" href="/new?brand=${esc(id)}" data-link>Make a poll with it</a></p>
  </section>`;

/** Just saved: the links, first. */
function showReady(id, token, name) {
  renderBrand(id).then(() => {
    toast(`${name}’s template is ready. Copy your manage link somewhere safe.`);
    $('.brand-links')?.scrollIntoView({ block: 'start' });
  });
}
