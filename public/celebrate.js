// The moment a poll is created, or an answer is sent: a happy dog bounces in over the Venn circles,
// confetti flies, and a little note says well done. Loaded only when it's needed.

import { esc, reducedMotion, track } from './ui.js';

const DOG = '/img/dog.webp';
new Image().src = DOG; // start loading it while the poll is being saved

const CSS = `
.party{position:fixed;inset:0;z-index:50;display:grid;place-items:center;overflow:hidden;
  background:color-mix(in srgb,var(--bg) 95%,transparent);backdrop-filter:blur(6px)}
.party-stage{display:grid;justify-items:center;gap:10px;text-align:center;padding:16px;max-width:420px}
.party-hero{position:relative;width:230px;height:220px}
.party-hero i{position:absolute;width:128px;height:128px;border-radius:50%;background:var(--accent);opacity:.22}
.party-hero i:nth-child(1){left:51px;top:6px}
.party-hero i:nth-child(2){left:0;top:86px}
.party-hero i:nth-child(3){left:102px;top:86px}
.party-hero img{position:absolute;left:69px;top:4px;width:92px;height:200px;transform-origin:50% 100%}
.party-hero .party-pic{left:auto;right:-6px;top:0;width:76px;height:76px;border-radius:20px;border:4px solid var(--surface);
  object-fit:cover;transform:rotate(8deg);box-shadow:0 6px 16px rgb(0 0 0 / .18)}
.party h2{font-family:var(--serif);font-weight:400;font-size:44px;line-height:1.05;margin:4px 0 0}
.party p{margin:0;font-size:19px;line-height:1.4;text-wrap:balance}
.party .party-go{margin-top:10px;min-height:44px;padding:10px 20px;border:0;border-radius:999px;font:inherit;
  font-size:16px;font-weight:600;background:var(--accent);color:var(--accent-ink);cursor:pointer;max-width:100%;overflow-wrap:anywhere}
.party .party-also,.party .party-sheet{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 20px;
  border:2px solid var(--accent);border-radius:999px;background:var(--bg);color:var(--accent);font-size:16px;font-weight:600;
  text-decoration:none;max-width:100%;overflow-wrap:anywhere}
.party .party-skip{min-height:44px;padding:8px 16px;border:0;background:none;font:inherit;font-size:16px;font-weight:600;
  color:var(--accent);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.party-bit{position:absolute;left:50%;top:50%;pointer-events:none;font-size:28px;line-height:1}
.party-ring{position:absolute;left:50%;top:50%;width:180px;height:180px;margin:-90px;border-radius:50%;
  border:3px solid var(--accent);pointer-events:none}
`;

