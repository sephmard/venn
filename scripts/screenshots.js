// Regenerates the README images (docs/screenshots/*.png, docs/demo.gif): `npm run screenshots`.
// Needs Playwright's Chromium (`npx playwright install chromium`) and ffmpeg (for the GIF).

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

// The Friday at least a week from today, so the demo always looks upcoming.
function nextFriday() {
  let d = addDays(new Date().toISOString().slice(0, 10), 7);
  while (weekdayOf(d) !== 5) d = addDays(d, 1);
  return d;
}

const HOUR = 3_600_000;
const fri = nextFriday();
const at = (dayOffset, h, m = 0) => zonedToUtc(addDays(fri, dayOffset), h * 60 + m, TZ);
// Dinner: Friday and Saturday evenings this week and next.
const OPTIONS = [at(0, 19), at(1, 19), at(1, 19, 30), at(7, 19), at(8, 19, 30)].map((start) => ({
  start,
  end: start + 2.5 * HOUR,
}));

// Votes per option: 2 = yes, 1 = if needed, 0 = no.
const PEOPLE = {
  'Priya Shah': [2, 0, 2, 2, 1],
  'Marcus Lee': [0, 2, 1, 2, 2],
  'Ana Silva': [2, 2, 0, 2, 0],
  'Jordan Kim': [1, 0, 2, 1, 2],
  'Lee Wong': [2, 1, 0, 2, 2],
};
const SAM = [2, 0, 1, 2, 0];

const toAvailability = (votes) => Object.fromEntries(OPTIONS.map((o, i) => [o.start, votes[i]]).filter(([, v]) => v));

async function seedPoll() {
  const { id, adminToken } = await api('/api/events', {
    title: 'Dinner at Finn’s',
    emoji: '🍝',
    location: 'Finn’s Trattoria, 14 Elm St',
    description: 'Long table in the back. Bring an appetite.',
    organizer: 'Priya Shah',
    timezone: TZ,
    mode: 'options',
    options: OPTIONS,
  });
  for (const [name, votes] of Object.entries(PEOPLE))
    await api(`/api/events/${id}/participants`, { name, availability: toAvailability(votes) });
  return { id, adminToken };
}

const HIDE_TOAST = '#toast { display: none !important; }';

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
  await page.waitForSelector('#mine .row');
  for (const [i, v] of SAM.entries()) await page.locator('#mine .row').nth(i).locator(`[data-vote="${v}"]`).click();
  await page.fill('#name', 'Sam');
  await page.click('#save');
  await page.waitForSelector('.matrix');
  await page.evaluate(() => scrollTo(0, 0));
}

async function stills(dark) {
  const suffix = dark ? 'dark' : 'light';
  const { id } = await seedPoll();

  const desktop = await newPage({ dark });
  await answerAsSam(desktop, id);
  await desktop.addStyleTag({ content: HIDE_TOAST });
  await shoot(desktop, '#panel-group', join(out, `results-${suffix}.png`), { crop: '#event-root' });

  await desktop.goto(`${base}/new/pick`);
  await desktop.addStyleTag({ content: HIDE_TOAST });
  await desktop.click('[data-occasion="0"]');
  await desktop.fill('#title', 'Dinner at Finn’s');
  await desktop.fill('#location', 'Finn’s Trattoria, 14 Elm St');
  // Add 7 and 7:30 PM on two Fridays and Saturdays from the month view, then show them on the week.
  await desktop.click('[data-view="month"]');
  for (const d of [0, 1, 7, 8]) {
    const date = addDays(fri, d);
    if (!(await desktop.locator(`.month-cal [data-date="${date}"]`).count())) await desktop.click('.month-cal [data-nav="1"]');
    await desktop.click(`.month-cal [data-date="${date}"]`);
    for (const t of ['19:00', '19:30']) {
      await desktop.fill('#exact', t);
      await desktop.click('#add-exact');
    }
  }
  await desktop.click('[data-view="week"]');
  while (!(await desktop.locator(`.tg-col[data-date="${fri}"]`).count())) await desktop.click('.tv-nav [data-step="1"]');
  await desktop.locator('#title').blur();
  await desktop.addStyleTag({ content: '.create-bar { position: static; }' });
  await shoot(desktop, '.sheet:has(#when-h)', join(out, `create-${suffix}.png`), {
    from: '.sheet:has(#when-h)',
    crop: '#create',
  });
  await desktop.context().close();

  const phone = await newPage({ dark, mobile: true });
  await phone.goto(`${base}/e/${id}`);
  await phone.waitForSelector('#mine .row');
  for (const [i, v] of [2, 1, 0].entries()) await phone.locator('#mine .row').nth(i).locator(`[data-vote="${v}"]`).tap();
  await phone.fill('#name', 'Jamie');
  await phone.locator('#name').blur();
  await phone.evaluate(() =>
    window.scrollTo(0, document.querySelector('.tabs').getBoundingClientRect().top + window.scrollY - 12),
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
  await page.waitForTimeout(700);
  await click('a[href="/new/pick"]', 600);
  await click('[data-occasion="0"]', 300);
  await type('#title', 'Dinner at Finn’s');
  await click('[data-view="month"]', 400);
  for (const d of [0, 1, 7, 8]) {
    const date = addDays(fri, d);
    if (!(await page.locator(`.month-cal [data-date="${date}"]`).count())) await click('.month-cal [data-nav="1"]', 300);
    await click(`.month-cal [data-date="${date}"]`, 250);
    await click('[data-part="evening"]', 250);
  }
  await click('[data-view="week"]', 300);
  while (!(await page.locator(`.tg-col[data-date="${fri}"]`).count())) await click('.tv-nav [data-step="1"]', 300);
  await page.waitForTimeout(600);
  await type('#organizer', 'Priya');
  await click('#submit', 1200);

  // 2. Answer.
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  const votes = [2, 1, 2, 0];
  for (const [i, v] of votes.entries()) await click(page.locator('#mine .row').nth(i).locator(`[data-vote="${v}"]`), 120);
  await type('#name', 'Priya');
  await click('#save', 900);

  // 3. Others answer (behind the scenes), then pick the winner.
  const id = page.url().split('/e/')[1];
  const ev = await api(`/api/events/${id}`);
  const others = { Marcus: [0, 2, 2, 1], Ana: [2, 1, 2, 0], Jordan: [1, 0, 2, 2], Lee: [2, 2, 2, 0] };
  for (const [name, v] of Object.entries(others)) {
    const availability = Object.fromEntries(ev.slots.map((s, i) => [s, v[i]]).filter(([, x]) => x));
    await api(`/api/events/${id}/participants`, { name, availability });
  }
  await page.reload();
  await page.waitForSelector('.matrix');
  await page.waitForTimeout(1500);
  await click(page.locator('.best-hero [data-pick]'), 400);
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
