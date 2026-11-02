// Brand templates (/brand): an organization's own template, with its logo, colour and font, and what
// its polls start with. Saving gives a share link for the team (/new?brand=<id>) and a private manage
// link (/brand/<id>#admin=<token>), kept in this browser too, like a poll's organizer link. Where the
// server has sign-in (src/auth.js), saving a new one needs an account, and it's kept there (My polls);
// the draft waits in this tab while its maker signs in. See src/brands.js. Loaded only on these pages.

import { BUTTONS, CORNERS, FONTS, LOGO_SIZES, brandLook, mainColours, scheme } from './brand-look.js';
import { $, $$, api, app, esc, forget, getConfig, save, saved, toast } from './ui.js';
import { accountHint, refreshAccountMenu } from './account-menu.js';
import { signInAgree, signInButtons } from './account-data.js';

// The create pages' styles (forms, the sticky bar), and this page's own.
const sheet = (href) =>
  new Promise((done) =>
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href, onload: done, onerror: done })),
  );
await Promise.all([sheet('/create.css'), sheet('/brand.css'), sheet('/account.css')]);

const DEFAULT_ACCENT = '#0b7a5c';
// A page of its own starts white, with light grey cards and near-black text.
const OWN = { bg: '#ffffff', surface: '#f4f4f5', text: '#16181a' };
// Where a template's own dark mode starts: Venn's dark page, cards and text.
const DARK = { darkBg: '#0f1112', darkSurface: '#171a1c', darkText: '#f1eee8', darkAccent: '#8fb0ff' };
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

// A new template's draft, kept in this tab while its maker signs in to save it.
const DRAFT = 'venn:brand-draft';
function takeDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT));
    return d && typeof d === 'object' && d.fields && typeof d.fields.name === 'string' ? d : null;
  } catch {
    return null;
  }
}
const keepDraft = (d) => {
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify(d));
  } catch {}
};
const dropDraft = () => {
  try {
    sessionStorage.removeItem(DRAFT);
  } catch {}
};

/**
 * /brand (For organizations: what a template is, and a button to make one), /brand/new (making
 * one) or /brand/<id> (managing one, or seeing it from its link).
 */
