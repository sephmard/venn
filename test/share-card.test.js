import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YES, IF_NEEDED } from '../public/core.js';

// ui.js looks up the page's elements when it loads; a stand-in document is enough here.
globalThis.document ??= { getElementById: () => null };
const { SIZES, drawCard, ellipsize, fileName, fitText, layoutCard, whoCanMakeIt, wrap } = await import('../public/share-card.js');

// A stand-in for canvas text measuring: every character is half the font size wide.
const px = (font) => +/(\d+(?:\.\d+)?)px/.exec(font)[1];
const measure = (text, font) => Array.from(text).length * px(font) * 0.5;

test('share card: text wraps by word, and breaks a word only when it is too long alone', () => {
  const f = '10px serif'; // 5px a character
  assert.deepEqual(wrap(measure, 'dinner at finns', f, 50), ['dinner at', 'finns']);
  assert.deepEqual(wrap(measure, '  spaced   out  ', f, 100), ['spaced out']);
  assert.deepEqual(wrap(measure, 'abcdefghijklmnop', f, 25), ['abcde', 'fghij', 'klmno', 'p']);
  assert.deepEqual(wrap(measure, 'hi abcdefghijkl', f, 25), ['hi', 'abcde', 'fghij', 'kl']);
  assert.deepEqual(wrap(measure, '', f, 25), []);
  assert.equal(ellipsize(measure, 'a long line of words', f, 40), 'a long…');
});

test('share card: text takes the biggest size that fits, and ends with … when nothing does', () => {
  const font = (n) => `${n}px serif`;
  const short = fitText(measure, 'Dinner', { font, max: 120, min: 60, maxWidth: 900, maxLines: 2 });
  assert.equal(short.size, 120);
  assert.deepEqual(short.lines, ['Dinner']);
  // 30 characters: one line at 60px, two at 100px.
  const mid = fitText(measure, 'Book club at Priya and Marcus', { font, max: 120, min: 40, maxWidth: 900, maxLines: 2 });
  assert.ok(mid.size < 120 && mid.size >= 60, String(mid.size));
  assert.ok(mid.lines.length <= 2);
  for (const l of mid.lines) assert.ok(measure(l, mid.font) <= 900);
  const long = fitText(measure, 'word '.repeat(80), { font, max: 100, min: 50, maxWidth: 500, maxLines: 2 });
  assert.equal(long.size, 50);
  assert.equal(long.lines.length, 2);
  assert.match(long.lines[1], /…$/);
  assert.ok(measure(long.lines[1], long.font) <= 500);
});

test('share card: file names come from the title', () => {
  assert.equal(fileName("Dinner at Finn's"), 'dinner-at-finns-its-set.png');
  assert.equal(fileName('🍝🍝'), 'venn-its-set.png');
  assert.equal(fileName('Café crème — Friday!'), 'cafe-creme-friday-its-set.png');
  assert.ok(fileName('a'.repeat(100)).length <= 40 + '-its-set.png'.length);
});

test('share card: who can make it, only when the poll shows answers and names', () => {
  const t0 = Date.UTC(2030, 0, 8, 18);
  const t1 = t0 + 86_400_000;
  const ev = {
    mode: 'options',
    timezone: 'UTC',
    options: [
      { start: t0, end: t0 + 7_200_000 },
      { start: t1, end: t1 + 7_200_000 },
    ],
    finalStart: t0,
    participants: [
      { name: 'Ana', availability: { [t0]: IF_NEEDED } },
      { name: 'Jo', availability: { [t0]: YES } },
      { name: 'Lee', availability: { [t1]: YES } },
    ],
  };
  assert.deepEqual(whoCanMakeIt(ev), ['Jo', 'Ana']);
  assert.equal(whoCanMakeIt({ ...ev, hideResults: true }), null);
  assert.equal(whoCanMakeIt({ ...ev, hideNames: true }), null);
  assert.equal(whoCanMakeIt({ ...ev, finalStart: null }), null);
  assert.deepEqual(whoCanMakeIt({ ...ev, participants: [] }), []);
});

const people = (n) => Array.from({ length: n }, (_, i) => `Person ${String.fromCharCode(65 + (i % 26))}${i}`);

