// The celebration never covers its words or buttons: confetti flies around Finn and passes behind
// the plate that holds them, at every moment of the animation.
import { test, expect } from '@playwright/test';
import { addOptions } from './helpers.js';

/** At three moments of the party, nothing is drawn over the heading, the message or a button. */
async function wordsStayClear(page) {
  // Confetti doesn't take taps (pointer-events: none); for the check, it does, so elementFromPoint
  // finds whatever is drawn on top.
  await page.addStyleTag({ content: '.party-bit,.party-ring{pointer-events:auto!important}' });
  for (const at of [900, 1500, 2500]) {
    await page.waitForTimeout(at - (at === 900 ? 0 : at === 1500 ? 900 : 1500));
    const covered = await page.evaluate(() => {
      const els = document.querySelectorAll('.party h2, .party p, .party-words button:not([hidden]), .party-also');
      const bad = [];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        for (const [fx, fy] of [
          [0.5, 0.5],
          [0.1, 0.2],
          [0.9, 0.2],
          [0.1, 0.8],
          [0.9, 0.8],
        ]) {
          const x = r.left + r.width * fx;
          const y = r.top + r.height * fy;
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
          const hit = document.elementFromPoint(x, y);
          if (hit && !el.contains(hit)) bad.push(`${el.tagName}.${el.className} under ${hit.className}`);
        }
      }
      return bad;
    });
    expect(covered, `${at}ms`).toEqual([]);
  }
}

test('a guest’s celebration: confetti never covers the words or buttons', async ({ page, request }) => {
  const t0 = Date.UTC(2030, 0, 8, 18);
  const { id } = await (
    await request.post('/api/events', {
      data: {
        title: 'Dinner',
        organizer: 'Sam',
        timezone: 'UTC',
        mode: 'options',
        options: [{ start: t0, end: t0 + 7_200_000 }],
      },
    })
  ).json();
  await page.goto(`/e/${id}`);
  await page.locator('#mine .row [data-vote="2"]').first().click();
  await page.fill('#name', 'Ana');
  await page.click('#save');
  await expect(page.locator('.party .party-words')).toBeVisible();
  await wordsStayClear(page);
});

test('a new poll’s celebration: confetti never covers the words or buttons', async ({ page }) => {
  await page.goto('/new/pick');
  await page.fill('#title', 'Dinner');
  await page.fill('#organizer', 'Sam');
  await addOptions(page, 1);
  await page.click('#submit');
  await expect(page.locator('.party .party-words')).toBeVisible();
  await wordsStayClear(page);
});
