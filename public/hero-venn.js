// The home page's Venn, from noise to a plan: a group chat's messages bounce around, fly to the
// three friends, and the circles drift together until the day that works for everyone pops out.
// It plays while it's in view. Tap to play it again; press and hold a circle (with a mouse, just
// drag) to pull a friend away and watch the ✓ follow the overlap. Still for reduced motion.

function start(fig) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const circles = [...fig.querySelectorAll('.venn-c')];
  const hit = fig.querySelector('.venn-hit');
  // Who said what: each message ends up with the friend who sent it.
  const said = [
    ['Thu?', 0],
    ['Fri works', 0],
    ['Sat 👍', 0],
    ['Fri?', 1],
    ['Sat ok', 1],
    ['Sun?', 1],
    ['Wed!', 2],
    ['Sat?', 2],
  ];
  const chips = said.map(([text, to]) => {
    const el = document.createElement('span');
    el.className = 'venn-chip';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = text;
    fig.append(el);
    // A path of its own through the noise.
    const r = () => 1.1 + Math.random() * 1.6;
    return { el, to, a: r(), b: r(), p: Math.random() * 6.3, q: Math.random() * 6.3 };
  });
  fig.classList.add('venn-live');

  // Where things are: the circles' resting centres, and how far apart they start.
  const R = circles[0].offsetWidth / 2;
  const rest = circles.map((c) => ({ x: c.offsetLeft + R, y: c.offsetTop + R }));
  const APART = [
    [-50, -28],
    [50, -28],
    [0, 46],
  ];
  const restMid = meet(rest, R);
  const drag = circles.map(() => ({ x: 0, y: 0 }));

  // The story, in seconds: noise, then the messages find their friends, then the circles meet.
  const GATHER = 2.4,
    JOIN = 3.4,
    MET = 4.5,
    PART = 11,
    LOOP = 12.4;
  let t0 = performance.now();
  let idleSince = still ? 0 : null; // after a tap or a drag, the circles just float a while
  let grab = null; // { i, x, y, from: {x, y} }
  let spring = []; // circles going back to rest after a drag
  let settled = false;

  function frame(now) {
    const s = (now - t0) / 1000;
    if (!still && idleSince != null && !grab && now - idleSince > 15000) {
      idleSince = null; // nobody's playing: the story goes on, starting by drifting apart
      t0 = now - PART * 1000;
    }
    const t = idleSince != null ? MET + 1 : s % LOOP;
    const float = (i) => (still ? [0, 0] : [Math.sin(now / 1100 + i * 2.1) * 5, Math.cos(now / 1400 + i * 1.3) * 4]);
    const centres = circles.map((c, i) => {
      // How far apart and how visible, by where the story is.
      let u = 0,
        show = 1;
      if (t < GATHER) ((show = 0), (u = 1));
      else if (t < JOIN) ((show = ease((t - GATHER) / (JOIN - GATHER))), (u = 1));
      else if (t < MET) u = 1 - back((t - JOIN) / (MET - JOIN));
      else if (t > PART) ((u = ease(Math.min(1, (t - PART) / 1.2))), (show = 1 - u));
      const [fx, fy] = float(i);
      const sp = spring[i];
      if (sp) {
        const k = Math.min(1, (now - sp.at) / 700);
        drag[i] = { x: sp.x * (1 - back(k)), y: sp.y * (1 - back(k)) };
        if (k === 1) spring[i] = null;
      }
      const x = APART[i][0] * u + fx + drag[i].x;
      const y = APART[i][1] * u + fy + drag[i].y;
      c.style.translate = `${x}px ${y}px`;
      c.style.opacity = show;
      c.style.scale = String(0.7 + 0.3 * show);
      return { x: rest[i].x + x, y: rest[i].y + y };
    });
    // The ✓ sits where all three meet, and only while they do.
    const m = meet(centres, R * 0.97);
    const met = !!m && (idleSince != null || (t >= MET && t <= PART));
    if (m) hit.style.translate = `calc(-50% + ${m.x - restMid.x}px) ${m.y - restMid.y}px`;
    hit.classList.toggle('off', !met);
    // The messages: bouncing around, then off to whoever sent them.
    for (const c of chips) {
      const w = c.el.offsetWidth,
        h = c.el.offsetHeight;
      const W = fig.clientWidth,
        H = fig.clientHeight;
      let x = W / 2 + (W / 2 - w / 2) * Math.sin(s * c.a + c.p);
      let y = H / 2 + (H / 2 - h / 2) * Math.sin(s * c.b + c.q);
      let o = idleSince != null || t > JOIN ? 0 : Math.min(1, t / 0.3);
      if (idleSince == null && t >= GATHER && t <= JOIN) {
        const u = ease((t - GATHER) / (JOIN - GATHER));
        const to = { x: rest[c.to].x + APART[c.to][0], y: rest[c.to].y + APART[c.to][1] };
        x += (to.x - x) * u;
        y += (to.y - y) * u;
        o = 1 - u * u;
      }
      c.el.style.translate = `${x - w / 2}px ${y - h / 2}px`;
      c.el.style.opacity = o;
    }
    if (!settled && (idleSince != null || t >= MET)) fig.dataset.settled = settled = true;
    if (!still || grab || spring.some(Boolean)) req();
  }
  let raf = 0;
  let inView = true;
  const req = () => {
    if (!raf && inView) raf = requestAnimationFrame((now) => ((raf = 0), frame(now)));
  };
  new IntersectionObserver(([e]) => ((inView = e.isIntersecting), req())).observe(fig);
  req();

  // Playing with it.
  let down = null; // { x, y, at, i, timer }
  const take = (i, x, y) => {
    grab = { i, x, y, from: { ...drag[i] } };
    spring[i] = null;
    idleSince = performance.now();
    circles[i].classList.add('held');
    navigator.vibrate?.(10);
    req();
  };
  fig.addEventListener('pointerdown', (e) => {
    const i = circles.indexOf(e.target.closest('.venn-c'));
    down = { x: e.clientX, y: e.clientY, at: performance.now(), i };
    if (i < 0) return;
    if (e.pointerType === 'mouse') return (e.preventDefault(), take(i, e.clientX, e.clientY));
    down.timer = setTimeout(() => take(i, down.x, down.y), 250); // a quick swipe still scrolls
  });
  addEventListener('pointermove', (e) => {
    if (down && !grab && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) clearTimeout(down.timer);
    if (!grab) return;
    drag[grab.i] = { x: grab.from.x + e.clientX - grab.x, y: grab.from.y + e.clientY - grab.y };
    req();
  });
  fig.addEventListener('touchmove', (e) => grab && e.cancelable && e.preventDefault(), { passive: false });
  const up = (e) => {
    clearTimeout(down?.timer);
    if (grab) {
      circles[grab.i].classList.remove('held');
      spring[grab.i] = { ...drag[grab.i], at: performance.now() };
      idleSince = performance.now();
      grab = null;
      req();
    } else if (down && e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && !still) {
      idleSince = null; // a tap: from the noise again
      t0 = performance.now();
      req();
    }
    down = null;
  };
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

/** The middle of where all the circles meet, or null if they don't all. */
function meet(cs, r) {
  const xs = cs.map((c) => c.x),
    ys = cs.map((c) => c.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let n = 0,
    x = 0,
    y = 0;
  for (let i = 0; i <= 16; i++)
    for (let j = 0; j <= 16; j++) {
      const p = { x: x0 + ((x1 - x0) * i) / 16, y: y0 + ((y1 - y0) * j) / 16 };
      if (cs.every((c) => Math.hypot(c.x - p.x, c.y - p.y) < r)) ((n += 1), (x += p.x), (y += p.y));
    }
  return n ? { x: x / n, y: y / n } : null;
}
const ease = (u) => 1 - (1 - u) ** 3;
const back = (u) => 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2;

const fig = document.querySelector('.venn');
if (fig) start(fig);
