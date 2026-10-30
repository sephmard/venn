// Regenerates the README images (docs/screenshots/*.png and docs/demo.gif): `npm run screenshots`.
// The README shows the retro look; stills('light') or stills('dark') shoot the usual one.
// Needs Playwright's Chromium (`npx playwright install chromium`) and ffmpeg (for the GIF).

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createApp } from '../server.js';
import { DAY_PARTS, zonedToUtc, addDays, weekdayOf } from '../public/core.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'screenshots');
const TZ = 'America/New_York';
mkdirSync(out, { recursive: true });

const server = createApp({ dbPath: ':memory:' });
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const api = async (path, body, headers = {}) => {
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });
  return res.json();
};

// The Friday at least a week from today, so the demo always looks upcoming.
function nextFriday() {
  let d = addDays(new Date().toISOString().slice(0, 10), 7);
  while (weekdayOf(d) !== 5) d = addDays(d, 1);
  return d;
}

const fri = nextFriday();
const EVENING = DAY_PARTS.find((p) => p.key === 'evening');
// Dinner, a Venn of evenings: Friday to Sunday this week, and Friday and Saturday next.
const DAYS = [0, 1, 2, 7, 8];
const OPTIONS = DAYS.map((d) => ({
  start: zonedToUtc(addDays(fri, d), EVENING.start, TZ),
  end: zonedToUtc(addDays(fri, d), EVENING.end, TZ),
}));

// Answers per evening: 2 = available, 1 = if needed, 0 = unavailable.
const PEOPLE = {
  'Priya Shah': [2, 0, 2, 2, 1],
  'Marcus Lee': [0, 2, 1, 2, 2],
  'Ana Silva': [2, 2, 0, 2, 0],
  'Jordan Kim': [1, 0, 2, 1, 2],
  'Lee Wong': [2, 1, 0, 2, 2],
};
const SAM = [2, 0, 1, 2, 0];

const toAvailability = (votes) => Object.fromEntries(OPTIONS.map((o, i) => [o.start, votes[i]]).filter(([, v]) => v));

async function seedPoll(retro) {
  const { id, adminToken } = await api('/api/events', {
    title: 'Dinner at Rosa’s',
    emoji: '🍝',
    location: 'Rosa’s Trattoria, 14 Elm St',
    description: 'Long table in the back. Bring an appetite.',
    organizer: 'Priya Shah',
    timezone: TZ,
    mode: 'options',
    layout: 'parts',
    options: OPTIONS,
    ...(retro && { retro: true }),
  });
  for (const [name, votes] of Object.entries(PEOPLE))
    await api(`/api/events/${id}/participants`, { name, availability: toAvailability(votes) });
  return { id, adminToken };
}

const HIDE_TOAST = '#toast { display: none !important; }';

// On the create page's parts of the day, the week shown from today: forward until `date` shows.
async function showDay(page, date, step = (sel) => page.click(sel)) {
  const cell = page.locator(`#when .pg-cell[data-d="${date}"][data-m="${EVENING.start}"]`);
  for (let i = 0; i < 10 && !(await cell.count()); i++) await step('#when [data-pstep="1"]');
  return cell;
}

/** Tap a part of the day's answer as many times as `v` needs: once for available, twice for if needed. */
const TAPS = { 2: 1, 1: 2, 0: 0 };

// Screenshot `selector` from the top of `from` (default: the page, so the header shows) to its bottom,
// cropped to the width of `crop` (default: the whole page).
async function shoot(page, selector, path, { from, crop, pad = 24 } = {}) {
  const box = (sel) =>
    page.locator(sel).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right };
    });
  const top = from ? Math.max(0, (await box(from)).top - pad) : 0;
  const bottom = (await box(selector)).bottom + pad;
  const width = page.viewportSize().width;
  const c = crop ? await box(crop) : { left: pad, right: width - pad };
  const x = Math.max(0, c.left - pad);
  // Backgrounds sized to the window (the retro night) must reach the bottom of a tall shot.
  if (bottom > page.viewportSize().height) await page.setViewportSize({ width, height: Math.ceil(bottom) });
  await page.screenshot({
    path,
    fullPage: true,
    clip: { x, y: top, width: Math.min(width, c.right + pad) - x, height: bottom - top },
  });
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function newPage({ dark = false, mobile = false, video } = {}) {
  const context = await browser.newContext({
    timezoneId: TZ,
    locale: 'en-US',
    colorScheme: dark ? 'dark' : 'light',
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    deviceScaleFactor: video ? 1 : 2,
    isMobile: mobile,
    hasTouch: mobile,
    recordVideo: video,
  });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  return page;
}

