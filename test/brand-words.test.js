import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Brand-true details (BRAND.md): unavailable is pink, never red; people are organizers and guests,
// never hosts; and the button is Create a Venn.
const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const files = readdirSync(new URL('../public/', import.meta.url)).filter((f) => /\.(js|html|css)$/.test(f));

/** The hue (0–360) of a #rrggbb colour. */
function hue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const red = (hex) => {
  const h = hue(hex);
  return h !== null && (h >= 345 || h <= 15);
};

test('unavailable is pink in the classic look, light and dark, and in brand templates', () => {
  const css = read('styles.css');
  const found = [...css.matchAll(/--no(-soft|-cell)?:\s*(#[0-9a-f]{6})/gi)];
  assert.ok(found.length >= 6, 'light and dark --no, --no-soft, --no-cell');
  for (const [, part, hex] of found) assert.ok(!red(hex), `--no${part || ''} ${hex} is red (hue ${hue(hex)?.toFixed(0)})`);
  const brand = read('brand-look.js');
  for (const [, hex] of brand.matchAll(/--no(?:-cell)?:(#[0-9a-f]{6})/gi)) assert.ok(!red(hex), `brand-look ${hex} is red`);
  // And red is still red, for errors (the check would catch it).
  assert.ok(red('#b42318'));
});

test('no "Hosted by" and no "Create Venn" anywhere people look', () => {
  for (const f of files) {
    const text = read(f);
    assert.doesNotMatch(text, /Hosted by/i, f);
    assert.doesNotMatch(text, /Create Venn/, f);
  }
});
