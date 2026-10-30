// The create page's icon tile (public/poll-image.js) with a stand-in page: a picture or an emoji,
// never both, through picking a kind of plan, restoring a poll that has a picture, and saving it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Just the elements the icon code looks up, by selector.
const el = (extra = {}) => ({ isConnected: true, hidden: false, value: '', textContent: '', innerHTML: '', ...extra });
const page = {
  '#emoji-tile': el({ textContent: '🗓️' }),
  '#icon-remove': el(),
  '#icon-emoji-row': el(),
  '#icon-emoji': el({ value: '🎂' }),
  '#icon-hint': el(),
  '#icon-finn': el(),
};
globalThis.document = { getElementById: () => null, querySelector: (sel) => page[sel] ?? null };
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
// Blobs come back as data: URLs, as a browser's FileReader would.
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`;
      this.onload();
    });
  }
};
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push([String(url), opts.method || 'GET']);
  if (String(url).includes('/icon.jpg'))
    return new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));
  return Response.json({});
};

const icon = await import('../public/poll-image.js');
const tile = page['#emoji-tile'];

test('poll image: a picture or an emoji, never both', async () => {
  // A kind of plan gives the icon its emoji; nothing typed yet, no picture.
  icon.setOccasion({ emoji: '🍝' });
  assert.equal(tile.textContent, '🍝');
  assert.equal(icon.emoji(), '');
  assert.equal(icon.picture(), null);
  assert.equal(page['#icon-emoji-row'].hidden, false);
  assert.equal(page['#icon-remove'].hidden, true);
  assert.match(page['#icon-hint'].textContent, /^Or use a picture of your own/);

  // Editing a poll with its own emoji and its own picture: the picture is the icon, and the emoji goes.
  await icon.restore({ emoji: '🎂', image: { v: 3 } }, { id: 'abc', edit: true }, true);
  assert.deepEqual(calls.at(-1), ['/api/events/abc/icon.jpg?v=3', 'GET']);
  assert.match(icon.picture(), /^data:image\/jpeg;base64,/);
  assert.match(tile.innerHTML, /^<img src="data:image\/jpeg;base64,/);
  assert.equal(icon.emoji(), '');
  assert.equal(page['#icon-emoji'].value, '');
  assert.equal(page['#icon-emoji-row'].hidden, true);
  assert.equal(page['#icon-remove'].hidden, false);
  assert.equal(page['#icon-finn'].hidden, false);
  assert.equal(page['#icon-hint'].textContent, 'Your picture is the icon. Remove it to use an emoji instead.');
  // A kind of plan picked now keeps the picture.
  icon.setOccasion({ emoji: '🥾' });
  assert.match(icon.picture(), /^data:/);
});

test('poll image: a poll without a picture keeps its own emoji, and nothing is saved for it', async () => {
  page['#emoji-tile'] = el({ textContent: '🗓️' }); // a new create page
  await icon.restore({ emoji: '🎂' }, { id: 'def' }, true);
  assert.equal(icon.emoji(), '🎂');
  assert.equal(page['#emoji-tile'].textContent, '🎂');
  const before = calls.length;
  assert.equal(await icon.upload('def', 'token', 'Cake'), null);
  assert.equal(calls.length, before); // no picture, and none to take away
});

test('poll image: turning the retro look on redraws a poll’s own link-preview card, and never fails over it', async () => {
  calls.length = 0;
  // No picture, or no card: nothing to redraw.
  assert.equal(await icon.restyle({ id: 'abc', title: 'Dinner' }, {}), null);
  assert.equal(await icon.restyle({ id: 'abc', title: 'Dinner', image: { v: 2, card: false } }, {}), null);
  assert.deepEqual(calls, []);
  // A card it can't draw here (no canvas): the old one stays, and nothing is saved.
  assert.equal(await icon.restyle({ id: 'abc', title: 'Dinner', retro: true, image: { v: 2, card: true } }, {}), null);
  assert.deepEqual(calls, [['/api/events/abc/icon.jpg?v=2', 'GET']]);
});
