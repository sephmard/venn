// Finn stickers: Finn in front of the Venn circles with a caption ("It's set!", "I'm in"…), drawn on a
// canvas as see-through 512×512 PNGs with a white sticker edge, to share in a group chat or save.
// Loaded only when someone opens the sticker sheet.

import { reducedMotion, toast, track } from './ui.js';
import { STICKERS, stickerFile } from './finn-moments.js';

const SIZE = 512;
const EDGE = 11; // the white sticker edge
const SERIF = '"Instrument Serif", "Iowan Old Style", "Palatino Linotype", Georgia, serif';
const GREEN = '#0b7a5c';
const AMBER = '#e0a12e';
const DOTS = ['#0b7a5c', '#2fc497', '#8fd9bf', '#e0a12e', '#e0526f'];

let dogPromise = null;
const loadDog = () =>
  (dogPromise ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No dog'));
    img.src = '/img/dog.webp';
  }));

async function loadFont() {
  if (!document.fonts?.load || document.fonts.check(`400 60px "Instrument Serif"`)) return;
  await Promise.race([
    document.fonts.load(`400 60px "Instrument Serif"`).catch(() => {}),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
}

const canvas = () => Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });

function star(ctx, x, y, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const d = i % 2 ? r * 0.32 : r;
    ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function heart(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 24, s / 24);
  ctx.fillStyle = color;
  ctx.fill(new Path2D('M12 21S1.5 14.3 1.5 7.3A5.3 5.3 0 0 1 12 4.6a5.3 5.3 0 0 1 10.5 2.7C22.5 14.3 12 21 12 21Z'));
  ctx.restore();
}

/** What Finn wears or has nearby. (x, y, w, h) is where the picture of Finn is. */
const EXTRAS = {
  hat(ctx, x, y, w) {
    ctx.save();
    ctx.translate(x + w * 0.44, y + 12);
    ctx.rotate(-0.24);
    ctx.beginPath();
    ctx.moveTo(0, -64);
    ctx.lineTo(30, 4);
    ctx.lineTo(-30, 4);
    ctx.closePath();
    ctx.fillStyle = GREEN;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 7;
    for (const d of [-34, -14, 6]) {
      ctx.beginPath();
      ctx.moveTo(-40, d + 14);
      ctx.lineTo(40, d - 10);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.translate(x + w * 0.44, y + 12);
    ctx.rotate(-0.24);
    ctx.beginPath();
    ctx.arc(0, -66, 10, 0, Math.PI * 2);
    ctx.fillStyle = AMBER;
    ctx.fill();
    ctx.restore();
  },
  heart(ctx, x, y, w) {
    heart(ctx, x + w * 0.86, y - 26, 58, '#e0526f');
    heart(ctx, x + w * 1.18, y + 26, 30, '#e0526f');
  },
  check(ctx, x, y, w, h) {
    const [cx, cy] = [x + w + 26, y + h * 0.24];
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.fillStyle = GREEN;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 15, cy + 1);
    ctx.lineTo(cx - 4, cy + 12);
    ctx.lineTo(cx + 16, cy - 11);
    ctx.stroke();
  },
  shades(ctx, x, y, w, h) {
    ctx.save();
    ctx.translate(x + w * 0.39, y + h * 0.142);
    ctx.rotate(0.06);
    ctx.fillStyle = '#16181a';
    for (const dx of [-27, 25]) {
      ctx.beginPath();
      ctx.roundRect(dx - 23, -13, 46, 28, [6, 6, 16, 16]);
      ctx.fill();
    }
    ctx.fillRect(-6, -10, 12, 5);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    for (const dx of [-38, 14]) ctx.fillRect(dx, -8, 10, 4);
    ctx.restore();
  },
  scarf(ctx, x, y, w, h) {
    ctx.save();
    const top = y + h * 0.33;
    ctx.fillStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.04, top + 6);
    ctx.quadraticCurveTo(x + w * 0.45, top + 30, x + w * 0.96, top);
    ctx.lineTo(x + w * 0.98, top + 26);
    ctx.quadraticCurveTo(x + w * 0.45, top + 58, x + w * 0.02, top + 32);
    ctx.closePath();
    ctx.fill();
    // The ends hanging down.
    ctx.beginPath();
    ctx.roundRect(x + w * 0.62, top + 26, 26, 74, 6);
    ctx.fill();
    ctx.fillStyle = AMBER;
    for (const dy of [44, 62, 80]) ctx.fillRect(x + w * 0.62, top + dy, 26, 6);
    ctx.restore();
  },
  sparkle(ctx, x, y, w, h) {
    star(ctx, x - 26, y + 40, 26, AMBER);
    star(ctx, x + w + 30, y + 10, 34, GREEN);
    star(ctx, x + w + 14, y + h * 0.5, 16, AMBER);
  },
  confetti(ctx, x, y, w, h) {
    const bits = [
      [-70, 30, 0.5],
      [-46, 120, -0.6],
      [-84, 190, 0.2],
      [w + 40, 40, 0.8],
      [w + 70, 110, -0.3],
      [w + 30, 200, 0.4],
      [-30, -10, 1],
      [w + 60, -6, -0.9],
    ];
    bits.forEach(([dx, dy, r], i) => {
      ctx.save();
      ctx.translate(x + dx, y + dy + h * 0.04);
      ctx.rotate(r);
      ctx.fillStyle = DOTS[i % DOTS.length];
      if (i % 3 === 0) {
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(-6, -10, 12, 20);
      ctx.restore();
    });
  },
};