export async function renderBrand(id) {
  const making = id === 'new';
  if (making) id = null;
  brandLook(null); // this page keeps Venn's own look (retro by default); the preview shows the brand's
  // The manage link's token, from the fragment: kept here, and out of the address bar.
  const m = id && location.hash.match(/^#admin=([A-Za-z0-9]+)$/);
  if (m) {
    save(key(id), { adminToken: m[1] });
    history.replaceState(null, '', location.pathname);
    import('./keep.js').then((k) => k.keepThisBrowser()).catch(() => {}); // signed in: it's in their templates
  }
  // An invite link (#join=<secret>): out of the address bar, and never stored. Signing in first
  // carries it in the sign-in's way back (src/auth.js safeNext), so it isn't kept in the browser.
  const j = id && location.hash.match(/^#join=([A-Za-z0-9]{1,64})$/);
  if (j) history.replaceState(null, '', location.pathname);
  const token = id && saved(key(id)).adminToken;
  // From My polls (account.js): the account stands in for the manage link.
  // Opened that way once, this browser asks for it the same way again (after a reload, too).
  let viaAccount = !!id && (location.hash === '#organizer' || !!saved(key(id)).viaAccount);
  if (location.hash === '#organizer') history.replaceState(null, '', location.pathname);
  if (j) {
    const joined = await join(id, j[1]);
    if (joined === 'signin') return;
    if (joined) viaAccount = true;
  }
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
    if (brand.role && !token) save(key(id), { viaAccount: true });
    else if (!brand.role) forget(key(id), 'viaAccount');
  }
  if (brand && !brand.isAdmin) return showPublic(brand);
  if (brand?.role === 'admin') forget(key(id), 'adminToken');
  if (brand) remember(id, brand.name);
  // Back from signing in to save: the draft as it was, saved straight away once signed in.
  // Making a template needs an account, where the server has sign-in (src/auth.js); the templates
  // that exist keep working by their links. Signed out, the page asks first and comes back here.
  if (!id) {
    const [providers, me] = await Promise.all([
      getConfig().then(
        (c) => c.accounts || [],
        () => [],
      ),
      api('me').catch(() => ({})),
    ]);
    const signedOut = providers.length > 0 && !me.user;
    // Signed in (perhaps just now): the top bar and Save know it.
    if (me.user) {
      accountHint({
        initial: (me.user.name || me.user.email || '?').trim().charAt(0).toUpperCase(),
        name: me.user.name || me.user.email || '',
      });
      refreshAccountMenu();
    }
    if (!making) return showIntro(signedOut);
    if (signedOut && !takeDraft()) return showSignIn(providers);
  }
  const draft = !id && takeDraft();
  if (draft) {
    const failed = location.hash === '#signin-failed';
    if (location.hash) history.replaceState(null, '', location.pathname);
    const me = await api('me').catch(() => ({}));
    const off = showForm(null, null, draft.step, { ...draft.fields, logo: draft.logo || null });
    if (me.user) $('#brand-form').requestSubmit();
    else if (failed) toast('Sign-in didn’t finish. Try again.');
    return off;
  }
  return showForm(brand, token);
}

// For organizations shows one poll in three organizations' own looks: what a template changes.
const FAN = [
  ['N', 'Northwind', 'editorial'],
  ['O', 'Orbit', 'midnight'],
  ['B', 'Bloom', 'playful'],
];
/** A poll in a look: its logo and name, the poll's title, its best days and its button. */
const fanCard = ([mark, name, look]) => {
  const l = LOOKS[look][1];
  const r = CORNERS[l.corners || 'soft'][1];
  // Its colours as on its polls (made readable), then its corners and fonts.
  const vars = [
    scheme(l).vars.replace(/;$/, ''),
    `--fr:${r}px`,
    `--fbr:${l.buttons === 'corners' ? `${r}px` : '999px'}`,
    `--fh:${FONTS[l.font]?.[1] || 'inherit'}`,
    `--fx:${FONTS[l.bodyFont]?.[1] || 'inherit'}`,
  ].join(';');
  const day = (d, yes, maybe) =>
    `<span class="fan-row"><span>${d}</span><span class="fan-bar"><i style="flex:${yes}"></i><i style="flex:${maybe}"></i><i style="flex:${4 - yes - maybe}"></i></span></span>`;
  return `<div class="fan-card" style="${esc(vars)}">
    <span class="fan-brand"><span class="fan-logo">${mark}</span>${name}</span>
    <span class="fan-title">Team lunch</span>
    ${day('Thu, Nov 5', 3, 1)}${day('Fri, Nov 6', 2, 1)}
    <span class="fan-btn">Pick this date</span>
  </div>`;
};

/** For organizations: what a template is (the same poll in three looks), and the button to make one. */
function showIntro(signedOut) {
  document.title = 'For organizations · Venn';
  const yours = mine();
  app.innerHTML = `
    <div class="create brand-intro">
      <div class="intro-text">
        <h1>Your brand on every poll</h1>
        <p class="lede">Your logo, colours, fonts and buttons on every poll your team makes.</p>
        <p><a class="btn btn-primary btn-lg" href="/brand/new" data-link>${signedOut ? 'Sign in to make yours' : 'Make your template'}</a></p>
        ${
          yours.length
            ? `<h2 id="mine-h">Your templates</h2><ul class="brand-list" aria-labelledby="mine-h">${yours
                .map((x) => `<li><a href="/brand/${esc(x.id)}" data-link>${esc(x.name)}</a></li>`)
                .join('')}</ul>`
            : ''
        }
      </div>
      <div class="fan" role="img" aria-label="The same poll in three organizations’ own looks">${FAN.map(fanCard).join('')}</div>
    </div>`;
}

/** Signing in (or making an account) to make a template: the ways in, and back here after. */
function signInPanel(providers, heading, next = '/brand/new', why = 'Your templates are kept in your account, on any device.') {
  const html = `
    <h2 id="save-signin-h">${heading}</h2>
    <p class="muted">${why}</p>
    <div class="signin">${signInButtons(providers, next)}</div>
    ${providers.includes('email') ? '<div id="save-email"></div>' : ''}
    ${signInAgree()}`;
  const wire = () => {
    // Or with an email and password (email-signin.js).
    if (providers.includes('email'))
      import('./email-signin.js').then(({ emailSignInForm, wireEmailSignIn }) => {
        $('#save-email').innerHTML = emailSignInForm({ alone: providers.length === 1 });
        wireEmailSignIn({ onSignedIn: () => location.assign(next) });
      });
  };
  return [html, wire];
}

/** Signed out, on the way to making a template: sign in first. */
function showSignIn(providers) {
  document.title = 'Sign in · For organizations · Venn';
  const [html, wire] = signInPanel(providers, 'Sign in to make your template');
  app.innerHTML = `<div class="sheet brand-signin save-signin">${html.replace(/<(\/?)h2/g, '<$1h1')}</div>`;
  wire();
}

// ---------- sharing: invite links, and who has the template ----------

const inviteUrl = (id, secret) => `${location.origin}/brand/${id}#join=${secret}`;

/**
 * Opened from an invite link: the template goes in this account's templates, with what the link
 * lets them do. Signed out, they sign in first and come back here. Returns the role, null (the link
 * didn't work) or 'signin' (the page is asking them to).
 */
async function join(id, secret) {
  try {
    const { role } = await api(`brands/${id}/join`, { method: 'POST', body: { token: secret } });
    // Signed in (perhaps just now): the top bar knows it.
    const me = await api('me').catch(() => ({}));
    if (me.user)
      accountHint({
        initial: (me.user.name || me.user.email || '?').trim().charAt(0).toUpperCase(),
        name: me.user.name || me.user.email || '',
      });
    refreshAccountMenu();
    toast(
      role === 'admin'
        ? 'Added to your templates. You can change it.'
        : role === 'owner'
          ? 'It’s your own template.'
          : 'Added to your templates.',
    );
    return role;
  } catch (e) {
    const providers =
      e.status === 401
        ? await getConfig().then(
            (c) => c.accounts || [],
            () => [],
          )
        : [];
    if (e.status === 401 && providers.length) {
      const b = await api(`brands/${id}`).catch(() => null);
      if (!b) return null;
      document.title = `Sign in · ${b.name} · Venn`;
      const [html, wire] = signInPanel(
        providers,
        `Sign in to add ${esc(b.name)}’s template`,
        `/brand/${id}#join=${secret}`,
        'It goes in your templates, on any device.',
      );
      app.innerHTML = `<div class="sheet brand-signin save-signin">${html.replace(/<(\/?)h2/g, '<$1h1')}</div>`;
      wire();
      return 'signin';
    }
    toast(e.status === 401 ? 'This Venn has no accounts, so the invite can’t be used here.' : e.message);
    return null;
  }
}

// What each invite lets them do, said plainly (admins and users, in the code and the API).
const ROLE_NAMES = { admin: 'Can edit', user: 'Can use' };

/** The owner's sharing: invite links for admins and users, who has it, and turning the links off. */
async function drawSharing(b, token) {
  const box = $('#b-sharing');
  if (!box) return;
  const headers = token ? { 'x-admin-token': token } : {};
  let data;
  try {
    data = await api(`brands/${b.id}/sharing`, { headers });
  } catch (e) {
    box.innerHTML = `<p class="hint">${esc(e.message)}</p>`;
    return;
  }
  const links = data.invites.admin + data.invites.user;
  const member = (m) => `
    <li class="member">
      <span class="member-name">${esc(m.name)}</span>
      <select class="member-role" data-member="${esc(m.userId)}" aria-label="What ${esc(m.name)} can do">
        ${Object.entries(ROLE_NAMES)
          .map(([r, label]) => `<option value="${r}"${m.role === r ? ' selected' : ''}>${label}</option>`)
          .join('')}
      </select>
      <button type="button" class="link-btn danger" data-remove="${esc(m.userId)}" aria-label="Remove ${esc(m.name)}">Remove</button>
    </li>`;
  box.innerHTML = `
    <h3 id="share-h">Share it</h3>
    <p class="hint">Send someone a link. They open it, sign in, and it’s in their templates. <b>Use</b>: they make polls with it. <b>Edit</b>: they can change it too, so send that one only to people you trust.</p>
    <div class="invite-row">
      <button type="button" class="btn" data-invite="user">Copy link to use</button>
      <button type="button" class="btn" data-invite="admin">Copy link to edit</button>
    </div>
    ${
      data.members.length
        ? `<ul class="member-list" aria-labelledby="share-h">${data.members.map(member).join('')}</ul>`
        : '<p class="hint">Nobody else has it yet.</p>'
    }
    ${links ? `<p class="hint invite-off">${links === 1 ? '1 invite link works' : `${links} invite links work`}. <button type="button" class="link-btn" id="invites-off">Turn them off</button></p>` : ''}`;
  for (const btn of box.querySelectorAll('[data-invite]'))
    btn.onclick = async () => {
      const role = btn.dataset.invite;
      // The last link made here, while it still works; otherwise a new one.
      let secret = data.invites[role] ? saved(key(b.id))[`invite-${role}`] : null;
      try {
        if (!secret) {
          secret = (await api(`brands/${b.id}/invites`, { method: 'POST', body: { role }, headers })).token;
          save(key(b.id), { [`invite-${role}`]: secret });
        }
      } catch (e) {
        return toast(e.message);
      }
      const url = inviteUrl(b.id, secret);
      navigator.clipboard.writeText(url).then(
        () => toast(`Link copied. Whoever opens it ${role === 'admin' ? 'can use and change' : 'can use'} this template.`),
        () => prompt('Copy this:', url),
      );
      if (!data.invites[role]) drawSharing(b, token);
    };
  for (const sel of box.querySelectorAll('[data-member]'))
    sel.onchange = async () => {
      try {
        await api(`brands/${b.id}/members/${sel.dataset.member}`, { method: 'PUT', body: { role: sel.value }, headers });
        toast(sel.value === 'admin' ? 'They can change it now.' : 'They can use it, not change it.');
      } catch (e) {
        toast(e.message);
        drawSharing(b, token);
      }
    };
  for (const btn of box.querySelectorAll('[data-remove]'))
    btn.onclick = async () => {
      try {
        await api(`brands/${b.id}/members/${btn.dataset.remove}`, { method: 'DELETE', headers });
        toast('Removed. Their polls keep the look.');
      } catch (e) {
        toast(e.message);
      }
      drawSharing(b, token);
    };
  if ($('#invites-off'))
    $('#invites-off').onclick = async () => {
      try {
        await api(`brands/${b.id}/invites`, { method: 'DELETE', headers });
        forget(key(b.id), 'invite-admin', 'invite-user');
        toast('Invite links turned off. Everyone who joined keeps it.');
      } catch (e) {
        toast(e.message);
      }
      drawSharing(b, token);
    };
}

/** Leave a template shared with this account: it's off their templates, and they go to them. */
async function leave(b) {
  try {
    await api(`me/brands/${b.id}`, { method: 'DELETE' });
    unremember(b.id);
    toast(`${b.name}’s template is off your templates.`);
    history.pushState(null, '', '/me');
    dispatchEvent(new PopStateEvent('popstate'));
  } catch (e) {
    toast(e.message);
  }
}

/**
 * Someone with the share link, not the manage link: the template, and one button to use it. Shared
 * with them as a user: it's in their templates, and they can leave it.
 */
function showPublic(b) {
  document.title = `${b.name} · Venn`;
  const user = b.role === 'user';
  app.innerHTML = `
    <div class="create brand-page">
      <h1>${esc(b.name)}’s template</h1>
      ${user ? '<p class="hint">In your templates, to make polls with. Its owner can change it.</p>' : ''}
      <p><a class="btn btn-primary btn-lg" href="/new?brand=${esc(b.id)}" data-link>Make a poll with it</a></p>
      ${previewBox(false)}
      ${user ? '<p class="delete-row"><button type="button" class="link-btn danger" id="b-leave">Leave template</button></p>' : ''}
    </div>`;
  livePreview(() => ({ brand: b, view: 'guest' }))();
  if (user) $('#b-leave').onclick = () => leave(b);
}

/**
 * The steps, in the poll page's order: each changes one part of a poll, and while it's open the
 * preview shows that part, ringed (brand-demo.js). [id, name, the part it changes]
 */
const STEPS = [
  ['name', 'Name and logo', 'logo'],
  ['look', 'Starting look', 'top'],
  ['colours', 'Colours', 'colours'],
  ['answers', 'Answers', 'answers'],
  ['headings', 'Headings', 'headings'],
  ['text', 'Text', 'text'],
  ['shape', 'Corners and buttons', 'shape'],
  ['embed', 'White label', 'top'],
  ['poll', 'Poll details', 'poll'],
];

/**
 * Looks to start from: one tap sets the colours, fonts and shape, and everything stays editable.
 * The first two are Venn's own built-in looks, Retro and Classic: My polls' Templates duplicates
 * them into a template of your own (/brand/new?look=retro).
 */
export const LOOKS = {
  retro: [
    'Retro',
    {
      accent: '#2de2e6',
      bg: '#0d0221',
      surface: '#150a35',
      text: '#f5f0ff',
      yes: '#2bf5a0',
      maybe: '#ffd319',
      no: '#ff3cac',
      font: 'retro',
      bodyFont: 'sans',
    },
  ],
  classic: ['Classic', { accent: DEFAULT_ACCENT }],
  editorial: [
    'Editorial',
    {
      accent: '#8a2b0e',
      bg: '#fbf7f0',
      surface: '#ffffff',
      text: '#1d1a16',
      font: 'elegant',
      bodyFont: 'serif',
      corners: 'square',
      buttons: 'corners',
    },
  ],
  midnight: [
    'Midnight',
    { accent: '#7c9cff', bg: '#0e1220', surface: '#171c2e', text: '#e8ecf8', font: 'sans', bodyFont: 'sans', corners: 'round' },
  ],
  playful: [
    'Playful',
    {
      accent: '#e5487a',
      bg: '#fff6ea',
      surface: '#ffffff',
      text: '#2a1b12',
      font: 'rounded',
      bodyFont: 'rounded',
      corners: 'round',
    },
  ],
  tech: [
    'Tech',
    {
      accent: '#2563eb',
      bg: '#f6f7f9',
      surface: '#ffffff',
      text: '#0f172a',
      font: 'mono',
      bodyFont: 'sans',
      corners: 'square',
      buttons: 'corners',
    },
  ],
  forest: [
    'Forest',
    { accent: '#2f6b3a', bg: '#f3f1e8', surface: '#fbfaf5', text: '#1f2a1f', font: 'slab', bodyFont: 'humanist' },
  ],
};

/** A look's card: its page, a heading in its font and a button in its colour. */
const lookCard = (k, name, l) =>
  `<button type="button" class="look-card" data-look="${k}" style="--lb:${l.bg || '#faf8f4'};--ls:${l.surface || '#ffffff'};--lt:${l.text || '#16181a'};--la:${l.accent};--lr:${CORNERS[l.corners || 'soft'][1] / 2}px;--lbr:${l.buttons === 'corners' ? `${CORNERS[l.corners || 'soft'][1] / 2}px` : '999px'};--lf:${esc(FONTS[l.font]?.[1] || 'inherit')}"><span class="look-sample" aria-hidden="true"><span class="look-aa">Aa</span><span class="look-btn"></span></span><span class="look-name">${esc(name)}</span></button>`;

/** Making a template, or (with `b`) changing one: a step at a time, with the preview beside it. */
function showForm(b, token, start, draft = null) {
  document.title = b ? `${b.name} · Brand template · Venn` : 'Brand template · Venn';
  // What the form starts with: the saved template, or a new one's draft kept while its maker signed in.
  const init = b || draft;
  const v = (k) => esc(init?.[k] || '');
  const others = mine().filter((x) => x.id !== b?.id);
  let logo = init?.logo || null; // what shows: the saved one's URL, or a new one's data URL
  let logoChanged = !b && !!logo;
  // A saved template opens on its links; a new one on its name.
  const steps = b ? [['share', 'Share', 'top'], ...STEPS] : STEPS;
  const ids = steps.map(([id]) => id);
  let at = Math.max(0, ids.indexOf(start || ids[0]));
  const stepList = steps
    .map(
      ([id, name], i) =>
        `<li><button type="button" data-step="${id}"><span class="step-n" aria-hidden="true">${i + 1}</span><span class="step-name">${name}</span></button></li>`,
    )
    .join('');
  const panel = (id, body) => {
    const i = ids.indexOf(id);
    return `<section class="step sheet" data-panel="${id}" aria-labelledby="st-${id}" hidden><h2 id="st-${id}" tabindex="-1"><span class="step-of">${i + 1} of ${ids.length}</span>${steps[i][1]}</h2>${body}</section>`;
  };
  app.innerHTML = `
    <form id="brand-form" class="create brand-page brand-editor" novalidate>
      <h1>${b ? 'Your brand template' : 'Make a brand template'}</h1>
      <nav class="steps" aria-label="Steps"><ol>${stepList}</ol></nav>
      ${previewBox(true)}
      <div class="step-panels">
        ${b ? panel('share', links(b, token, others)) : ''}
        ${panel(
          'name',
          `<label for="b-name">Organization <span class="req" aria-hidden="true">Required</span></label>
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
                    `<button type="button" role="radio" data-logo-size="${k}" aria-checked="${k === (init?.logoSize || 'small')}">${name}</button>`,
                )
                .join('')}
            </div>
            <label class="switch"><input type="checkbox" role="switch" id="b-show-name"${init?.hideName ? '' : ' checked'}> Name next to the logo</label>
          </div>`,
        )}
        ${panel(
          'look',
          `<div id="ai-look"></div>
          <div class="look-grid" id="looks">
            ${lookCard('logo', 'Your logo’s colour', LOOKS.classic[1]).replace('<button', '<button id="look-logo" hidden')}
            ${Object.entries(LOOKS)
              .map(([k, [name, l]]) => lookCard(k, name, l))
              .join('')}
          </div>`,
        )}
        ${panel(
          'colours',
          `<div class="color-row">
            <label for="b-accent">Buttons and links</label>
            <input id="b-accent" type="color" value="${esc(init?.accent || DEFAULT_ACCENT)}">
            <span class="from-logo" id="from-logo" hidden></span>
          </div>
          <div>
            <span class="label" id="page-l">Page</span>
            <div class="seg" role="radiogroup" aria-labelledby="page-l">
              <button type="button" role="radio" data-page="venn" aria-checked="${!init?.bg}">Venn’s light and dark</button>
              <button type="button" role="radio" data-page="own" aria-checked="${!!init?.bg}">Your own</button>
            </div>
          </div>
          <div class="color-trio" id="own-colours"${init?.bg ? '' : ' hidden'}>
            ${colourTrio(
              [
                ['bg', 'Background'],
                ['surface', 'Cards'],
                ['text', 'Text'],
              ],
              init,
              OWN,
            )}
          </div>
          <div class="dark-own" id="own-dark"${init?.bg ? '' : ' hidden'}>
            <label class="switch"><input type="checkbox" role="switch" id="b-dark"${init?.darkBg ? ' checked' : ''}> Its own dark mode</label>
            <p class="hint">For people whose phone or computer is set to dark. Off, the page looks the same either way.</p>
            <div id="dark-colours"${init?.darkBg ? '' : ' hidden'}>
              <div class="color-trio">
                ${colourTrio(
                  [
                    ['darkBg', 'Background'],
                    ['darkSurface', 'Cards'],
                    ['darkText', 'Text'],
                  ],
                  init,
                  DARK,
                )}
              </div>
              <div class="color-row">
                <label for="b-darkAccent">Buttons and links</label>
                <input id="b-darkAccent" type="color" value="${esc(init?.darkAccent || DARK.darkAccent)}">
              </div>
            </div>
          </div>`,
        )}
        ${panel(
          'answers',
          `<div class="seg" role="radiogroup" aria-label="Answer colours">
            <button type="button" role="radio" data-answers="venn" aria-checked="${!hasKey(init)}">Venn’s</button>
            <button type="button" role="radio" data-answers="own" aria-checked="${hasKey(init)}">Your own</button>
          </div>
          <div class="color-trio" id="own-answers"${hasKey(init) ? '' : ' hidden'}>
            ${colourTrio(
              [
                ['yes', 'Available'],
                ['maybe', 'If needed'],
                ['no', 'Unavailable'],
              ],
              init,
              KEY,
            )}
          </div>`,
        )}
        ${panel('headings', fontPicker('font', 'Font for headings', init?.font))}
        ${panel('text', fontPicker('bodyFont', 'Font for text', init?.bodyFont))}
        ${panel(
          'shape',
          `<div>
            <span class="label" id="corners-l">Corners</span>
            <div class="seg" role="radiogroup" aria-labelledby="corners-l">
              ${Object.entries(CORNERS)
                .map(
                  ([k, [name, r]]) =>
                    `<button type="button" role="radio" data-corners="${k}" aria-checked="${k === (init?.corners || 'soft')}"><span class="corner-swatch" style="border-radius:${Math.round(r / 2.5)}px" aria-hidden="true"></span>${name}</button>`,
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
                    `<button type="button" role="radio" data-buttons="${k}" aria-checked="${k === (init?.buttons || 'pill')}"><span class="corner-swatch button-swatch${k === 'pill' ? ' is-pill' : ''}" aria-hidden="true"></span>${name}</button>`,
                )
                .join('')}
            </div>
          </div>`,
        )}
        ${panel(
          'poll',
          `<label for="b-title">Name of the poll</label>
          <input id="b-title" type="text" maxlength="120" value="${v('title')}" placeholder="Team lunch">
          <label for="b-where">Where</label>
          <input id="b-where" type="text" maxlength="200" value="${v('where')}" placeholder="The office, or a video link">
          <label for="b-note">Note for everyone</label>
          <textarea id="b-note" maxlength="1000" placeholder="What everyone should know">${v('note')}</textarea>`,
        )}
        ${panel(
          'embed',
          // White label and embedding (src/embed.js, docs/EMBED.md): no Venn, and the sites whose pages can show its polls.
          `<label class="switch"><input type="checkbox" role="switch" id="b-hide-venn"${init?.hideVenn ? ' checked' : ''}> Hide Venn’s name and logo</label>
          <label for="b-sites">Your websites that show its polls</label>
          <textarea id="b-sites" rows="3" placeholder="https://example.com" autocapitalize="off" spellcheck="false" aria-describedby="sites-how">${esc((init?.embedSites || []).join('\n'))}</textarea>
          <p class="hint" id="sites-how">One a line. <a href="https://docs.venn.day/embed.html" target="_blank" rel="noopener">How to show a poll there</a></p>`,
        )}
        <section class="sheet save-signin" id="save-signin" aria-labelledby="save-signin-h" hidden></section>
      </div>
      <div class="create-bar step-bar">
        <button type="button" class="btn" id="back">Back</button>
        <details class="step-menu" id="step-menu">
          <summary><span class="step-of" id="menu-of"></span><span class="step-name" id="menu-name"></span></summary>
          <ol>${stepList}</ol>
        </details>
        <span class="error" id="err" role="alert"></span>
        <button type="submit" class="btn" id="submit">${b ? 'Save' : 'Save template'}</button>
        <button type="button" class="btn btn-primary" id="next">Next</button>
      </div>
    </form>`;

  const picked = (attr, key = attr) => $(`[data-${attr}][aria-checked="true"]`)?.dataset[key] || '';
  const pick = (attr, value) => {
    for (const x of $$(`[data-${attr}]`)) x.setAttribute('aria-checked', String(x.getAttribute(`data-${attr}`) === value));
  };
  const own = () => picked('page') === 'own';
  const ownKey = () => picked('answers') === 'own';
  const fields = () => ({
    name: $('#b-name').value.trim(),
    accent: $('#b-accent').value,
    ...(own() && { bg: $('#b-bg').value, surface: $('#b-surface').value, text: $('#b-text').value }),
    ...(own() &&
      $('#b-dark').checked && {
        darkBg: $('#b-darkBg').value,
        darkSurface: $('#b-darkSurface').value,
        darkText: $('#b-darkText').value,
        darkAccent: $('#b-darkAccent').value,
      }),
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
    hideVenn: $('#b-hide-venn').checked,
    embedSites: $('#b-sites')
      .value.split(/[\s,]+/)
      .filter(Boolean),
  });
  // The preview shows the template as it's made, at the part the open step changes; the page keeps
  // Venn's own look.
  const send = livePreview(() => ({
    brand: { ...fields(), name: $('#b-name').value.trim() || 'Your organization', logo },
    view: picked('view') || 'guest',
    focus: steps[at][2],
  }));
  // The logo's own colours, offered for the buttons and as a look.
  let colours = [];
  const offerColours = async () => {
    colours = logo ? await logoColours(logo) : [];
    $('#from-logo').hidden = !colours.length;
    $('#from-logo').innerHTML = colours
      .map(
        (c) =>
          `<button type="button" class="swatch" data-colour="${c}" style="background:${c}" aria-label="Your logo’s ${c}"></button>`,
      )
      .join('');
    $('#look-logo').hidden = !colours.length;
    if (colours.length) $('#look-logo').style.setProperty('--la', colours[0]);
  };
  const show = () => {
    send();
    $('#logo-box').innerHTML = logo ? `<img src="${esc(logo)}" alt="">` : '<span>No logo yet</span>';
    $('#logo-pick').textContent = logo ? 'Change logo' : 'Upload logo';
    $('#logo-remove').hidden = $('#logo-more').hidden = !logo;
    $('#own-colours').hidden = $('#own-dark').hidden = !own();
    $('#dark-colours').hidden = !$('#b-dark').checked;
    $('#own-answers').hidden = !ownKey();
  };
  const setColour = (id, value) => {
    if (value) $(id).value = value;
  };
  /** Fill every setting from a look (its colours, fonts and shape), then show it. */
  const applyLook = (l) => {
    setColour('#b-accent', l.accent);
    pick('page', l.bg ? 'own' : 'venn');
    for (const k of ['bg', 'surface', 'text']) setColour(`#b-${k}`, l[k]);
    $('#b-dark').checked = !!l.darkBg;
    for (const k of Object.keys(DARK)) setColour(`#b-${k}`, l[k]);
    pick('answers', l.yes ? 'own' : 'venn');
    for (const k of Object.keys(KEY)) setColour(`#b-${k}`, l[k] || KEY[k]);
    pick('font', l.font || '');
    pick('body-font', l.bodyFont || '');
    pick('corners', l.corners || 'soft');
    pick('buttons', l.buttons || 'pill');
    show();
  };

  /** Open a step: its settings, and the part of the poll it changes. */
  const go = (i, { focus = true } = {}) => {
    at = Math.max(0, Math.min(ids.length - 1, i));
    for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== ids[at];
    for (const s of $$('[data-step]')) {
      const n = ids.indexOf(s.dataset.step);
      if (n === at) s.setAttribute('aria-current', 'step');
      else s.removeAttribute('aria-current');
      s.classList.toggle('done', n < at);
    }
    $('#menu-of').textContent = `${at + 1}/${ids.length}`;
    $('#menu-name').textContent = steps[at][1];
    $('#step-menu').open = false;
    const last = at === ids.length - 1;
    $('#back').disabled = at === 0;
    $('#next').hidden = last;
    // The last step saves; a saved template can be saved from any step.
    $('#submit').hidden = b ? ids[at] === 'share' : !last;
    $('#submit').classList.toggle('btn-primary', last);
    $('#err').textContent = '';
    send();
    if (focus) $(`#st-${ids[at]}`).focus({ preventScroll: true });
    // On a phone each step starts at its top.
    $('.step-panels').scrollTop = 0;
  };
  go(at, { focus: false });
  show();
  offerColours();

  for (const el of [
    '#b-name',
    '#b-accent',
    '#b-bg',
    '#b-surface',
    '#b-text',
    '#b-darkBg',
    '#b-darkSurface',
    '#b-darkText',
    '#b-darkAccent',
    '#b-yes',
    '#b-maybe',
    '#b-no',
    '#b-title',
    '#b-where',
    '#b-note',
  ])
    $(el).addEventListener('input', show);
  $('#b-show-name').addEventListener('change', show);
  $('#b-hide-venn').addEventListener('change', show);
  $('#b-dark').addEventListener('change', show);
  $('#back').onclick = () => go(at - 1);
  $('#next').onclick = () => go(at + 1);
  $('#brand-form').addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) return go(ids.indexOf(step.dataset.step));
    const look = e.target.closest('[data-look]');
    if (look) {
      return applyLook(look.dataset.look === 'logo' ? { ...LOOKS.classic[1], accent: colours[0] } : LOOKS[look.dataset.look][1]);
    }
    const swatch = e.target.closest('[data-colour]');
    if (swatch) {
      $('#b-accent').value = swatch.dataset.colour;
      return show();
    }
    // Each row of choices (page, fonts, corners) is one radio group.
    const btn = e.target.closest('[role="radio"]');
    if (!btn) return;
    for (const x of $$('[role="radio"]', btn.parentElement)) x.setAttribute('aria-checked', String(x === btn));
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
      offerColours();
    } catch {
      toast("That file isn't a picture Venn can use. Try a PNG, JPEG or SVG.");
    }
  };
  $('#logo-remove').onclick = () => {
    logo = null;
    logoChanged = true;
    $('#logo-file').value = '';
    show();
    offerColours();
  };
  for (const c of $$('[data-copy]'))
    c.onclick = () =>
      navigator.clipboard.writeText(c.dataset.copy).then(
        () => toast('Copied.'),
        () => prompt('Copy this:', c.dataset.copy),
      );
  if ($('#b-leave')) $('#b-leave').onclick = () => leave(b);
  if (b) drawSharing(b, token);
  if ($('#b-delete'))
    $('#b-delete').onclick = () => {
      // Asked in the page, never with confirm() (in-app browsers block it).
      const row = $('#b-delete').parentElement;
      row.innerHTML = `<span>Delete it? Its polls go back to Venn’s look.</span> <button type="button" class="link-btn danger" id="b-really">Delete</button> <button type="button" class="link-btn" id="b-keep">Keep</button>`;
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

  // Where the server has sign-in, a new template is saved to an account: signed out, Save says so.
  let providers = [];
  const signedOut = () => !b && providers.length > 0 && !accountHint();
  getConfig().then((c) => {
    providers = c.accounts || [];
    if (signedOut()) $('#submit').textContent = 'Sign in to save';
    // Where the server has AI: a few words about the organization suggest a starting look.
    if (c.ai)
      import('./ai-draft.js')
        .then(
          (m) =>
            $('#ai-look') &&
            m.aiLook($('#ai-look'), {
              name: () => $('#b-name').value.trim(),
              apply: (look, title) => {
                applyLook(look);
                if (title && !$('#b-title').value.trim()) $('#b-title').value = title;
              },
            }),
        )
        .catch(() => {});
  });
  /** Signing in to save: the draft waits in this tab, and the page comes back to it. */
  const askToSignIn = () => {
    keepDraft({ fields: fields(), logo: logoChanged ? logo : null, step: ids[at] });
    const [html, wire] = signInPanel(providers, 'Sign in to save your template');
    $('#save-signin').innerHTML = `${html}
      <p><button type="button" class="link-btn" id="signin-back">Back to your template</button></p>`;
    $('#save-signin').hidden = false;
    wire();
    $('#signin-back').onclick = () => {
      $('#save-signin').hidden = true;
      $('#submit').focus();
    };
    $('#save-signin').scrollIntoView({ block: 'nearest' });
    $('#save-signin .btn-signin')?.focus({ preventScroll: true });
  };

  $('#brand-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = fields();
    $('#err').textContent = '';
    if (!body.name) {
      go(ids.indexOf('name'));
      $('#err').textContent = 'Add your organization’s name';
      return $('#b-name').focus();
    }
    if (signedOut()) return askToSignIn();
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
      dropDraft();
      history.replaceState(null, '', `/brand/${id}`);
      showReady(id, admin, body.name);
    } catch (ex) {
      $('#submit').disabled = false;
      // Signed out on the server (the session ended): sign in, and it's saved on the way back.
      if (ex.status === 401 && !b && providers.length) {
        accountHint(null);
        refreshAccountMenu();
        return askToSignIn();
      }
      $('#err').textContent = ex.message;
    }
  };
  // Duplicating one of Venn's built-in looks (My polls' Templates): the new template starts as it.
  const from = !init && new URLSearchParams(location.search).get('look');
  if (from && Object.hasOwn(LOOKS, from)) applyLook(LOOKS[from][1]);
  if (!b && !PHONE.matches) $('#b-name').focus();
  return fitPhone($('#brand-form'));
}