// Answer the seeded poll as "Sam" through the UI so the page shows Sam as "you".
async function answerAsSam(page, id) {
  await page.goto(`${base}/e/${id}`);
  await page.waitForSelector('#mine .part-vote');
  for (const [i, v] of SAM.entries()) for (let t = 0; t < TAPS[v]; t++) await page.locator('#mine .part-vote').nth(i).click();
  await page.fill('#name', 'Sam');
  // Confirm, then skip the "Answer submitted!" celebration.
  await page.click('#save');
  // "Submit your answer?" is only asked for a partial answer.
  await page
    .locator('#sc-yes')
    .waitFor({ timeout: 1500 })
    .then(
      () => page.click('#sc-yes'),
      () => {},
    );
  await page.click('.party-go');
  await page.waitForSelector('.party', { state: 'detached' });
  await page.waitForSelector('#overlap .ov-list');
  await page.evaluate(() => scrollTo(0, 0));
}

// One set of stills: light, dark, or the retro look (a synthwave night, whatever the colour scheme).
async function stills(look) {
  const dark = look === 'dark';
  const retro = look === 'retro';
  const suffix = look;
  const { id } = await seedPoll(retro);

  const desktop = await newPage({ dark });
  await answerAsSam(desktop, id);
  // The save bar sticks to the bottom of the window; in a full-page shot it would float mid-page.
  await desktop.addStyleTag({ content: `${HIDE_TOAST} .save-bar { position: static !important; }` });
  await shoot(desktop, '#panel-group', join(out, `results-${suffix}.png`), { crop: '#event-root' });

  await desktop.goto(`${base}/new${retro ? '?retro=1' : ''}`);
  await desktop.addStyleTag({ content: HIDE_TOAST });
  await desktop.click('[data-occasion="0"]');
  await desktop.fill('#title', 'Dinner at Rosa’s');
  await desktop.click('#more-box summary'); // Where is under More details
  await desktop.fill('#location', 'Rosa’s Trattoria, 14 Elm St');
  // Date and time, by parts of the day: Friday to Sunday evenings, Saturday only if needed.
  await desktop.click('[data-level="parts"]');
  await showDay(desktop, fri);
  for (const d of [0, 1, 2])
    await desktop.locator(`#when .pg-cell[data-d="${addDays(fri, d)}"][data-m="${EVENING.start}"]`).click();
  await desktop.locator(`#when .pg-cell[data-d="${addDays(fri, 1)}"][data-m="${EVENING.start}"]`).click();
  await desktop.locator('#title').blur();
  await desktop.mouse.move(0, 0); // no hover ×
  await desktop.addStyleTag({ content: '.create-bar { position: static; }' });
  await shoot(desktop, '.sheet:has(#when-h)', join(out, `create-${suffix}.png`), {
    from: '.sheet:has(#when-h)',
    crop: '#create',
  });
  await desktop.context().close();

  const phone = await newPage({ dark, mobile: true });
  await phone.goto(`${base}/e/${id}`);
  await phone.waitForSelector('#mine .part-vote');
  for (const [i, v] of [2, 1, 0, 2, 2].entries())
    for (let t = 0; t < TAPS[v]; t++) await phone.locator('#mine .part-vote').nth(i).tap();
  await phone.fill('#name', 'Jamie');
  await phone.locator('#name').blur();
  // The tabs stick to the top, so line the first answer up just below them.
  await phone.evaluate(() => {
    const tabs = document.querySelector('.tabs').getBoundingClientRect().height;
    const row = document.querySelector('#mine').getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, row - tabs - 24);
  });
  await phone.waitForTimeout(500); // let Submit finish turning ready
  await phone.screenshot({ path: join(out, `mobile-${suffix}.png`) });
  await phone.context().close();
}