/** Draw one sticker's picture (no edge yet) on `ctx`. */
function drawFace(ctx, sticker, dog) {
  // The Venn: three see-through circles, darker where they overlap.
  ctx.fillStyle = 'rgba(47, 196, 151, 0.4)';
  for (const [cx, cy] of [
    [256, 168],
    [200, 262],
    [312, 262],
  ]) {
    ctx.beginPath();
    ctx.arc(cx, cy, 90, 0, Math.PI * 2);
    ctx.fill();
  }
  const h = 300;
  const w = (h * dog.naturalWidth) / dog.naturalHeight;
  const [x, y] = [256 - w / 2, 92];
  const extras = sticker.extra.map((e) => EXTRAS[e]);
  // Confetti behind Finn, everything else in front.
  if (sticker.extra.includes('confetti')) EXTRAS.confetti(ctx, x, y, w, h);
  ctx.drawImage(dog, x, y, w, h);
  for (const [i, draw] of extras.entries()) if (sticker.extra[i] !== 'confetti') draw(ctx, x, y, w, h);

  // The caption, on a tilted green pill over Finn's paws.
  let px = 66;
  const font = (n) => `400 ${n}px ${SERIF}`;
  ctx.font = font(px);
  while (ctx.measureText(sticker.caption).width > 360 && px > 40) ctx.font = font((px -= 2));
  const tw = ctx.measureText(sticker.caption).width;
  ctx.save();
  ctx.translate(256, 418);
  ctx.rotate((sticker.tilt * Math.PI) / 180);
  ctx.beginPath();
  ctx.roundRect(-tw / 2 - 30, -px * 0.72, tw + 60, px * 1.38, 999);
  ctx.fillStyle = GREEN;
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sticker.caption, 0, px * 0.04);
  ctx.restore();
}

/** A sticker as a PNG blob: the picture, a white edge all round it, and a soft shadow. */
export async function makeSticker(sticker) {
  const [dog] = await Promise.all([loadDog(), loadFont()]);
  const face = canvas();
  drawFace(face.getContext('2d'), sticker, dog);
  // The edge: the picture's shape, spread out in every direction and filled with white.
  const edge = canvas();
  const ectx = edge.getContext('2d');
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    ectx.drawImage(face, Math.cos(a) * EDGE, Math.sin(a) * EDGE);
  }
  ectx.globalCompositeOperation = 'source-in';
  ectx.fillStyle = '#fff';
  ectx.fillRect(0, 0, SIZE, SIZE);
  const out = canvas();
  const ctx = out.getContext('2d');
  Object.assign(ctx, { shadowColor: 'rgba(22, 24, 26, 0.28)', shadowBlur: 10, shadowOffsetY: 3 });
  ctx.drawImage(edge, 0, 0);
  ctx.shadowColor = 'transparent';
  ctx.drawImage(face, 0, 0);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('No sticker'))), 'image/png'));
}

