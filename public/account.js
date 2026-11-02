// My polls (/me): sign in, if you like, and every poll you made or answered and every brand
// template you keep is here on any device, to search, sort and group. Venn works the same without
// it. Signing in is the server's (src/auth.js); this page lists what the account keeps and adds the
// links this browser remembers.

import { $, api, app, copy, esc, getConfig, plural, toast } from './ui.js';
import { accountHint, refreshAccountMenu } from './account-menu.js';
import { stickerStack, rotate } from './stickers.js';
import {
  GROUPS,
  KINDS,
  SORTS,
  SORT_HINTS,
  answeredMeta,
  arrange,
  canMake,
  isVote,
  madeMeta,
  mixedKinds,
  nudgeText,
  whenShort,
  addedText,
  parseVennLink,
  signInAgree,
  signInButtons,
} from './account-data.js';
import { emailSignInForm, wireEmailSignIn } from './email-signin.js';

await new Promise((done) =>
  document.head.append(
    Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/account.css', onload: done, onerror: done }),
  ),
);

const initial = (u) => (u.name || u.email || '?').trim().charAt(0).toUpperCase();

// Which list is showing, and how it's sorted and grouped, remembered in this browser.
const VIEW_KEY = 'venn:me-view';
const TABS = { made: 'Created', answered: 'Answered', brands: 'Templates' };
function loadView() {
  let v = {};
  try {
    v = JSON.parse(localStorage.getItem(VIEW_KEY)) || {};
  } catch {}
  return {
    tab: Object.hasOwn(TABS, v.tab) ? v.tab : 'made',
    sort: Object.hasOwn(SORTS, v.sort) ? v.sort : 'new',
    group: Object.hasOwn(GROUPS, v.group) ? v.group : 'status',
    kind: Object.hasOwn(KINDS, v.kind) ? v.kind : 'all',
    q: '',
  };
}
const saveView = ({ tab, sort, group, kind }) => {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ tab, sort, group, kind }));
  } catch {}
};

export async function renderAccount() {
  // Account settings, and the pages the sign-in emails open (account-settings.js).
  const sub = location.pathname.match(/^\/me\/(settings|confirm|reset|email)\/?$/)?.[1];
  if (sub) return (await import('./account-settings.js')).renderSub(sub);
  document.title = 'My polls · Venn';
  const failed = location.hash === '#signin-failed';
  const justSignedIn = location.hash === '#signed-in'; // back from Google (src/auth.js)
  const forgot = location.hash === '#forgot';
  const signup = location.hash === '#signup';
  const mode = forgot ? 'forgot' : signup ? 'signup' : 'signin';
  if (location.hash) history.replaceState(null, '', location.pathname);
  // Not signed in here: the sign-in page straight away, with the ways in this server offered last
  // time, so nothing jumps when the server answers (it's redrawn only if they changed). Signed in:
  // My polls' outline until the polls come.
  const signedIn = justSignedIn || accountHint();
  const early = signedIn ? null : seenProviders();
  if (early) showSignIn(early, failed, mode);
  else if (!signedIn) showSignIn(null, failed, mode);
  else
    app.innerHTML = `<div class="account" aria-busy="true"><h1>My polls</h1><div class="acct-skeleton" aria-hidden="true">${'<span></span>'.repeat(4)}</div></div>`;
  let me;
  try {
    me = await api('me');
  } catch (e) {
    app.innerHTML = `<div class="account"><h1>My polls</h1><div class="sheet acct-empty"><p>${esc(e.message)}</p><button type="button" class="btn" id="acct-retry">Try again</button></div></div>`;
    $('#acct-retry').onclick = renderAccount;
    return;
  }
  if (!me.user) {
    accountHint(null);
    refreshAccountMenu();
    const providers = me.providers || [];
    seenProviders(providers);
    if (String(early) !== String(providers)) showSignIn(providers, failed, mode);
    return;
  }
  accountHint({ initial: initial(me.user), name: me.user.name || me.user.email || '' });
  refreshAccountMenu();
  const view = loadView();
  showMine(me, view);
  // The links this browser remembers join the account (keep.js; all of them again here, in case
  // one was missed). Whatever joins, from here or the top bar's check, shows in the list.
  if (!keptListener) {
    keptListener = () => location.pathname === '/me' && $('.acct-tabs') && redrawMine?.();
    addEventListener('venn:kept', keptListener);
  }
  (await import('./keep.js')).keepThisBrowser({ all: true });
}