/**
 * On a phone the editor is the screen under the top bar, and nothing else scrolls: the preview on
 * top, the step under it (scrolling, if it's long) and Back / Next at the bottom. Returns a cleanup.
 */
const PHONE = matchMedia('(max-width: 959px)');
let unfit = null;
function fitPhone(form) {
  unfit?.();
  const root = document.documentElement;
  const fit = () => {
    const on = PHONE.matches && document.contains(form);
    root.classList.toggle('brand-app', on);
    if (!on) return form.style.removeProperty('height');
    scrollTo(0, 0);
    form.style.height = `${Math.max(420, innerHeight - form.getBoundingClientRect().top)}px`;
  };
  fit();
  addEventListener('resize', fit);
  PHONE.addEventListener?.('change', fit);
  unfit = () => {
    removeEventListener('resize', fit);
    PHONE.removeEventListener?.('change', fit);
    root.classList.remove('brand-app');
    form.style.removeProperty('height');
    unfit = null;
  };
  return () => unfit?.();
}

/** Three colours side by side, each a swatch with its name under it. */
const colourTrio = (rows, b, start) =>
  rows
    .map(
      ([k, l]) =>
        `<label class="trio" for="b-${k}"><input id="b-${k}" type="color" value="${esc(b?.[k] || start[k])}"><span>${l}</span></label>`,
    )
    .join('');