const DOTS = ['#0b7a5c', '#2fc497', '#8fd9bf', '#14513f', '#c8eedd', '#e0a12e'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = (min, max) => min + Math.random() * (max - min);
const SHOW_MS = 3600;

/**
 * Celebrate a new poll (or, with `heading`, `message` and `button`, an answer). With `share` (copy the
 * link), the main button is Copy link; with `sheet` (the phone's share sheet) too, Share is next to it;
 * "View poll" just opens it. `shown` resolves when it's time to open the
 * poll: after a few seconds, or straight away if the person presses a button or Escape. Then call
 * `finish()` to fade the overlay out over the poll. With `also` ({ label, href }), a second button
 * that goes somewhere else, such as making your own poll; it stays up longer then, to be seen.
 * With `picture` (a URL), the poll's own picture is stuck on beside Finn.
 */
export function celebrate({
  emoji = '🎉',
  title = '',
  heading = 'Your Venn is ready!',
  message = 'Finn is so proud of you for bringing people together.',
  button = title ? `Open ${title} →` : 'Open my poll →',
  share = null,
  sheet = null,
  also = null,
  picture = null,
} = {}) {
  if (!document.getElementById('party-css')) {
    const style = document.createElement('style');
    style.id = 'party-css';
    style.textContent = CSS;
    document.head.append(style);
  }
  const el = document.createElement('div');
  el.className = 'party';
  // A modal dialog: everything behind it is inert while it's up, so focus and taps stay inside.
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'party-h');
  el.innerHTML = `
    <div class="party-stage">
      <div class="party-hero" aria-hidden="true"><i></i><i></i><i></i><img src="${DOG}" alt="" width="92" height="200" />${
        picture ? `<img class="party-pic" src="${esc(picture)}" alt="" width="76" height="76" />` : ''
      }</div>
      <div role="status"></div>
      <button type="button" class="party-go"></button>
      ${sheet ? '<button type="button" class="party-sheet">Share</button>' : ''}
      ${also ? `<a class="party-also"${also.href.startsWith('/') ? ' data-link' : ''}></a>` : ''}
      <button type="button" class="party-skip" hidden>View poll</button>
    </div>`;
  // The toast stays live, so "Link copied" is still heard after sharing.
  const behind = [...document.body.children].filter((n) => !n.inert && n.id !== 'toast');
  for (const n of behind) n.inert = true;
  document.body.append(el);
  // Filled in after it's on the page, so screen readers announce it.
  const status = el.querySelector('[role=status]');
  const h2 = document.createElement('h2');
  const p = document.createElement('p');
  h2.id = 'party-h';
  h2.textContent = heading;
  p.textContent = message;
  status.append(h2, p);
  const go = el.querySelector('.party-go');
  // Sharing is the next step for a new poll: the link, copied, is the main button; Share is next to it.
  go.textContent = share ? 'Copy link' : button;
  const view = el.querySelector('.party-skip');
  view.hidden = !share;
  go.focus({ preventScroll: true });

  const still = reducedMotion();
  const anim = (node, frames, opts) => (still || !node ? null : node.animate(frames, { fill: 'both', ...opts }));
  anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });

  // The three circles slide together into a Venn behind the dog.
  const from = [
    [0, -200],
    [-200, 140],
    [200, 140],
  ];
  el.querySelectorAll('.party-hero i').forEach((c, i) =>
    anim(
      c,
      [
        { transform: `translate(${from[i][0]}px, ${from[i][1]}px) scale(.4)`, opacity: 0 },
        { transform: 'none', opacity: 0.22 },
      ],
      { duration: 520, delay: i * 50, easing: 'cubic-bezier(.2,.8,.2,1)' },
    ),
  );
  // The dog jumps up, lands, then wiggles with joy.
  const dog = el.querySelector('.party-hero img');
  anim(
    dog,
    [
      { transform: 'translateY(90px) scale(.5)', opacity: 0 },
      { transform: 'translateY(-18px) scale(1.06)', opacity: 1, offset: 0.65 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: 620, delay: 200, easing: 'cubic-bezier(.3,1.3,.5,1)' },
  );
  anim(dog, [{ rotate: '-6deg' }, { rotate: '6deg' }], {
    duration: 240,
    delay: 820,
    iterations: 9,
    direction: 'alternate',
    easing: 'ease-in-out',
    fill: 'none',
  });
  for (const [node, delay] of [
    [status, 520],
    [go, 700],
    [el.querySelector('.party-also'), 800],
  ])
    anim(
      node,
      [
        { transform: 'translateY(14px)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 380, delay, easing: 'ease-out' },
    );

  if (!still) {
    const reach = Math.min(innerWidth, innerHeight) * 0.5;
    const piece = (n) => {
      const bit = document.createElement('span');
      bit.className = 'party-bit';
      bit.setAttribute('aria-hidden', 'true');
      if (n % 4 === 0) bit.textContent = pick([emoji, '🎉', '✨', '🥳']);
      else
        Object.assign(bit.style, {
          width: `${rand(7, 12)}px`,
          height: `${rand(8, 16)}px`,
          borderRadius: n % 2 ? '50%' : '2px',
          background: pick(DOTS),
        });
      el.append(bit);
      return bit;
    };
    const fly = (bit, frames, opts) => {
      bit.animate(frames, { fill: 'both', ...opts }).onfinish = () => bit.remove();
    };
    // Bursts out of the middle, then falling.
    const burst = (count, power) => {
      for (let n = 0; n < count; n++) {
        const a = rand(0, Math.PI * 2);
        const d = rand(0.4, 1) * reach * power;
        const [x, y] = [Math.cos(a) * d, Math.sin(a) * d - 60];
        const spin = rand(-360, 360);
        fly(
          piece(n),
          [
            { transform: 'translate(-50%, -50%) scale(.3)', opacity: 1 },
            { transform: `translate(${x}px, ${y}px) scale(1) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.5 },
            { transform: `translate(${x * 1.1}px, ${y + 220}px) scale(.8) rotate(${spin}deg)`, opacity: 0 },
          ],
          { duration: rand(1300, 1800), easing: 'cubic-bezier(.12,.75,.3,1)' },
        );
      }
    };
    // Confetti raining down from the top for the rest of the moment.
    const rain = (count) => {
      for (let n = 0; n < count; n++) {
        const x = rand(-0.5, 0.5) * innerWidth;
        fly(
          piece(n + 1),
          [
            { transform: `translate(${x}px, ${-innerHeight / 2 - 30}px)` },
            { transform: `translate(${x + rand(-60, 60)}px, ${innerHeight / 2 + 30}px) rotate(${rand(-540, 540)}deg)` },
          ],
          { duration: rand(1800, 2800), delay: rand(0, 1800) },
        );
      }
    };
    const ring = () => {
      const r = document.createElement('span');
      r.className = 'party-ring';
      r.setAttribute('aria-hidden', 'true');
      el.append(r);
      fly(
        r,
        [
          { transform: 'scale(.3)', opacity: 0.7 },
          { transform: 'scale(3.4)', opacity: 0 },
        ],
        { duration: 800, easing: 'cubic-bezier(.1,.8,.3,1)' },
      );
    };
    setTimeout(() => {
      navigator.vibrate?.([14, 50, 24]);
      ring();
      burst(50, 1);
      rain(40);
    }, 560);
    setTimeout(() => burst(24, 0.75), 1300);
  }

  let skip;
  const shown = new Promise((resolve) => {
    skip = resolve;
    setTimeout(resolve, also ? SHOW_MS * 2 : SHOW_MS);
  });
  const onKey = (e) => {
    if (e.key === 'Escape') skip();
    if (e.key !== 'Tab') return;
    // Tab and Shift+Tab go round the dialog's buttons.
    e.preventDefault();
    const buttons = [...el.querySelectorAll('button:not([hidden]), a.party-also')];
    const i = buttons.indexOf(document.activeElement);
    buttons[i < 0 ? 0 : (i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
  };
  go.addEventListener('click', () => {
    if (share) {
      track('share', { from: 'created' });
      share();
    }
    skip();
  });
  view.addEventListener('click', () => skip());
  el.querySelector('.party-sheet')?.addEventListener('click', () => {
    track('share', { from: 'created', how: 'sheet' });
    sheet();
    skip();
  });
  const away = el.querySelector('.party-also');
  if (away) {
    away.textContent = also.label;
    away.href = also.href;
    away.addEventListener('click', () => skip());
  }
  addEventListener('keydown', onKey);

  return {
    shown,
    /** Fade the overlay out, revealing the poll underneath. */
    finish() {
      removeEventListener('keydown', onKey);
      for (const n of behind) n.inert = false;
      const out = anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease-in' });
      if (out) out.onfinish = () => el.remove();
      else el.remove();
    },
  };
}