for (const size of Object.keys(SIZES)) {
  test(`share card (${size}): everything stays on the picture and in order, short or long`, () => {
    const cases = [
      { title: 'Dinner', when: 'Sat, Nov 7, 7:00 – 9:00 PM', emoji: '🍝', people: people(3) },
      { title: 'x'.repeat(300), when: 'Fri, Nov 6 – Sun, Nov 8 '.repeat(4), emoji: '', people: people(30) },
      { title: 'Book club: the one where we finally finish the long Russian novel', when: 'Sat, Nov 7, all day', people: null },
    ];
    for (const c of cases) {
      const L = layoutCard(measure, { size, ...c });
      const S = SIZES[size];
      assert.equal(L.width, S.width);
      assert.equal(L.height, S.height);
      const inside = (x, y) => x >= 0 && x <= L.width && y >= 0 && y <= L.height;
      assert.ok(inside(L.hero.x, L.hero.y) && inside(L.hero.x + L.hero.w, L.hero.y + L.hero.h));
      for (const block of [L.title, L.date])
        for (const line of block.lines) assert.ok(measure(line.text, block.font) <= L.width - 2 * S.pad, line.text);
      assert.ok(L.title.lines.length <= S.title[2] && L.date.lines.length <= S.date[2]);
      assert.ok(L.date.size <= Math.max(S.date[1], L.title.size * 0.8 + 1), 'the date stays smaller than the title');
      // Top to bottom: hero, "It's set", title, date, faces, then the footer.
      assert.ok(L.hero.y + L.hero.h < L.pill.y);
      assert.ok(L.pill.y + L.pill.h < L.title.lines[0].y);
      assert.ok(L.title.lines.at(-1).y < L.date.lines[0].y);
      assert.ok(L.bottom < L.footer.y - L.footer.size, `${size}: content ends at ${L.bottom}, footer at ${L.footer.y}`);
      assert.equal(Boolean(L.sticker), Boolean(c.emoji));
      if (!c.people) assert.equal(L.faces.length, 0);
      else {
        assert.equal(L.faces.length, Math.min(c.people.length, 8));
        for (const f of L.faces) assert.ok(f.x - f.r >= 0 && f.x + f.r <= L.width);
      }
    }
  });
}

test('share card: more than eight people end with a +N circle', () => {
  const L = layoutCard(measure, { title: 'Dinner', when: 'Sat', people: people(12) });
  assert.equal(L.faces.length, 8);
  assert.deepEqual(L.faces.at(-1), { ...L.faces.at(-1), text: '+5', more: true });
  assert.equal(L.faces[0].text, 'PA');
  assert.equal(L.caption.text, '12 people can make it');
  assert.equal(layoutCard(measure, { title: 'Dinner', when: 'Sat', people: ['Ana'] }).caption.text, '1 person can make it');
  assert.equal(layoutCard(measure, { title: 'Dinner', when: 'Sat', people: [] }).caption, null);
  assert.equal(layoutCard(measure, { size: 'nope', title: '', when: 'Sat' }).width, 1080);
});

/** A 2D context that records what's drawn. */
function fakeContext() {
  const calls = [];
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(
    {},
    {
      get(target, k) {
        if (k in target) return target[k];
        if (k === 'measureText') return (t) => ({ width: measure(t, target.font || '10px x') });
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradient;
        return (...args) => calls.push([k, ...args]);
      },
    },
  );
  return { ctx, calls, texts: () => calls.filter((c) => c[0] === 'fillText').map((c) => c[1]) };
}

test('share card: draws the title, date, initials and venn.day, in light and dark', () => {
  for (const theme of ['light', 'dark', 'other']) {
    const { ctx, calls, texts } = fakeContext();
    const L = layoutCard(measure, { title: 'Finn’s', when: 'Sat, Nov 7', emoji: '🍝', people: ['Ana Lee', 'Jo'] });
    drawCard(ctx, L, { theme, dog: { fake: true } });
    assert.deepEqual(texts(), ['🍝', "It's set", 'Finn’s', 'Sat, Nov 7', 'AL', 'J', '2 people can make it', 'venn.day']);
    assert.equal(calls.filter((c) => c[0] === 'drawImage').length, 1);
  }
  // No faces, no emoji and no dog: just the words.
  const { ctx, calls, texts } = fakeContext();
  drawCard(ctx, layoutCard(measure, { title: 'Dinner', when: 'Sat', people: null }));
  assert.deepEqual(texts(), ["It's set", 'Dinner', 'Sat', 'venn.day']);
  assert.equal(calls.filter((c) => c[0] === 'drawImage').length, 0);
  // +N circles use the theme's colours.
  const many = fakeContext();
  drawCard(many.ctx, layoutCard(measure, { title: 'Dinner', when: 'Sat', people: people(9) }));
  assert.ok(many.texts().includes('+2'));
});