/** A logo's main colours (up to three, most used first), leaving out white, black and greys. */
export async function logoColours(src) {
  try {
    const img = await new Promise((ok, bad) =>
      Object.assign(new Image(), { crossOrigin: 'anonymous', onload: (e) => ok(e.target), onerror: bad, src }),
    );
    const c = Object.assign(document.createElement('canvas'), { width: 48, height: 48 });
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 48, 48);
    return mainColours(g.getImageData(0, 0, 48, 48).data);
  } catch {
    return [];
  }
}

/** Whether a template has answer colours of its own. */
const hasKey = (b) => !!(b?.yes || b?.maybe || b?.no);

/** A row of fonts to choose from, each shown in itself; the first is Venn's own. */
const fontPicker = (key, label, value = '') => `
  <div>
    <span class="sr-only" id="${key}-l">${label}</span>
    <div class="font-grid" role="radiogroup" aria-labelledby="${key}-l">
      <button type="button" role="radio" data-${key === 'font' ? 'font' : 'body-font'}="" aria-checked="${!value}">Venn</button>
      ${Object.entries(FONTS)
        // Retro's Orbitron is a headings font: too heavy to read as text.
        .filter(([k]) => key === 'font' || k !== 'retro')
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
    ${
      views
        ? `<p class="pv-top">
      <span class="seg" role="radiogroup" aria-label="Preview as"><button type="button" role="radio" data-view="guest" aria-checked="true">Guest</button><button type="button" role="radio" data-view="organizer" aria-checked="false">Organizer</button></span>
      <button type="button" class="btn pv-compare" id="pv-compare" title="Hold to see Venn’s own look">Compare</button>
    </p>`
        : ''
    }
    <iframe id="pv-frame" src="/brand/preview" title="Preview of a poll from this template"></iframe>
  </div>`;

