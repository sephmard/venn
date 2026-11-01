// The live preview on /brand: the real poll page, with a sample poll in the template's look, shown in
// a frame beside the form (brand.js). The form sends the template as it changes, and which view to
// show (a guest's or the organizer's); the poll's requests are answered here, so answering, the tabs
// and picking a date all work, and nothing is saved or counted. The form also says which part of the
// poll the step being edited changes (`focus`): the preview goes there and rings it, and rings it
// again with every change, so it's plain what each setting does.

import { brandLook } from './brand-look.js';
import { zonedToUtc } from './core.js';
import { app, forget, save, toast, useStandIn } from './ui.js';

const ID = 'preview';
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** Four days from three days on, and four people's answers to them (2 yes, 1 if needed, none no). */
function sample() {
  const day = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dates = [3, 4, 5, 6].map(day);
  const slots = dates.map((d) => zonedToUtc(d, 0, tz));
  const answers = (...v) => Object.fromEntries(slots.map((s, i) => [s, v[i]]).filter(([, x]) => x));
  return {
    id: ID,
    organizer: 'Sam',
    timezone: tz,
    dates,
    startMinute: 0,
    endMinute: 1440,
    slotMinutes: 1440,
    durationMinutes: 1440,
    finalStart: null,
    createdAt: Date.now(),
    slots,
    hostId: 'sam',
    participants: [
      { id: 'sam', name: 'Sam', availability: answers(2, 2, 1, 0) },
      { id: 'ana', name: 'Ana', availability: answers(2, 1, 2, 0) },
      { id: 'ben', name: 'Ben', availability: answers(2, 0, 2, 1) },
      { id: 'chloe', name: 'Chloe', availability: answers(1, 2, 0, 2) },
    ].map((p) => ({ ...p, updatedAt: Date.now() })),
  };
}

/** What each step of the form changes on the poll page: rung in the preview while it's edited. */
const SPOTS = {
  logo: ['.brand-bar'],
  colours: ['.btn-primary', '.tabs [aria-selected="true"]', '#ev-details a'],
  answers: ['.ov-list', '.best-hero'],
  headings: ['#ev-title', '.panel-title'],
  text: ['#ev-meta', '.row-main', '.ov-summary'],
  shape: ['.row', '.btn-primary'],
  poll: ['#ev-title', '#ev-details'],
};
// The ring: the same in every look, on light and dark pages alike.
const RING =
  '.pv-spot{outline:2.5px dashed #d61f8c!important;outline-offset:3px;box-shadow:0 0 0 7px rgba(214,31,140,.14)!important;animation:pv-ring .7s ease-out}' +
  '@keyframes pv-ring{from{outline-offset:12px;outline-color:transparent}}' +
  '@media (prefers-reduced-motion:reduce){.pv-spot{animation:none}}';