let keptListener = null;
let redrawMine = null; // shows My polls again, as it is now on the server

// ---------- signed out ----------

const HEADINGS = { signin: 'Sign in to Venn', signup: 'Create your account', forgot: 'Sign in to Venn' };

const PROVIDERS = 'venn:providers';
/** The ways in this server offered last time (or remember them). */
function seenProviders(list) {
  try {
    if (list) return localStorage.setItem(PROVIDERS, JSON.stringify(list));
    const seen = JSON.parse(localStorage.getItem(PROVIDERS));
    return Array.isArray(seen) && seen.every((p) => typeof p === 'string') ? seen : null;
  } catch {
    return null;
  }
}

/** The sign-in page. `providers` null: not known yet, so the page's shape with the buttons to come. */
function showSignIn(providers, failed, mode) {
  if (!providers) {
    app.innerHTML = `
      <div class="account acct-signin-page" aria-busy="true">
        <div class="acct-hero">
          <span class="acct-hero-art" aria-hidden="true">${stickerStack(120)}</span>
          <h1 id="acct-h">${HEADINGS[mode]}</h1>
          <p class="lede">Every poll you make or answer, and your templates, on any device.</p>
        </div>
        <div class="acct-skeleton acct-skeleton-signin" aria-hidden="true">${'<span></span>'.repeat(3)}</div>
      </div>`;
    rotate(app.querySelector('[data-stickers]'));
    return;
  }
  const buttons = providers.filter((p) => p !== 'email');
  const email = providers.includes('email');
  app.innerHTML = `
    <div class="account acct-signin-page">
      <div class="acct-hero">
        <span class="acct-hero-art" aria-hidden="true">${stickerStack(120)}</span>
        <h1 id="acct-h">${HEADINGS[email ? mode : 'signin']}</h1>
        <p class="lede">${
          providers.length
            ? 'Every poll you make or answer, and your templates, on any device.'
            : 'Signing in isn’t set up on this server. Your polls work with their own links.'
        }</p>
      </div>
      ${
        providers.length
          ? `${
              email
                ? `<div class="seg acct-mode" role="group" aria-label="Sign in or create an account">
                     <button type="button" data-acct-mode="signin">Sign in</button>
                     <button type="button" data-acct-mode="signup">Create account</button>
                   </div>`
                : ''
            }
             ${failed ? '<p class="acct-alert" role="alert">Sign-in didn’t finish. Try again.</p>' : ''}
             ${buttons.length ? `<div class="signin">${signInButtons(buttons, '/me')}</div>` : ''}
             ${email ? emailSignInForm({ alone: !buttons.length }) : ''}
             <p class="hint">No account needed to make or answer a poll.</p>
             ${signInAgree()}`
          : '<a class="btn btn-primary" href="/new" data-link>Create a Venn</a>'
      }
    </div>`;
  rotate(app.querySelector('[data-stickers]'));
  // Email and password (email-signin.js). /me#forgot opens on "Forgot password?", /me#signup on
  // Create account. The switch and the heading follow the form, whichever way it changes.
  if (email) {
    const tabs = app.querySelectorAll('[data-acct-mode]');
    const form = wireEmailSignIn({
      mode,
      switcher: true,
      onSignedIn: renderAccount,
      onMode: (m) => {
        $('#acct-h').textContent = HEADINGS[m];
        for (const t of tabs)
          t.setAttribute('aria-pressed', String(t.dataset.acctMode === (m === 'signup' ? 'signup' : 'signin')));
      },
    });
    for (const t of tabs) t.onclick = () => t.getAttribute('aria-pressed') !== 'true' && form.show(t.dataset.acctMode);
  }
  // A tap shows it's on its way (the provider's page can take a moment), and can't be tapped twice.
  for (const a of app.querySelectorAll('.btn-signin'))
    a.addEventListener('click', (e) => {
      if (app.querySelector('.btn-signin.is-busy')) return e.preventDefault();
      a.classList.add('is-busy');
      a.setAttribute('aria-disabled', 'true');
      a.lastChild.textContent = `Opening ${a.lastChild.textContent.replace('Continue with ', '')}…`;
    });
}
// Back from the provider's page without signing in (the page comes back from the cache): ready again.
addEventListener('pageshow', (e) => {
  if (e.persisted && location.pathname === '/me' && app.querySelector('.btn-signin.is-busy')) renderAccount();
});

