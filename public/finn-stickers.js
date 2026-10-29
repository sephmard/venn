// Finn stickers: Finn in front of the Venn circles with a caption ("It's set!", "I'm in"…), drawn on a
// canvas as see-through 512×512 PNGs with a white sticker edge. scripts/stickers.js draws them to the
// pictures the site and poll page turn over (stickers.js), and poll-image.js puts one on a poll's card.

const SIZE = 512;
const EDGE = 11; // the white sticker edge
const SERIF = '"Instrument Serif", "Iowan Old Style", "Palatino Linotype", Georgia, serif';
// How a sticker looks: the app's (green, a serif caption, a white edge), or the website's retro one
// (neon circles, an arcade caption, a glowing cyan edge).
const LOOKS = {
  plain: {
    green: '#0b7a5c',
    amber: '#e0a12e',
    dots: ['#0b7a5c', '#2fc497', '#8fd9bf', '#e0a12e', '#e0526f'],
    venn: ['rgba(47, 196, 151, 0.4)'],
    font: SERIF,
    caption: ['#0b7a5c', '#fff'],
    edge: '#fff',
  },
  retro: {
    green: '#ff3cac',
    amber: '#ffd319',
    dots: ['#2de2e6', '#ff3cac', '#ffd319', '#f222ff', '#ff901f'],
    venn: ['rgba(45, 226, 230, 0.75)', 'rgba(255, 60, 172, 0.75)', 'rgba(255, 211, 25, 0.7)'],
    blend: 'lighter', // neon adds up where the circles cross
    font: '"Press Start 2P", monospace',
    caption: ['#ff3cac', '#0d0221'],
    edge: '#2de2e6',
    arcade: true, // the caption's pixel font is wide: smaller, on a square tag
  },
};
let look = LOOKS.plain;

let dogPromise = null;
const loadDog = () =>
  (dogPromise ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No dog'));
    img.src = '/img/dog.webp';
  }));

let pixelFont = null; // the website's arcade font, added once
async function loadFont() {
  const family = look === LOOKS.retro ? 'Press Start 2P' : 'Instrument Serif';
  if (look === LOOKS.retro && !pixelFont) {
    pixelFont = new FontFace(family, 'url(/fonts/press-start-2p-latin-400-normal.woff2)');
    document.fonts.add(pixelFont);
    await pixelFont.load().catch(() => {});
  }
  if (!document.fonts?.load || document.fonts.check(`400 60px "${family}"`)) return;
  await Promise.race([document.fonts.load(`400 60px "${family}"`).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
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
    ctx.fillStyle = look.green;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = look.amber;
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
    ctx.fillStyle = look.amber;
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
    ctx.fillStyle = look.green;
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
    ctx.fillStyle = look.green;
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
    ctx.fillStyle = look.amber;
    for (const dy of [44, 62, 80]) ctx.fillRect(x + w * 0.62, top + dy, 26, 6);
    ctx.restore();
  },
  sparkle(ctx, x, y, w, h) {
    star(ctx, x - 26, y + 40, 26, look.amber);
    star(ctx, x + w + 30, y + 10, 34, look.green);
    star(ctx, x + w + 14, y + h * 0.5, 16, look.amber);
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
      ctx.fillStyle = look.dots[i % look.dots.length];
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
  for (const [i, [cx, cy]] of [
    [256, 168],
    [200, 262],
    [312, 262],
  ].entries()) {
    ctx.fillStyle = look.venn[i % look.venn.length];
    ctx.globalCompositeOperation = look.blend || 'source-over';
    ctx.beginPath();
    ctx.arc(cx, cy, 90, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  const h = 300;
  const w = (h * dog.naturalWidth) / dog.naturalHeight;
  const [x, y] = [256 - w / 2, 92];
  const extras = sticker.extra.map((e) => EXTRAS[e]);
  // Confetti behind Finn, everything else in front.
  if (sticker.extra.includes('confetti')) EXTRAS.confetti(ctx, x, y, w, h);
  ctx.drawImage(dog, x, y, w, h);
  for (const [i, draw] of extras.entries()) if (sticker.extra[i] !== 'confetti') draw(ctx, x, y, w, h);

  // The caption, on a tilted green pill over Finn's paws.
  let px = look.arcade ? 34 : 66;
  const font = (n) => `400 ${n}px ${look.font}`;
  ctx.font = font(px);
  while (ctx.measureText(sticker.caption).width > 360 && px > (look.arcade ? 16 : 40)) ctx.font = font((px -= 2));
  const tw = ctx.measureText(sticker.caption).width;
  ctx.save();
  ctx.translate(256, 418);
  ctx.rotate((sticker.tilt * Math.PI) / 180);
  ctx.beginPath();
  ctx.roundRect(
    -tw / 2 - 30,
    -px * 0.72 - (look.arcade ? 8 : 0),
    tw + 60,
    px * 1.38 + (look.arcade ? 16 : 0),
    look.arcade ? 8 : 999,
  );
  ctx.fillStyle = look.caption[0];
  ctx.fill();
  ctx.fillStyle = look.caption[1];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sticker.caption, 0, px * 0.04);
  ctx.restore();
}

/** A sticker as a PNG blob: the picture, a white edge all round it, and a soft shadow. With
 * `{ retro: true }`, the website's look: neon, an arcade caption, and a glowing cyan edge. */
export async function makeSticker(sticker, { retro = false } = {}) {
  look = retro ? LOOKS.retro : LOOKS.plain;
  const [dog] = await Promise.all([loadDog(), loadFont()]);
  look = retro ? LOOKS.retro : LOOKS.plain; // another sticker may have been drawn while waiting
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
  ectx.fillStyle = look.edge;
  ectx.fillRect(0, 0, SIZE, SIZE);
  const out = canvas();
  const ctx = out.getContext('2d');
  const shadow = retro
    ? { shadowColor: 'rgba(255, 60, 172, 0.9)', shadowBlur: 18, shadowOffsetY: 0 }
    : { shadowColor: 'rgba(22, 24, 26, 0.28)', shadowBlur: 10, shadowOffsetY: 3 };
  Object.assign(ctx, shadow);
  ctx.drawImage(edge, 0, 0);
  ctx.shadowColor = 'transparent';
  ctx.drawImage(face, 0, 0);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('No sticker'))), 'image/png'));
}