function livePreview(get) {
  const frame = $('#pv-frame');
  // The frame is this site's own page, so the two talk directly (no messages to lose on the way):
  // the frame asks for the template when it's ready (and again if it reloads), and each change is
  // handed to it, as JSON.
  const state = () => JSON.stringify(get());
  window.vennPreviewState = state;
  const call = (fn, arg) => {
    try {
      frame.contentWindow?.vennPreview?.[fn](arg);
    } catch {}
  };
  let timer;
  const send = () => {
    clearTimeout(timer);
    timer = setTimeout(() => call('show', state()), 120);
  };
  // Held: the poll in Venn's own look, to see what the template changes.
  const compare = $('#pv-compare');
  if (compare) {
    let held = false;
    const hold = (on) => {
      if (on === held) return;
      held = on;
      compare.classList.toggle('held', on);
      call('compare', on);
    };
    compare.addEventListener('pointerdown', (e) => {
      hold(true);
      try {
        compare.setPointerCapture(e.pointerId); // let go anywhere, it lets go
      } catch {}
    });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) compare.addEventListener(t, () => hold(false));
    compare.addEventListener('keydown', (e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), hold(true)));
    compare.addEventListener('keyup', () => hold(false));
    compare.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  return send;
}

/**
 * The template's links: one for the team to make polls with and, for its owner, the private manage
 * link, sharing it with other accounts and deleting it. An admin it's shared with can leave it.
 */