// ---------- signed in ----------

const MORE =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

// A poll's mark: its occasion's emoji, or a calendar for a date poll and a ballot box for a vote.
const icon = (p) => esc(p.emoji || (isVote(p) ? '🗳️' : '📅'));

// A poll's row: a tap opens it (as its organizer, for the ones they made); ⋯ manages it.
const pollRow = (p) => `
  <li class="acct-item"><a class="acct-row" href="/e/${esc(p.id)}#organizer" data-link>
    <span class="acct-icon" aria-hidden="true">${icon(p)}</span>
    <span class="acct-text"><b>${esc(p.title)}</b><span class="muted">${esc(madeMeta(p))}</span></span>
    <span class="acct-when muted">${esc(whenShort(p.createdAt))}</span>
  </a><button type="button" class="acct-more" data-more="${esc(p.id)}" aria-label="Manage ${esc(p.title)}" aria-haspopup="dialog">${MORE}</button></li>`;

const answeredRow = (p) => {
  const can = canMake(p);
  return `
  <li class="acct-item"><a class="acct-row" href="/e/${esc(p.id)}" data-link>
    <span class="acct-icon" aria-hidden="true">${icon(p)}</span>
    <span class="acct-text"><b>${esc(p.title)}</b><span class="muted">${esc(answeredMeta(p))}</span></span>
    ${can ? `<span class="acct-can ${can[0]}">${can[1]}</span>` : `<span class="acct-when muted">${esc(whenShort(p.answeredAt))}</span>`}
  </a><button type="button" class="acct-more" data-more="${esc(p.id)}" aria-label="Manage ${esc(p.title)}" aria-haspopup="dialog">${MORE}</button></li>`;
};

// What each template row says: the account's own, or shared with it (to change, or to use).
const ROLE_META = { owner: 'Edit and share', admin: 'Shared with you · Can edit', user: 'Shared with you · Can use' };
const brandRow = (b) => `
  <li class="acct-brand">
    <a class="acct-row" href="/brand/${esc(b.id)}#organizer" data-link>
      ${b.logoV != null ? `<img class="acct-icon acct-logo" src="/api/brands/${esc(b.id)}/logo?v=${esc(b.logoV)}" alt="">` : '<span class="acct-icon" aria-hidden="true">🏷️</span>'}
      <span class="acct-text"><b>${esc(b.name)}</b><span class="muted">${ROLE_META[b.role] || ROLE_META.owner}</span></span>
    </a>
    <a class="btn acct-use" href="/new?brand=${esc(b.id)}" data-link aria-label="New poll with ${esc(b.name)}">New poll</a>
  </li>`;

// Venn's own two looks, always at the top of Templates: starting points to duplicate into a
// template of your own, then change it and make polls with it (brand.js LOOKS).
const BUILT_IN = [
  ['retro', 'Retro', 'Venn’s look, to make yours'],
  ['classic', 'Classic', 'Venn’s plain look, to make yours'],
];
const builtInRow = ([k, name, meta]) => `
  <li class="acct-brand">
    <a class="acct-row" href="/brand/new?look=${k}" data-link>
      <span class="acct-icon acct-look acct-look-${k}" aria-hidden="true">Aa</span>
      <span class="acct-text"><b>${name}</b><span class="muted">${meta}</span></span>
    </a>
    <a class="btn acct-use" href="/brand/new?look=${k}" data-link aria-label="Duplicate ${name}">Duplicate</a>
  </li>`;