// ---------- animated demo ----------

const CURSOR = `
  (() => {
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
      'background:rgba(20,20,20,.55);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);pointer-events:none;' +
      'transition:transform .12s;left:-50px;top:-50px';
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => (c.style.transform = 'scale(.7)'), true);
    addEventListener('mouseup', () => (c.style.transform = ''), true);
    addEventListener('DOMContentLoaded', () => document.body.appendChild(c));
  })();`;

async function recordDemo() {
  const videoDir = join(root, 'docs', '.video');
  rmSync(videoDir, { recursive: true, force: true });
  const page = await newPage({ video: { dir: videoDir, size: { width: 1280, height: 800 } } });
  await page.addInitScript(CURSOR);
  let mouse = { x: 640, y: 400 };
  const moveTo = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const b = await locator.boundingBox();
    const x = b.x + b.width / 2,
      y = b.y + b.height / 2;
    await page.mouse.move(x, y, { steps: Math.max(8, Math.round(Math.hypot(x - mouse.x, y - mouse.y) / 25)) });
    mouse = { x, y };
  };
  const click = async (selectorOrLocator, pause = 250) => {
    const l = typeof selectorOrLocator === 'string' ? page.locator(selectorOrLocator) : selectorOrLocator;
    await moveTo(l);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(pause);
  };
  const type = async (selector, text) => {
    await click(selector, 100);
    await page.keyboard.type(text, { delay: 45 });
  };

  // 1. Make a Venn: the evenings that could work.
  await page.goto(`${base}/new`);
  await page.waitForTimeout(700);
  await click('[data-occasion="0"]', 300);
  await type('#title', 'Dinner at Rosa’s');
  await click('[data-level="parts"]', 500);
  await showDay(page, fri, (sel) => click(sel, 300));
  for (const d of [0, 1, 2]) await click(`#when .pg-cell[data-d="${addDays(fri, d)}"][data-m="${EVENING.start}"]`, 300);
  await page.waitForTimeout(600);
  await type('#organizer', 'Priya');
  // Creating celebrates, then opens the poll with the organizer's own answer already in.
  await click('#submit', 5000);
  await page.waitForSelector('#best'); // the organizer's own answer is one line now, with the group first

  // 2. Others answer (behind the scenes), then pick the winner.
  const id = page.url().split('/e/')[1];
  const ev = await api(`/api/events/${id}`);
  const others = { Marcus: [0, 2, 2], Ana: [2, 1, 2], Jordan: [1, 0, 2], Lee: [2, 2, 2] };
  for (const [name, v] of Object.entries(others)) {
    const availability = Object.fromEntries(ev.slots.map((s, i) => [s, v[i]]).filter(([, x]) => x));
    await api(`/api/events/${id}/participants`, { name, availability });
  }
  await page.reload();
  await page.waitForSelector('#overlap .ov-list');
  await page.waitForTimeout(800);
  // The Venn: everyone's answers, where they overlap. Tap it to see who, then pick it.
  await click(page.locator('#overlap .ov-row.all, #overlap .ov-row.best').first(), 1200);
  await click(page.locator('#overlap [data-pick]').first(), 400);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await page.waitForTimeout(2500);
  await page.context().close();

  const video = join(
    videoDir,
    readdirSync(videoDir).find((f) => f.endsWith('.webm')),
  );
  const gif = join(root, 'docs', 'demo.gif');
  const filters =
    'fps=10,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.3', '-i', video, '-vf', filters, '-loop', '0', gif]);
  rmSync(videoDir, { recursive: true, force: true });
  console.log('wrote docs/demo.gif');
}

try {
  await stills('retro');
  console.log('wrote docs/screenshots/*.png');
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    await recordDemo();
  } catch (e) {
    if (e.code === 'ENOENT') console.log('ffmpeg not found, skipping docs/demo.gif');
    else throw e;
  }
} finally {
  await browser.close();
  server.close();
}
