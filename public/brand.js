// Brand templates (/brand): an organization's own template, with its logo, colour and font, and what
// its polls start with. No accounts: saving gives a share link for the team (/new?brand=<id>) and a
// private manage link (/brand/<id>#admin=<token>), kept in this browser too, like a poll's organizer
// link. See src/brands.js. Loaded only on these pages.

import { CORNERS, FONTS, brandBar, brandLook, brandPreview } from './brand-look.js';
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
const manageUrl = (id, token) => `${location.origin}/brand/${id}#admin=${token}`;

/** Make a picked file into a small logo: a PNG data URL (or WebP or JPEG, if that's too big). */
export async function shrinkLogo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) =>
      Object.assign(new Image(), { onload: (e) => ok(e.target), onerror: bad, src: url }),
    );
    const scale = Math.min(1, LOGO_BOX[0] / img.naturalWidth, LOGO_BOX[1] / img.naturalHeight);
    const c = Object.assign(document.createElement('canvas'), {
      width: Math.max(1, Math.round(img.naturalWidth * scale)),
      height: Math.max(1, Math.round(img.naturalHeight * scale)),
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
  let brand = null;
  if (id) {
    app.innerHTML = '<div class="empty muted">Loading…</div>';
    try {
      brand = await api(`brands/${id}`, { headers: token ? { 'x-admin-token': token } : {} });
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
      ${preview(b)}
      <a class="btn btn-primary btn-lg" href="/new?brand=${esc(b.id)}" data-link>Make a poll with it</a>
    </div>`;
  brandPreview(b, '#brand-preview');
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
      <div id="preview-box"></div>
      <section class="sheet" aria-labelledby="org-h">
        <h2 id="org-h">Your organization</h2>
        <div class="title-row">
          <button type="button" class="emoji-tile logo-tile" id="logo-tile" aria-label="Add a logo"></button>
          <div class="grow">
            <label for="b-name">Name <span class="req" aria-hidden="true">Required</span></label>
            <input id="b-name" type="text" maxlength="60" value="${v('name')}" placeholder="Acme Inc." aria-required="true" autocomplete="organization">
          </div>
        </div>
        <input type="file" id="logo-file" accept="image/png,image/jpeg,image/webp" hidden>
        <p class="hint" id="logo-row" hidden><button type="button" class="link-btn" id="logo-remove">Remove logo</button></p>
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
  const fields = () => ({
    name: $('#b-name').value.trim(),
    accent: $('#b-accent').value,
    ...(own() && { bg: $('#b-bg').value, surface: $('#b-surface').value, text: $('#b-text').value }),
    font: picked('font'),
    bodyFont: picked('body-font', 'bodyFont'),
    corners: picked('corners') === 'soft' ? '' : picked('corners'),
    title: $('#b-title').value.trim(),
    where: $('#b-where').value.trim(),
    note: $('#b-note').value.trim(),
  });
  // The preview shows the look as it's chosen; the page keeps Venn's own.
  const show = () => {
    const f = fields();
    $('#preview-box').innerHTML = preview({ ...f, logo });
    brandPreview(f, '#brand-preview');
    $('#logo-tile').innerHTML = logo ? `<img src="${esc(logo)}" alt="">` : '<span aria-hidden="true">+</span>';
    $('#logo-tile').setAttribute('aria-label', logo ? 'Change the logo' : 'Add a logo');
    $('#logo-row').hidden = !logo;
  };
  show();
  for (const el of ['#b-name', '#b-accent', '#b-bg', '#b-surface', '#b-text', '#b-title']) $(el).addEventListener('input', show);
  // Each row of choices (page, fonts, corners) is one radio group.
  $('#brand-form').addEventListener('click', (e) => {
    const btn = e.target.closest('[role="radio"]');
    if (!btn) return;
    for (const x of $$('[role="radio"]', btn.parentElement)) x.setAttribute('aria-checked', String(x === btn));
    $('#own-colours').hidden = !own();
    show();
  });
  $('#logo-tile').onclick = () => $('#logo-file').click();
  $('#logo-file').onchange = async () => {
    const file = $('#logo-file').files[0];
    if (!file) return;
    try {
      logo = await shrinkLogo(file);
      logoChanged = true;
      show();
    } catch {
      toast("That file isn't a picture Venn can use. Try a PNG or JPEG.");
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

/** What a poll from it looks like, in its look: the bar, its name, a card with answers and Create. */
const preview = (b) => `
  <section class="brand-preview" id="brand-preview" aria-label="How your polls look">
    ${b.name || b.logo ? brandBar(b, esc) : ''}
    <p class="pv-title">${esc(b.title || 'Team lunch')}</p>
    <div class="pv-card" aria-hidden="true">
      <p class="pv-day">Friday, Nov 13</p>
      <p class="pv-muted">3 can make it</p>
      <p class="pv-row"><span class="pv-pill pv-yes">Yes</span><span class="pv-pill pv-maybe">If needed</span><span class="pv-pill">No</span></p>
    </div>
    <p class="pv-row" aria-hidden="true"><span class="pv-btn">Send my answer</span></p>
  </section>`;

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
