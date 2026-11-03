import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerBlocks } from '../public/core.js';

const half = (n) => Array.from({ length: n }, (_, i) => i * 30);
const sizes = (blocks) => blocks.map((b) => b.length);

test('answerBlocks: a short stretch is one row', () => {
  assert.deepEqual(sizes(answerBlocks(half(4), 30)), [4]); // 2 hours
  assert.deepEqual(sizes(answerBlocks(half(6), 30)), [6]); // 3 hours: half again as long, still one
});

test('answerBlocks: a long stretch is answered in blocks of about two hours', () => {
  assert.deepEqual(sizes(answerBlocks(half(24), 30)), [4, 4, 4, 4, 4, 4]); // 9 AM – 9 PM
  assert.deepEqual(sizes(answerBlocks(half(9), 30)), [4, 5]); // 4½ hours: a half-hour end joins the block before
  assert.deepEqual(sizes(answerBlocks(half(10), 30)), [4, 4, 2]); // an hour's end is its own row
  assert.deepEqual(answerBlocks(half(8), 30).flat(), half(8)); // every time, once, in order
});

test('answerBlocks: blocks are as long as the meeting when that is longer', () => {
  assert.deepEqual(sizes(answerBlocks(half(24), 30, 240)), [8, 8, 8]);
  assert.deepEqual(
    sizes(
      answerBlocks(
        Array.from({ length: 12 }, (_, i) => i * 60),
        60,
      ),
    ),
    [2, 2, 2, 2, 2, 2],
  );
});