const CSS = `
.finn-sheet{width:min(560px,calc(100% - 24px));max-height:calc(100% - 24px);box-sizing:border-box;padding:20px;border:0;
  border-radius:20px;background:var(--surface);color:var(--text);box-shadow:0 20px 60px rgb(0 0 0 / .3)}
.finn-sheet::backdrop{background:rgb(0 0 0 / .45)}
.finn-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.finn-sheet h2{margin:0;font:400 2rem/1.1 var(--serif)}
.finn-sheet .hint{margin:4px 0 14px}
.finn-sheet ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
.finn-sheet li button{display:block;width:100%;aspect-ratio:1;padding:6px;border:1.5px solid var(--border);border-radius:16px;
  background:var(--surface-2);cursor:pointer}
.finn-sheet li button:hover{border-color:var(--accent)}
.finn-sheet li button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.finn-sheet li img{display:block;width:100%;height:100%}
.finn-sheet li button[aria-busy=true] img{visibility:hidden}
@media (prefers-reduced-motion:no-preference){
  .finn-sheet li img{animation:finn-bob 1.6s ease-in-out infinite alternate;animation-delay:calc(var(--i) * -.37s)}
}
@keyframes finn-bob{from{transform:rotate(-2.5deg)}to{transform:translateY(-4px) rotate(2.5deg)}}
`;

function download(file) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const files = new Map(); // the stickers drawn so far, by key, for sharing straight away

/** Share a sticker with the share sheet on phones that can, otherwise save it. */
async function send(sticker, button) {
  const file = files.get(sticker.key);
  if (!file) return;
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      track('share', { how: 'sheet', from: 'sticker' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  download(file);
  button.dataset.saved = file.name;
  track('share', { how: 'download', from: 'sticker' });
  toast('Sticker saved. Drop it in your group chat.');
}

/** Open the sticker sheet. `opener` gets focus back when it closes. */
export function openStickers(opener) {
  if (!document.getElementById('finn-sheet-css')) {
    const s = document.createElement('style');
    s.id = 'finn-sheet-css';
    s.textContent = CSS;
    document.head.append(s);
  }
  const share = matchMedia('(pointer: coarse)').matches && !!navigator.canShare;
  const dlg = document.createElement('dialog');
  dlg.className = 'finn-sheet';
  dlg.setAttribute('aria-labelledby', 'finn-sheet-h');
  dlg.innerHTML = `
    <div class="finn-sheet-head">
      <h2 id="finn-sheet-h">Finn stickers</h2>
      <button type="button" class="icon-btn" aria-label="Close">×</button>
    </div>
    <p class="hint">${share ? 'Tap one to share it in your group chat.' : 'Pick one to save it, then drop it in your group chat.'}</p>
    <ul>${STICKERS.map(
      (s, i) =>
        `<li><button type="button" data-sticker="${s.key}" aria-busy="true" style="--i:${i}"><img alt="" width="${SIZE}" height="${SIZE}" /></button></li>`,
    ).join('')}</ul>`;
  document.body.append(dlg);
  const urls = [];
  const close = () => dlg.close();
  dlg.querySelector('.icon-btn').onclick = close;
  dlg.addEventListener('click', (e) => e.target === dlg && close()); // a tap on the backdrop
  dlg.addEventListener('close', () => {
    dlg.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
    opener?.focus?.({ preventScroll: true });
  });
  for (const s of STICKERS) {
    const b = dlg.querySelector(`[data-sticker="${s.key}"]`);
    b.setAttribute('aria-label', `${share ? 'Share' : 'Save'} the “${s.caption}” sticker`);
    b.onclick = () => send(s, b);
    makeSticker(s)
      .then((blob) => {
        files.set(s.key, new File([blob], stickerFile(s), { type: 'image/png' }));
        const url = URL.createObjectURL(blob);
        urls.push(url);
        b.querySelector('img').src = url;
        b.removeAttribute('aria-busy');
      })
      .catch(() => (b.disabled = true));
  }
  dlg.showModal();
  if (reducedMotion()) return dlg;
  dlg.animate(
    [
      { opacity: 0, transform: 'translateY(12px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 220, easing: 'ease-out' },
  );
  return dlg;
}
