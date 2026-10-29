import { test } from 'node:test';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { IF_NEEDED, YES } from '../public/core.js';
import {
  MOMENTS,
  STICKERS,
  markSeen,
  momentFor,
  nextMoment,
  pickLine,
  seenMoments,
  stickerFile,
} from '../public/finn-moments.js';

const t = (d, h = 18) => Date.UTC(2030, 0, d, h);
/** An options poll with three evenings, as the API sends it. */
function poll({ answers = [], ...fields } = {}) {
  const options = [8, 9, 10].map((d) => ({ start: t(d), end: t(d, 20) }));
  return {
    mode: 'options',
    timezone: 'UTC',
    options,
    slots: options.map((o) => o.start),
    hostId: 'host',
    isAdmin: true,
    finalStart: null,
    participants: answers.map(([id, availability]) => ({ id, name: id, availability })),
    ...fields,
  };
}

/** An in-memory stand-in for localStorage. */
function memory(init = {}) {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => (data[k] = String(v)),
  };
}

test('Finn: every moment has a few lines, warm and short, without exclamation spam', () => {
  for (const [name, { lines, pose, extra }] of Object.entries(MOMENTS)) {
    assert.ok(lines.length >= 3, `${name} has variants`);
    assert.equal(new Set(lines).size, lines.length, `${name} has no repeats`);
    assert.ok(pose && extra.length, `${name} has a pose`);
    for (const line of lines) {
      assert.match(line, /Finn/, line);
      assert.ok(line.length <= 80, `short enough for a phone: ${line}`);
      assert.ok((line.match(/!/g) || []).length === 0, `no exclamation marks: ${line}`);
      assert.doesNotMatch(line, /'/, `typographic apostrophes: ${line}`);
    }
  }
  assert.equal(
    pickLine('everyone', () => 0),
    'Finn found a date that works for everyone.',
  );
  assert.equal(
    pickLine('lost', () => 0),
    'Finn couldn’t sniff out this poll.',
  );
  // Even an rng that returns exactly 1 picks a line.
  assert.equal(
    pickLine('waiting', () => 1),
    MOMENTS.waiting.lines.at(-1),
  );
  assert.ok(MOMENTS.first.lines.includes(pickLine('first')));
  assert.equal(pickLine('nope'), '');
});

test('Finn: which moment a poll is at, for the organizer', () => {
  assert.equal(momentFor(null), null);
  // Only the organizer's own answer: waiting for guests.
  assert.equal(momentFor(poll()), 'waiting');
  assert.equal(momentFor(poll({ answers: [['host', { [t(8)]: YES }]] })), 'waiting');
  // The first guest.
  assert.equal(
    momentFor(
      poll({
        answers: [
          ['host', { [t(8)]: YES }],
          ['ana', { [t(9)]: YES }],
        ],
      }),
    ),
    'first',
  );
  // More, with nothing that works for all: nothing to say.
  const split = [
    ['host', { [t(8)]: YES }],
    ['ana', { [t(9)]: YES }],
    ['jo', { [t(10)]: YES }],
  ];
  assert.equal(momentFor(poll({ answers: split })), null);
  // Everyone can make the 9th (if needed counts).
  const all = [
    ['host', { [t(9)]: YES }],
    ['ana', { [t(9)]: IF_NEEDED, [t(8)]: YES }],
    ['jo', { [t(9)]: YES }],
  ];
  assert.equal(momentFor(poll({ answers: all })), 'everyone');
  // Two people agreeing isn't news yet.
  assert.equal(momentFor(poll({ answers: all.slice(0, 2) })), 'first');
  // Once it's picked.
  assert.equal(momentFor(poll({ answers: all, finalStart: t(9) })), 'picked');
});

test('Finn: which moment a poll is at, for a guest', () => {
  const answers = [
    ['host', { [t(9)]: YES }],
    ['ana', { [t(9)]: YES }],
    ['jo', { [t(8)]: YES, [t(9)]: 0 }],
  ];
  const guest = { isAdmin: false };
  // Guests don't hear about the organizer's poll filling up.
  assert.equal(momentFor(poll({ ...guest })), null);
  assert.equal(momentFor(poll({ ...guest, answers: answers.slice(0, 2) })), null);
  // Everyone works: guests see that too.
  assert.equal(momentFor(poll({ ...guest, answers: [...answers.slice(0, 2), ['lee', { [t(9)]: IF_NEEDED }]] })), 'everyone');
  // Picked: a match for Ana, who said yes; just picked for Jo, who can't, and for someone who hasn't answered.
  const picked = poll({ ...guest, answers, finalStart: t(9) });
  assert.equal(momentFor(picked, { meId: 'ana' }), 'match');
  assert.equal(momentFor(picked, { meId: 'jo' }), 'picked');
  assert.equal(momentFor(picked), 'picked');
  // A date that wasn't one of the options (picked as a custom date) isn't anyone's match.
  assert.equal(momentFor({ ...picked, finalStart: t(11) }, { meId: 'ana' }), 'picked');
  // If needed still counts as being able to make it.
  const maybe = poll({ ...guest, answers: [['ana', { [t(9)]: IF_NEEDED }]], finalStart: t(9) });
  assert.equal(momentFor(maybe, { meId: 'ana' }), 'match');
});

test('Finn: hours polls match the whole picked time', () => {
  const half = 30 * 60_000;
  const slots = [0, 1, 2, 3].map((i) => t(8) + i * half);
  const ev = {
    mode: 'slots',
    timezone: 'UTC',
    slotMinutes: 30,
    durationMinutes: 60,
    slots,
    isAdmin: false,
    hostId: 'host',
    finalStart: slots[1],
    participants: [
      { id: 'ana', name: 'Ana', availability: { [slots[1]]: YES, [slots[2]]: YES } },
      { id: 'jo', name: 'Jo', availability: { [slots[1]]: YES } }, // only half of it
    ],
  };
  assert.equal(momentFor(ev, { meId: 'ana' }), 'match');
  assert.equal(momentFor(ev, { meId: 'jo' }), 'picked');
});

test('Finn: each moment shows once per poll, and storage problems never break the page', () => {
  const store = memory();
  const ev = poll();
  assert.deepEqual(seenMoments('abc', store), []);
  assert.equal(nextMoment('abc', ev, {}, store), 'waiting');
  markSeen('abc', 'waiting', store);
  markSeen('abc', 'waiting', store); // twice is still once
  assert.equal(store.data['venn:finn:abc'], '["waiting"]');
  assert.equal(nextMoment('abc', ev, {}, store), null);
  // Another poll is a fresh start.
  assert.equal(nextMoment('xyz', ev, {}, store), 'waiting');
  // A new moment shows.
  const first = poll({ answers: [['ana', { [t(8)]: YES }]] });
  assert.equal(nextMoment('abc', first, {}, store), 'first');
  markSeen('abc', 'first', store);
  assert.deepEqual(seenMoments('abc', store), ['waiting', 'first']);
  // Back to no answers (the guest removed theirs): Finn doesn't go back to waiting by the door.
  assert.equal(nextMoment('new', ev, {}, memory({ 'venn:finn:new': '["first"]' })), null);
  // Nothing to say: nothing shown.
  assert.equal(nextMoment('abc', poll({ isAdmin: false }), {}, store), null);

  // Junk stored, storage that throws (private mode), or no storage at all.
  assert.deepEqual(seenMoments('abc', memory({ 'venn:finn:abc': '{"a":1}' })), []);
  assert.deepEqual(seenMoments('abc', memory({ 'venn:finn:abc': 'not json' })), []);
  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.deepEqual(seenMoments('abc', broken), []);
  assert.doesNotThrow(() => markSeen('abc', 'first', broken));
  assert.equal(nextMoment('abc', ev, {}, broken), 'waiting');
  assert.deepEqual(seenMoments('abc', undefined), []);
});

test('Finn stickers: short captions, known extras and tidy file names', () => {
  assert.ok(STICKERS.length >= 5);
  const keys = STICKERS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const s of STICKERS) {
    assert.match(s.key, /^[a-z-]+$/);
    assert.ok(s.caption.length <= 16, s.caption);
    assert.ok(Math.abs(s.tilt) <= 6);
    for (const e of s.extra) assert.ok(['hat', 'confetti', 'scarf', 'heart', 'check', 'shades', 'sparkle'].includes(e), e);
  }
  assert.equal(stickerFile(STICKERS[0]), 'finn-its-set.png');
  assert.deepEqual(
    STICKERS.map((s) => s.caption),
    ['It’s set!', 'See you there', 'I’m in', 'Finn approves', 'Plans > excuses', 'Can’t wait'],
  );
});

test('Finn stickers turn over on their own: every one, each drawn to a picture, one showing at a time', async () => {
  const { STICKER_KEYS, stickerStack } = await import('../public/stickers.js');
  assert.deepEqual(
    STICKER_KEYS,
    STICKERS.map((s) => s.key),
  );
  for (const k of STICKER_KEYS) assert.ok(existsSync(new URL(`../public/img/stickers/finn-${k}.webp`, import.meta.url)), k);
  const html = stickerStack(96);
  assert.equal(html.match(/<img /g).length, STICKERS.length);
  assert.equal(html.match(/class="on"/g).length, 1);
  assert.match(html, /--s:96px/);
});
