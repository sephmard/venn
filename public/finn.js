// Finn, the Venn dog, turns up on the poll page at a few moments: waiting for the first answer, when
// it comes, when a date works for everyone, and when the date is picked. A small note under the
// banners, shown once per poll and moment (finn-moments.js decides which), that can be closed.
// Loaded after the poll is on screen, so it never slows the page down.

import { reducedMotion, toast } from './ui.js';
import { MOMENTS, markSeen, momentFor, nextMoment, pickLine } from './finn-moments.js';

const DOG = '/img/dog.webp';

// Little things drawn above Finn's head, in the page so they follow light and dark mode.
const EXTRAS = {
  hat: `<svg class="finn-x-hat" viewBox="0 0 30 36" width="26" height="31"><path d="M15 3 27 33H3Z" fill="var(--accent)"/><path d="M9.6 19.6 19.4 13.4M7 26.3 22.3 16.7M5 31.5 24.6 19.4" stroke="var(--maybe)" stroke-width="2.6" stroke-linecap="round"/><circle cx="15" cy="4" r="4" fill="var(--maybe)"/></svg>`,
  heart: `<svg class="finn-x-heart" viewBox="0 0 24 22" width="18" height="17"><path d="M12 21S1.5 14.3 1.5 7.3A5.3 5.3 0 0 1 12 4.6a5.3 5.3 0 0 1 10.5 2.7C22.5 14.3 12 21 12 21Z" fill="#e0526f"/></svg>`,
  sparkle: `<svg class="finn-x-sparkle" viewBox="0 0 40 30" width="34" height="26"><path d="M10 2c1 6 2 7 8 8-6 1-7 2-8 8-1-6-2-7-8-8 6-1 7-2 8-8Z" fill="var(--maybe)"/><path d="M30 12c.7 4 1.3 4.6 5 5.3-3.7.7-4.3 1.3-5 5.3-.7-4-1.3-4.6-5-5.3 3.7-.7 4.3-1.3 5-5.3Z" fill="var(--accent)"/></svg>`,
  dots: `<span class="finn-x-dots"><i></i><i></i><i></i></span>`,
  question: `<span class="finn-x-q">?</span>`,
};

const CSS = `
.finn{display:flex;align-items:flex-end;gap:6px;margin:0 0 16px;max-width:560px}
.finn-fig{position:relative;flex:none;width:46px;height:100px;margin-top:26px}
.finn-fig img{display:block;width:46px;height:100px;transform-origin:50% 100%}
.finn-fig svg,.finn-fig span{position:absolute;pointer-events:none}
.finn-x-hat{left:6px;top:-25px;transform:rotate(-14deg)}
.finn-x-heart{left:34px;top:-14px;transform:rotate(12deg)}
.finn-x-sparkle{left:24px;top:-24px}
.finn-x-dots{left:8px;top:-24px;display:flex;gap:3px;padding:5px 7px;border-radius:999px;background:var(--surface);border:1.5px solid var(--border)}
.finn-x-dots i{width:5px;height:5px;border-radius:50%;background:var(--muted)}
.finn-x-q{left:32px;top:-26px;font:400 34px/1 var(--serif);color:var(--accent)}
.finn.look .finn-fig img{transform:scaleX(-1) rotate(-6deg)}
.finn-bubble{position:relative;flex:1;min-width:0;margin-bottom:34px;padding:12px 4px 12px 16px;display:flex;align-items:flex-start;gap:4px;
  background:var(--surface);border:1.5px solid var(--border);border-radius:18px}
.finn-bubble::before{content:'';position:absolute;left:-8px;bottom:14px;width:14px;height:14px;background:inherit;
  border:inherit;border-width:0 0 1.5px 1.5px;border-radius:0 0 0 4px;transform:rotate(45deg) skew(8deg,8deg)}
.finn-say{flex:1;min-width:0;padding-top:1px}
.finn-say p{margin:0;font-size:16px;line-height:1.4;text-wrap:pretty}
.finn-say .link-btn{min-height:44px;padding:0;margin-bottom:-12px}
.finn-close{flex:none;width:44px;height:44px;margin:-10px 0 -10px;border:0;border-radius:50%;background:none;color:var(--muted);
  font-size:22px;line-height:1;cursor:pointer}
.finn-close:hover{color:var(--text)}
.finn-lost{justify-content:center;max-width:none;margin:0 0 4px}
.finn-lost .finn-fig{margin-top:30px}
@media (prefers-reduced-motion:no-preference){
  .finn-x-dots i{animation:finn-dot 1.2s ease-in-out 4 both}
  .finn-x-dots i:nth-child(2){animation-delay:.2s}
  .finn-x-dots i:nth-child(3){animation-delay:.4s}
}
@keyframes finn-dot{50%{opacity:.25;transform:translateY(-2px)}}
`;

function styles() {
  if (document.getElementById('finn-css')) return;
  const s = document.createElement('style');
  s.id = 'finn-css';
  s.textContent = CSS;
  document.head.append(s);
}

/** Finn and whatever's above Finn's head. Decorative: the words say what's going on. */
const figure = (extras) =>
  `<div class="finn-fig" aria-hidden="true"><img src="${DOG}" alt="" width="46" height="100" />${extras.map((x) => EXTRAS[x]).join('')}</div>`;