const links = (b, token, others) => {
  const { id } = b;
  const owner = b.role !== 'admin';
  return `
  <div class="brand-links">
    <p class="hint">Anyone with this link makes polls in your look.</p>
    <p class="link-row"><input type="text" readonly value="${esc(shareUrl(id))}" aria-label="Link for your team"><button type="button" class="btn btn-primary" data-copy="${esc(shareUrl(id))}">Copy link</button></p>
    ${
      owner
        ? `<p class="hint">Your manage link changes this template. Keep it private, as nobody can send it to you again.</p>
    <p class="link-row"><input type="text" readonly value="${esc(manageUrl(id, token))}" aria-label="Your manage link"><button type="button" class="btn" data-copy="${esc(manageUrl(id, token))}">Copy</button></p>`
        : '<p class="hint">Shared with you to edit: you can change it. Its owner shares it.</p>'
    }
    <p><a class="btn" href="/new?brand=${esc(id)}" data-link>Make a poll with it</a></p>
    ${owner && (token || b.role === 'owner') ? '<div class="brand-sharing" id="b-sharing"></div>' : ''}
    ${
      others.length
        ? `<h3 id="mine-h">Your other templates</h3><ul class="brand-list" aria-labelledby="mine-h">${others
            .map((x) => `<li><a href="/brand/${esc(x.id)}" data-link>${esc(x.name)}</a></li>`)
            .join('')}</ul>`
        : ''
    }
    <p class="delete-row">${
      owner
        ? '<button type="button" class="link-btn danger" id="b-delete">Delete template</button>'
        : '<button type="button" class="link-btn danger" id="b-leave">Leave template</button>'
    }</p>
  </div>`;
};

/** Just saved: the links, first. */
function showReady(id, token, name) {
  renderBrand(id).then(() => {
    toast(`${name}’s template is ready.`);
    $('#brand-form')?.scrollIntoView({ block: 'start' });
  });
}