/** The built-in looks that match the search, under their own heading; the account's follow. */
const builtIns = (q) => {
  const shown = BUILT_IN.filter(([, name]) => name.toLowerCase().includes(q.trim().toLowerCase()));
  return shown.length
    ? `<h2 class="acct-h">Built in</h2><ul class="acct-list" aria-label="Built in">${shown.map(builtInRow).join('')}</ul>`
    : '';
};

const EMPTY = {
  made: ['No polls yet.', '<a class="btn btn-primary" href="/new" data-link>Create a Venn</a>'],
  answered: ['Polls you answer while signed in show up here.', ''],
  brands: ['Your logo and colours on every poll.', '<a class="btn btn-primary" href="/brand/new" data-link>Make a template</a>'],
};

// A long list shows a few at a time: this many per group, then "Show more"; Past starts folded.
const FIRST = 5;

const CHECK =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SLIDERS =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

/**
 * A sheet over the page: from the bottom on phones, a card in the middle on wide screens. A tap
 * outside, Escape, or anything marked data-close closes it, and focus goes back where it was.
 */
function openSheet(html, wire) {
  const sheet = $('#acct-sheet');
  sheet.innerHTML = `<div class="acct-sheet-body"><span class="acct-grip" aria-hidden="true"></span>${html}</div>`;
  sheet.onclick = (e) => {
    if (e.target === sheet || e.target.closest('[data-close]')) sheet.close();
  };
  wire?.(sheet);
  sheet.showModal();
  return sheet;
}

// "Missing a poll?": things join the account on their own (keep.js), so this says how, for each
// list, with pasting a link as the last resort.
const MISSING = {
  made: {
    ask: 'Missing a poll?',
    lines: [
      'Polls you make while signed in are added here on their own, and so are the ones made in this browser before you signed in.',
      'Made it on another phone or computer? Sign in to Venn there. Or open its private organizer link on this one: it’s added as it opens.',
    ],
    field: 'Its private organizer link',
  },
  answered: {
    ask: 'Missing a poll?',
    lines: [
      'Polls you answer while signed in are added here on their own, and so are the ones answered in this browser before you signed in.',
      'Answered on another phone or computer? Sign in to Venn there. Or open the link to change your answer (it’s in Venn’s email to you) on this one.',
    ],
    field: 'The link to change your answer',
  },
  brands: {
    ask: 'Missing a template?',
    lines: [
      'Templates you make are added here on their own.',
      'Someone shared one with you? Open the invite link they sent, and it’s added. Yours, from another phone or computer: sign in to Venn there, or open its private manage link on this one.',
    ],
    field: 'Its invite or manage link',
  },
};

/** The "Missing a poll?" sheet. `redraw(tab)` shows My polls again, on that tab. */
function missing(view, redraw) {
  const m = MISSING[view.tab];
  openSheet(
    `<h2 class="acct-sheet-h" tabindex="-1" autofocus>${m.ask}</h2>
     ${m.lines.map((l) => `<p class="acct-sheet-p">${l}</p>`).join('')}
     <form class="acct-paste" id="acct-paste">
       <label for="acct-link">Or paste the link here</label>
       <div class="acct-add-row">
         <input id="acct-link" type="url" inputmode="url" autocomplete="off" enterkeyhint="go" placeholder="${m.field}">
         <button type="submit" class="btn">Add</button>
       </div>
       <p class="hint" id="acct-paste-msg" role="status"></p>
     </form>
     <button type="button" class="btn acct-done" data-close>Close</button>`,
    (sheet) => {
      const say = (t) => ($('#acct-paste-msg', sheet).textContent = t);
      $('#acct-paste', sheet).onsubmit = async (e) => {
        e.preventDefault();
        const link = parseVennLink($('#acct-link', sheet).value);
        if (!link) return say('That isn’t a Venn link. Copy the whole link, with the part after #.');
        // An invite: joining it puts the template in this account's templates (as opening it does).
        if (link.kind === 'invite')
          try {
            const { role } = await api(`brands/${link.item.id}/join`, { method: 'POST', body: { token: link.item.token } });
            sheet.close();
            await redraw('brands');
            return toast(role === 'owner' ? 'It’s your own template.' : 'Added to your templates');
          } catch (ex) {
            return say(ex.message);
          }
        if (link.kind === 'guest')
          return say(
            link.brand
              ? 'That’s the template’s link for making polls, not a manage or invite link.'
              : 'That’s the poll’s link for guests. Its private organizer link ends in #admin=…',
          );
        try {
          const { added } = await api('me/claim', { method: 'POST', body: { [link.kind]: [link.item] } });
          if (!(added.polls + added.brands + (added.answers || 0)))
            return say('That link doesn’t work any more, or it’s in someone else’s account.');
          sheet.close();
          await redraw({ polls: 'made', answers: 'answered', brands: 'brands' }[link.kind]);
          toast(addedText(added));
        } catch (ex) {
          say(ex.message);
        }
      };
    },
  );
}