/** The poses, as animations of the picture: a hop, a wag, a curious head tilt, a look around. */
function pose(el, name) {
  if (reducedMotion()) return;
  const img = el.querySelector('.finn-fig img');
  const extras = el.querySelectorAll('.finn-fig svg, .finn-fig span');
  // It slides in rather than fading, so the words are fully readable from the start.
  el.animate([{ transform: 'translateY(10px)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
  const frames = {
    hop: [
      [{ transform: 'none' }, { transform: 'translateY(-14px) rotate(-4deg)' }, { transform: 'none' }],
      { duration: 420, delay: 200, iterations: 2, easing: 'cubic-bezier(.3,.7,.4,1)' },
    ],
    wag: [
      [{ transform: 'rotate(-7deg)' }, { transform: 'rotate(7deg)' }],
      { duration: 220, delay: 200, iterations: 8, direction: 'alternate', easing: 'ease-in-out' },
    ],
    tilt: [
      [
        { transform: 'none' },
        { transform: 'rotate(-9deg)', offset: 0.3 },
        { transform: 'rotate(-9deg)', offset: 0.7 },
        { transform: 'none' },
      ],
      { duration: 1800, delay: 300, iterations: 2, easing: 'ease-in-out' },
    ],
    look: [
      [
        { transform: 'scaleX(-1) rotate(-6deg)' },
        { transform: 'scaleX(1) rotate(6deg)', offset: 0.45 },
        { transform: 'scaleX(1) rotate(6deg)', offset: 0.55 },
        { transform: 'scaleX(-1) rotate(-6deg)' },
      ],
      { duration: 1600, delay: 300, easing: 'steps(1, end)' },
    ],
  }[name];
  if (frames) img.animate(...frames);
  extras.forEach((x, i) =>
    x.animate(
      [
        { opacity: 0, translate: '0 8px', scale: '.4' },
        { opacity: 1, translate: '0 0', scale: '1' },
      ],
      { duration: 360, delay: 380 + i * 140, easing: 'cubic-bezier(.3,1.5,.5,1)', fill: 'backwards' },
    ),
  );
}

function stickers(button) {
  import('./finn-stickers.js').then((m) => m.openStickers(button)).catch(() => toast("Couldn't open the stickers. Try again."));
}

/** Finn's note for `moment`, put on the page after `anchor`. */
function note(moment, anchor) {
  const { pose: name, extra } = MOMENTS[moment];
  const el = document.createElement('div');
  el.className = `finn ${name}`;
  el.dataset.finn = moment;
  el.innerHTML = `${figure(extra)}
    <div class="finn-bubble">
      <div class="finn-say"><p role="status"></p>${
        // Waiting on answers, the thing to do is share the poll; the stickers are for celebrating.
        moment === 'waiting'
          ? `<button type="button" class="link-btn" data-share>${navigator.share && matchMedia('(pointer: coarse)').matches ? 'Share the poll' : 'Copy invite link'}</button>`
          : moment === 'match'
            ? '<button type="button" class="link-btn" data-finn-stickers>Finn stickers</button>'
            : ''
      }</div>
      <button type="button" class="finn-close" aria-label="Close Finn's note">×</button>
    </div>`;
  anchor.after(el);
  // Filled in once it's on the page, so screen readers read it out.
  el.querySelector('[role=status]').textContent = pickLine(moment);
  el.querySelector('[data-finn-stickers]')?.addEventListener('click', (e) => stickers(e.currentTarget));
  el.querySelector('.finn-close').addEventListener('click', () => {
    cur.closed = true;
    el.remove();
  });
  pose(el, name);
  return el;
}

let cur = null; // { id, moment, el, closed }: the note on the page now

/**
 * The poll page calls this each time its banners are drawn. Shows Finn's note when the poll reaches a
 * new moment, keeps it there while the page redraws, and adds "Finn stickers" under the "It's set" banner's "More".
 */
export function react({ id, ev, meId = null, anchor }) {
  if (!anchor?.isConnected) return;
  styles();
  // Organizers find them under the banner's "More"; guests, in Finn's note when their date won.
  const more = anchor.querySelector('.final-extras-body');
  if (more && !more.querySelector('[data-finn-stickers]')) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link-btn';
    b.dataset.finnStickers = '';
    b.textContent = 'Finn stickers';
    b.onclick = () => stickers(b);
    // Next to "Share as a picture", the other thing to post.
    (more.querySelector('#share-card') || more.lastElementChild)?.after(b);
  }
  const now = momentFor(ev, { meId });
  if (cur?.id === id) {
    if (cur.moment === now) {
      if (!cur.closed && !cur.el.isConnected) anchor.after(cur.el);
      return;
    }
    cur.el.remove();
  }
  cur = null;
  const m = nextMoment(id, ev, { meId });
  if (!m) return;
  markSeen(id, m);
  cur = { id, moment: m, el: note(m, anchor), closed: false };
}

/** "Poll not found": Finn, a bit puzzled, above the message. */
export function lost(sheet) {
  if (!sheet?.isConnected || sheet.querySelector('.finn')) return;
  styles();
  const el = document.createElement('div');
  el.className = 'finn finn-lost look';
  el.innerHTML = figure(MOMENTS.lost.extra);
  const line = document.createElement('p');
  line.className = 'finn-lost-line';
  line.textContent = pickLine('lost');
  sheet.prepend(el);
  sheet.querySelector('h1')?.after(line);
  pose(el, 'look');
}