/** Ring what `focus` changes (at most two of each), and with `go`, bring the first into view. */
function spotlight(focus, go) {
  for (const el of document.querySelectorAll('.pv-spot')) el.classList.remove('pv-spot');
  const shown = (el) => el.getClientRects().length > 0 && !el.closest('[hidden]');
  const els = (SPOTS[focus] || []).flatMap((sel) => [...document.querySelectorAll(sel)].filter(shown).slice(0, 2));
  // Rung afresh, so a change shows even when the same parts are rung.
  void document.body.offsetWidth;
  for (const el of els) el.classList.add('pv-spot');
  if (!go) return;
  // Scrolled here, in the frame only (scrollIntoView would scroll the form's page too).
  const r = els[0] && focus !== 'logo' ? els[0].getBoundingClientRect() : null;
  const top = r ? scrollY + r.top - Math.max(16, (innerHeight - r.height) / 2) : 0;
  scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

export async function renderDemo() {
  const ev = sample();
  let brand = null;
  let view = 'guest';
  // Who "you" are in each view: the organizer is Sam; a guest is whoever they answer as.
  const you = { organizer: 'sam', guest: null };
  let n = 0;

  const nope = () =>
    Promise.reject(Object.assign(new Error('That works on your real polls, not in the preview.'), { status: 400 }));
  useStandIn(async (path, { method, body }) => {
    const [, rest = ''] = path.match(/^events\/preview\/?(.*)$/) || [];
    if (path === `events/${ID}` && method === 'GET') {
      const t = brand || {};
      return structuredClone({
        ...ev,
        title: t.title || 'Team lunch',
        location: t.where || '',
        description: t.note || '',
        emoji: t.emoji || '',
        brand: brand && { ...brand, id: ID },
        isAdmin: view === 'organizer',
      });
    }
    const who = rest.match(/^participants(?:\/(\w+))?$/);
    if (who && method === 'POST') {
      const p = { id: `you${++n}`, name: body.name || 'You', availability: body.availability || {}, updatedAt: Date.now() };
      ev.participants.push(p);
      you[view] = p.id;
      return { id: p.id, editToken: 'preview' };
    }
    const p = who && ev.participants.find((x) => x.id === who[1]);
    if (p && method === 'PUT') return Object.assign(p, { ...body, updatedAt: Date.now() }) && {};
    if (p && method === 'DELETE') {
      ev.participants.splice(ev.participants.indexOf(p), 1);
      return {};
    }
    if (rest === 'finalize' && method === 'POST') {
      ev.finalStart = body.start ?? null;
      return {};
    }
    return nope();
  });

  let off = null;
  async function draw() {
    off?.();
    // The organizer's tools show for the organizer's tab (event.js), and "you" is who answered.
    try {
      if (view === 'organizer') sessionStorage.setItem(`venn-organizer:${ID}`, '1');
      else sessionStorage.removeItem(`venn-organizer:${ID}`);
    } catch {}
    if (you[view]) save(ID, { participantId: you[view], editToken: 'preview', adminToken: 'preview' });
    else forget(ID, 'participantId', 'editToken');
    const y = scrollY;
    off = await (await import('./event.js')).renderEvent(ID, () => toast('That works on your real polls, not in the preview.'));
    scrollTo(0, y);
  }

  // Answers show on the group's tab: the answers step opens it (and its end goes back).
  let opened = false;
  const tab = (name) => document.querySelector(`[data-tab="${name}"]`)?.click();
  let focus = '';
  let lastLook = '';
  const ring = (f) => {
    const go = f !== focus;
    if (f === 'answers' && view === 'guest' && !opened) {
      opened = true;
      tab('group');
    } else if (f !== 'answers' && opened) {
      opened = false;
      tab('mine');
    }
    focus = f;
    spotlight(f, go);
  };

  // What the form sends: the look (drawn straight away) and what's in the poll (drawn again), which
  // part to show, and (held) Venn's own look to compare.
  let last = '';
  let comparing = false; // held: Venn's own look, whatever changes meanwhile
  const onMessage = async (e) => {
    if (e.origin !== location.origin || e.source !== parent) return;
    if (typeof e.data?.compare === 'boolean') {
      comparing = e.data.compare;
      return brandLook(comparing ? null : brand);
    }
    if (!e.data?.brand) return;
    const { brand: b, view: v } = e.data;
    const content = JSON.stringify([b.name, b.logo, b.hideName, b.title, b.where, b.note, b.emoji, v]);
    const look = JSON.stringify(b);
    brand = b;
    if (content !== last || !off) {
      last = content;
      if (view !== v) opened = false;
      view = v === 'organizer' ? 'organizer' : 'guest';
      await draw();
      if (opened) tab('group');
    } else brandLook(b);
    if (comparing) brandLook(null);
    // A change rings its part again; a new step brings its part into view.
    if (look !== lastLook || e.data.focus !== focus) ring(e.data.focus || '');
    lastLook = look;
  };
  addEventListener('message', onMessage);
  document.head.append(Object.assign(document.createElement('style'), { textContent: RING }));
  app.innerHTML = '<div class="empty muted">Loading…</div>';
  parent.postMessage({ previewReady: true }, location.origin);
  return () => {
    removeEventListener('message', onMessage);
    off?.();
    useStandIn(null);
  };
}
