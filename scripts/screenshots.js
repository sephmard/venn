// Regenerates the README images: `npm run screenshots`.
// Needs Playwright's Chromium (`npx playwright install chromium`). The demo GIF also needs ffmpeg.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createApp } from '../server.js';
import { zonedToUtc, addDays, weekdayOf } from '../public/core.js';

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

// The Tuesday at least a week from today, so the demo always looks upcoming.
function nextTuesday() {
  let d = new Date().toISOString().slice(0, 10);
  d = addDays(d, 7);
  while (weekdayOf(d) !== 2) d = addDays(d, 1);
  return d;
}

const HOUR = 3_600_000;
const tue = nextTuesday();
const at = (dayOffset, h, m = 0) => zonedToUtc(addDays(tue, dayOffset), h * 60 + m, TZ);
const OPTIONS = [at(0, 10), at(0, 14), at(1, 9, 30), at(1, 15), at(2, 11)].map((start) => ({ start, end: start + HOUR }));

// Votes per option: 2 = yes, 1 = if needed, 0 = no.
const PEOPLE = {
  Priya: [2, 0, 2, 2, 1],
  Marcus: [0, 2, 1, 2, 2],
  Ana: [2, 2, 0, 2, 0],
  Jordan: [1, 0, 2, 1, 2],
  Lee: [2, 1, 0, 2, 2],
};
const SAM = [2, 0, 1, 2, 0];

const toAvailability = (votes) => Object.fromEntries(OPTIONS.map((o, i) => [o.start, votes[i]]).filter(([, v]) => v));

async function seedPoll() {
  const { id, adminToken } = await api('/api/events', {
    title: 'Design review',
    description: 'Walk through the new onboarding flow. Video link to follow.',
    organizer: 'Priya',
    timezone: TZ,
    mode: 'options',
    options: OPTIONS,
  });
  for (const [name, votes] of Object.entries(PEOPLE))
    await api(`/api/events/${id}/participants`, { name, availability: toAvailability(votes) });
  return { id, adminToken };
}

const HIDE_TOAST = '#toast { display: none !important; }';

// Screenshot from the top of `from` (default: the page, so the header shows) to the bottom of `selector`.
async function shoot(page, selector, path, { from, pad = 24 } = {}) {
  const pageY = (sel, edge) => page.locator(sel).evaluate((el, e) => el.getBoundingClientRect()[e] + window.scrollY, edge);
  const top = from ? Math.max(0, (await pageY(from, 'top')) - pad) : 0;
  const bottom = (await pageY(selector, 'bottom')) + pad;
  await page.screenshot({ path, fullPage: true, clip: { x: 0, y: top, width: page.viewportSize().width, height: bottom - top } });
}

// Show a neutral address instead of the random local port.
const tidyShareLink = (page) =>
  page.evaluate(() => {
    const input = document.querySelector('.share input');
    if (input) input.value = input.value.replace(/^http:\/\/localhost:\d+/, 'https://venn.example.com');
  });
const browser = await chromium.launch();

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
  await page.waitForSelector('.opt');
  for (const [i, v] of SAM.entries()) await page.locator('.opt').nth(i).locator(`[data-vote="${v}"]`).click();
  await page.fill('#name', 'Sam');
  await page.click('#save');
  await page.waitForSelector('.matrix');
}

async function stills(dark) {
  const suffix = dark ? 'dark' : 'light';
  const { id } = await seedPoll();

  const desktop = await newPage({ dark });
  await answerAsSam(desktop, id);
  await desktop.addStyleTag({ content: HIDE_TOAST });
  await tidyShareLink(desktop);
  await shoot(desktop, '#event-root', join(out, `results-${suffix}.png`));

  await desktop.goto(`${base}/new`);
  await desktop.addStyleTag({ content: HIDE_TOAST });
  await desktop.fill('#title', 'Design review');
  await desktop.fill('#organizer', 'Priya');
  await desktop.click('#weekdays');
  const extra = (await desktop.locator('.cal-day.selected').evaluateAll((els) => els.map((e) => e.dataset.date))).slice(3);
  for (const d of extra) await desktop.click(`[data-date="${d}"]`); // keep 3 days
  const day = await desktop.locator('[data-add]').first().getAttribute('data-add');
  await desktop.click(`[data-add="${day}"]`);
  await desktop.selectOption(`[data-time="${day}"]`, String(14 * 60));
  await desktop.click(`[data-add="${day}"]`);
  await desktop.click(`[data-copy="${day}"]`);
  await desktop.locator('.day-times').nth(2).locator('[data-del]').first().click();
  await desktop.locator('#title').blur();
  await shoot(desktop, '#create', join(out, `create-${suffix}.png`), { from: '#create' });
  await desktop.context().close();

  const phone = await newPage({ dark, mobile: true });
  await phone.goto(`${base}/e/${id}`);
  await phone.waitForSelector('.opt');
  for (const [i, v] of [2, 1, 0].entries()) await phone.locator('.opt').nth(i).locator(`[data-vote="${v}"]`).tap();
  await phone.fill('#name', 'Jamie');
  await phone.locator('#name').blur();
  await phone.evaluate(() =>
    window.scrollTo(0, document.querySelector('#mine-h').getBoundingClientRect().top + window.scrollY - 16),
  );
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

  // 1. Create a poll.
  await page.goto(`${base}/new`);
  await page.waitForTimeout(600);
  await type('#title', 'Design review');
  await type('#organizer', 'Priya');
  await click('#weekdays', 500);
  const day = await page.locator('[data-add]').first().getAttribute('data-add');
  await click(`[data-add="${day}"]`);
  await page.selectOption(`[data-time="${day}"]`, String(14 * 60));
  await click(`[data-add="${day}"]`);
  await click(`[data-copy="${day}"]`, 700);
  await click('#submit', 1200);

  // 2. Answer.
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  const votes = [2, 0, 1, 2, 2, 0, 2, 1, 0, 2];
  for (const [i, v] of votes.entries()) await click(page.locator('.opt').nth(i).locator(`[data-vote="${v}"]`), 120);
  await type('#name', 'Priya');
  await click('#save', 900);

  // 3. Others respond (behind the scenes), then pick the winner.
  const id = page.url().split('/e/')[1];
  const ev = await api(`/api/events/${id}`);
  const others = { Marcus: [0, 2, 2, 2, 1], Ana: [2, 1, 0, 2, 2], Jordan: [1, 0, 2, 2, 0], Lee: [2, 2, 0, 2, 1] };
  for (const [name, v] of Object.entries(others)) {
    const availability = Object.fromEntries(
      ev.slots
        .slice(0, 5)
        .map((s, i) => [s, v[i]])
        .filter(([, x]) => x),
    );
    await api(`/api/events/${id}/participants`, { name, availability });
  }
  await page.reload();
  await page.waitForSelector('.matrix');
  await page.evaluate(() =>
    window.scrollTo({ top: document.querySelector('#best-h').getBoundingClientRect().top + scrollY - 80, behavior: 'smooth' }),
  );
  await page.waitForTimeout(1500);
  await click(page.locator('.best [data-pick]').first(), 400);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await page.waitForTimeout(2200);
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
  await stills(false);
  await stills(true);
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