function showMine(me, view) {
  const { user } = me;
  const lists = { made: me.polls || [], answered: me.answered || [], brands: me.brands || [] };
  app.innerHTML = `
    <div class="account">
      <h1>My polls</h1>
      <div class="tabs acct-tabs" role="tablist" aria-label="My polls">
        ${Object.entries(TABS)
          .map(
            ([k, label]) =>
              `<button type="button" role="tab" id="acct-tab-${k}" aria-controls="acct-panel" data-tab="${k}">${label}${lists[k].length ? ` <span class="acct-n">${lists[k].length}</span>` : ''}</button>`,
          )
          .join('')}
      </div>
      <div id="acct-panel" role="tabpanel">
        <div class="acct-tools">
          <label class="acct-search">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <input id="acct-q" type="search" enterkeyhint="search" autocomplete="off" aria-label="Search">
          </label>
          <button type="button" class="acct-sortbtn" id="acct-sortbtn" aria-haspopup="dialog">${SLIDERS}<span id="acct-sortlabel"></span></button>
        </div>
        <div id="acct-results" aria-live="polite"></div>
      </div>
      <section class="sheet acct-account" aria-label="Account">
        <div class="acct-who">
          <span class="acct-avatar" aria-hidden="true">${esc(initial(user))}</span>
          <span class="acct-text"><b>${esc(user.name || user.email || 'Signed in')}</b><span class="muted">${esc(user.name && user.email ? user.email : `Signed in with ${user.providerLabel}`)}</span></span>
        </div>
        <div class="acct-actions">
          <a class="btn" href="/me/settings" data-link>Account settings</a>
          <button type="button" class="btn" id="acct-out">Sign out</button>
        </div>
      </section>
      <dialog class="acct-sheet" id="acct-sheet" aria-label="Options"></dialog>
    </div>`;

  const draw = () => {
    saveView(view);
    for (const b of app.querySelectorAll('[role="tab"]')) {
      const on = b.dataset.tab === view.tab;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
    }
    $('#acct-panel').setAttribute('aria-labelledby', `acct-tab-${view.tab}`);
    const items = lists[view.tab];
    const brands = view.tab === 'brands';
    // Searching, sorting and grouping are for lists long enough to need them.
    $('.acct-tools').hidden = items.length < 2;
    $('#acct-q').placeholder = brands ? 'Search templates' : 'Search polls';
    // Templates have no date to sort by.
    const sort = brands && view.sort === 'date' ? 'new' : view.sort;
    // Dates or votes only, when this list has both.
    const kind = mixedKinds(items) ? view.kind : 'all';
    // Filtered, the button says so (the sort is in its name): "Votes", not a truncated "Votes · Ne…".
    $('#acct-sortlabel').textContent = kind === 'all' ? SORTS[sort] : KINDS[kind];
    $('#acct-sortbtn').setAttribute(
      'aria-label',
      `${kind === 'all' ? '' : `Showing ${KINDS[kind].toLowerCase()}. `}Sort: ${SORTS[sort]}${brands ? '' : `, grouped by ${GROUPS[view.group].toLowerCase()}`}. Change`,
    );
    const groups = arrange(items, { q: view.q, sort, kind, group: brands ? 'none' : view.group });
    const searching = !!view.q.trim();
    const row = { made: pollRow, answered: answeredRow, brands: brandRow }[view.tab];
    const out = $('#acct-results');
    const top = brands ? builtIns(view.q) : '';
    if (!items.length) {
      const [line, action] = EMPTY[view.tab];
      out.innerHTML = `${brands ? `${top}<h2 class="acct-h">Yours</h2>` : ''}<div class="sheet acct-empty"><p>${line}</p>${action}</div>`;
    } else if (!groups.length && !top && !view.q.trim()) {
      out.innerHTML = `<div class="acct-empty acct-none"><p>No ${KINDS[kind].toLowerCase()} here.</p><button type="button" class="link-btn" id="acct-clear">Show all</button></div>`;
      $('#acct-clear').onclick = () => {
        view.kind = 'all';
        draw();
      };
    } else if (!groups.length && !top) {
      out.innerHTML = `<div class="acct-empty acct-none"><p>Nothing matches “${esc(view.q.trim())}”.</p><button type="button" class="link-btn" id="acct-clear">Clear search</button></div>`;
      $('#acct-clear').onclick = () => {
        $('#acct-q').value = view.q = '';
        draw();
        $('#acct-q').focus();
      };
    } else {
      // A few at a time: searching shows every match; Past starts folded when there's more above it.
      const key = (g) => `${view.tab}:${view.group}:${g.key}`;
      out.innerHTML =
        top +
        (top && groups.length ? '<h2 class="acct-h">Yours</h2>' : '') +
        groups
          .map((g) => {
            const folded = !searching && g.key === 'past' && groups.length > 1 && !open.has(key(g));
            const shown = searching || open.has(key(g)) || brands ? g.items : g.items.slice(0, FIRST);
            const head = !g.label
              ? ''
              : g.key === 'past' && groups.length > 1 && !searching
                ? `<h2 class="acct-h"><button type="button" class="acct-fold" data-open="${esc(key(g))}" aria-expanded="${!folded}">${esc(g.label)} <span class="muted">${g.items.length}</span><span class="acct-fold-mark" aria-hidden="true">›</span></button></h2>`
                : `<h2 class="acct-h">${esc(g.label)} <span class="muted">${g.items.length}</span></h2>`;
            if (folded) return head;
            const rest = g.items.length - shown.length;
            return `${head}<ul class="acct-list" aria-label="${esc(g.label || TABS[view.tab])}">${shown.map(row).join('')}</ul>${
              rest ? `<button type="button" class="acct-showmore" data-open="${esc(key(g))}">Show ${rest} more</button>` : ''
            }`;
          })
          .join('') +
        (brands ? '<a class="acct-new" href="/brand/new" data-link>+ New template</a>' : '');
      for (const b of out.querySelectorAll('[data-open]'))
        b.onclick = () => {
          const k = b.dataset.open;
          const more = b.classList.contains('acct-showmore');
          const label = more && b.previousElementSibling.getAttribute('aria-label');
          const n = more && b.previousElementSibling.children.length;
          if (!more && open.has(k)) open.delete(k);
          else open.add(k);
          draw();
          // After "Show more", focus goes to the first new row, so the list carries on from there.
          if (more)
            [...out.querySelectorAll('.acct-list')]
              .find((ul) => ul.getAttribute('aria-label') === label)
              ?.children[n]?.querySelector('a')
              ?.focus();
          else out.querySelector(`[data-open="${CSS.escape(k)}"]`)?.focus();
        };
      for (const b of out.querySelectorAll('[data-more]'))
        b.onclick = () =>
          manage(
            lists[view.tab].find((p) => p.id === b.dataset.more),
            view.tab,
          );
    }
    // Nothing to paste, mostly: what's missing, and how it gets here on its own.
    if (!view.q.trim()) {
      out.insertAdjacentHTML(
        'beforeend',
        `<p class="acct-missing"><button type="button" class="link-btn" id="acct-missing">${MISSING[view.tab].ask}</button></p>`,
      );
      $('#acct-missing').onclick = () => missing(view, (tab) => showMineAgain(tab));
    }
  };
  const showMineAgain = async (tab) => showMine(await api('me'), { ...view, tab });
  redrawMine = () => showMineAgain(view.tab).catch(() => {});
  const open = new Set(); // groups opened in full (or Past unfolded), by tab, grouping and group

  // Sort and group: one button, one sheet with big targets, applied as they're tapped.
  $('#acct-sortbtn').onclick = () => {
    const brands = view.tab === 'brands';
    const sorts = Object.keys(SORTS).filter((k) => !(brands && k === 'date'));
    const kinds = !brands && mixedKinds(lists[view.tab]);
    const paint = (sheet) => {
      for (const b of sheet.querySelectorAll('[data-kind]')) b.setAttribute('aria-checked', b.dataset.kind === view.kind);
      for (const b of sheet.querySelectorAll('[data-sort]')) b.setAttribute('aria-checked', b.dataset.sort === view.sort);
      for (const b of sheet.querySelectorAll('[data-group]')) b.setAttribute('aria-checked', b.dataset.group === view.group);
    };
    openSheet(
      `<h2 class="acct-sheet-h">${kinds ? 'Show and sort' : `Sort${brands ? '' : ' and group'}`}</h2>
       ${
         kinds
           ? `<div class="seg acct-seg acct-kinds" role="radiogroup" aria-label="Show">
                ${Object.entries(KINDS)
                  .map(([k, label]) => `<button type="button" role="radio" data-kind="${k}">${label}</button>`)
                  .join('')}
              </div>`
           : ''
       }
       <div class="acct-opts" role="radiogroup" aria-label="Sort">
         ${sorts.map((k) => `<button type="button" role="radio" data-sort="${k}"><span><b>${SORTS[k]}</b><span class="muted">${SORT_HINTS[k]}</span></span>${CHECK}</button>`).join('')}
       </div>
       ${
         brands
           ? ''
           : `<h3 class="acct-sheet-sub">Group by</h3>
              <div class="seg acct-seg" role="radiogroup" aria-label="Group by">
                ${Object.entries(GROUPS)
                  .map(([k, label]) => `<button type="button" role="radio" data-group="${k}">${label}</button>`)
                  .join('')}
              </div>`
       }
       <button type="button" class="btn btn-primary acct-done" data-close>Done</button>`,
      (sheet) => {
        paint(sheet);
        sheet.querySelector('[aria-checked="true"]')?.focus();
        for (const b of sheet.querySelectorAll('[data-sort],[data-group],[data-kind]'))
          b.addEventListener('click', () => {
            if (b.dataset.sort) view.sort = b.dataset.sort;
            else if (b.dataset.kind) view.kind = b.dataset.kind;
            else view.group = b.dataset.group;
            paint(sheet);
            draw();
          });
      },
    );
  };

  // ⋯ on a poll: open it, share it, email it to people, remind them, take it off the list, or delete it.
  function manage(p, tab) {
    if (!p) return;
    const made = tab === 'made';
    const url = `${location.origin}/e/${p.id}`;
    const waiting = p.finalStart == null && !p.decided && !(p.deadline != null && p.deadline <= Date.now());
    const emailable = made && waiting && p.invitees && config.email;
    openSheet(
      `<div class="acct-sheet-head">
         <span class="acct-icon" aria-hidden="true">${icon(p)}</span>
         <span class="acct-text"><b>${esc(p.title)}</b><span class="muted">${esc(made ? madeMeta(p) : answeredMeta(p))}</span></span>
       </div>
       <div class="acct-acts" id="acct-acts">
         <a href="/e/${esc(p.id)}${made ? '#organizer' : ''}" data-link data-close>Open</a>
         <button type="button" data-act="copy">Copy link</button>
         ${made && waiting ? '<button type="button" data-act="nudge">Remind the group</button>' : ''}
         ${emailable ? `<button type="button" data-act="email">Email invitees who haven’t answered</button>` : ''}
         ${made && waiting && config.email ? `<a href="/e/${esc(p.id)}#organizer&amp;invite" data-link data-close>${p.invitees ? 'Invite more by email' : 'Email it to people'}</a>` : ''}
         ${made && p.finalStart == null && !p.decided ? `<a href="/e/${esc(p.id)}#organizer&amp;deadline" data-link data-close>${p.deadline != null ? 'Change the deadline' : 'Add a deadline'}</a>` : ''}
         <button type="button" data-act="unlist">Remove from My polls</button>
         ${made ? '<button type="button" data-act="delete" class="acct-danger">Delete poll</button>' : ''}
       </div>
       <div class="acct-sure" id="acct-sure" hidden>
         <p><b>Delete “${esc(p.title)}”?</b> It’s gone for everyone, with its answers.</p>
         <div class="acct-sure-row"><button type="button" class="btn btn-danger" data-act="delete-yes">Delete poll</button><button type="button" class="btn" data-act="delete-no">Keep it</button></div>
       </div>
       <button type="button" class="btn acct-done" data-close>Close</button>`,
      (sheet) => {
        const gone = (msg) => {
          lists[tab] = lists[tab].filter((x) => x.id !== p.id);
          sheet.close();
          redrawCounts();
          draw();
          toast(msg);
        };
        const acts = {
          copy: () => copy(url).then(() => sheet.close()),
          nudge: async () => {
            const text = nudgeText(p, url);
            try {
              if (navigator.share) await navigator.share({ text });
              else await copy(text, 'Reminder copied, ready to paste');
              sheet.close();
            } catch {}
          },
          email: async () => {
            try {
              const { sent } = await api(`events/${p.id}/remind`, { method: 'POST', headers: { 'x-organizer': '1' } });
              sheet.close();
              toast(`Reminder sent to ${plural(sent, 'person', 'people')}`);
            } catch (ex) {
              toast(ex.message);
            }
          },
          unlist: async () => {
            try {
              await api(`me/${made ? 'polls' : 'answers'}/${made ? p.id : p.answerId || p.id}`, { method: 'DELETE' });
              gone('Removed from My polls');
            } catch (ex) {
              toast(ex.message);
            }
          },
          delete: () => {
            $('#acct-acts', sheet).hidden = true;
            $('#acct-sure', sheet).hidden = false;
            sheet.querySelector('[data-act="delete-no"]').focus();
          },
          'delete-no': () => {
            $('#acct-sure', sheet).hidden = true;
            $('#acct-acts', sheet).hidden = false;
            sheet.querySelector('[data-act="delete"]').focus();
          },
          'delete-yes': async () => {
            try {
              await api(`events/${p.id}`, { method: 'DELETE' });
              gone('Poll deleted');
            } catch (ex) {
              toast(ex.message);
            }
          },
        };
        for (const b of sheet.querySelectorAll('[data-act]')) b.onclick = () => acts[b.dataset.act]();
      },
    );
  }
  const redrawCounts = () => {
    for (const b of app.querySelectorAll('[role="tab"]')) {
      const n = lists[b.dataset.tab].length;
      b.innerHTML = `${TABS[b.dataset.tab]}${n ? ` <span class="acct-n">${n}</span>` : ''}`;
    }
  };
  let config = {};
  getConfig().then((c) => (config = c || {}));

  const tabs = [...app.querySelectorAll('[role="tab"]')];
  for (const b of tabs) {
    b.onclick = () => {
      view.tab = b.dataset.tab;
      draw();
    };
    // Arrow keys move between the tabs, as tabs do.
    b.onkeydown = (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      const next = tabs[(tabs.indexOf(b) + d + tabs.length) % tabs.length];
      next.focus();
      next.click();
    };
  }
  $('#acct-q').oninput = (e) => {
    view.q = e.target.value;
    draw();
  };
  $('#acct-q').value = view.q;
  draw();

  $('#acct-out').onclick = () => signOut().then(renderAccount);
}

/** Sign out here: the session ends on the server, and the menu forgets the name. */
export async function signOut() {
  try {
    await api('auth/logout', { method: 'POST' });
  } catch {}
  accountHint(null);
  refreshAccountMenu();
  toast('Signed out');
}
