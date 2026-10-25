import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => {
    throw e;
  });
});

async function startPoll(page, title) {
  await page.goto('/');
  await page.fill('#title', title);
  await page.fill('#organizer', 'Sam');
  await page.click('#weekdays');
}

test('propose specific times, collect votes, pick the final time', async ({ page, request }) => {
  await startPoll(page, 'Project kickoff');
  await expect(page.locator('[data-mode="options"]')).toHaveAttribute('aria-checked', 'true');

  const firstDay = await page.locator('[data-add]').first().getAttribute('data-add');
  await page.click(`[data-add="${firstDay}"]`); // suggested 9:00
  await page.click(`[data-add="${firstDay}"]`); // suggested 10:00
  await page.click(`[data-copy="${firstDay}"]`);
  await expect(page.locator('#summary')).toHaveText('10 times proposed');

  await page.click('#submit');
  await expect(page.locator('.opt')).toHaveCount(10);
  await expect(page.locator('.banner-admin')).toBeVisible();

  // Organizer answers: yes to the first two, no to the third.
  await page.locator('.opt').nth(0).locator('[data-vote="2"]').click();
  await page.locator('.opt').nth(1).locator('[data-vote="2"]').click();
  await page.locator('.opt').nth(2).locator('[data-vote="0"]').click();
  await expect(page.locator('.opt').nth(2)).toHaveAttribute('data-v', '0');
  await page.fill('#name', 'Sam');
  await page.click('#save');
  await expect(page.locator('#save-state')).toHaveText('Saved');

  // A second person answers through the API: only the second time works for them.
  const id = page.url().split('/e/')[1];
  const ev = await (await request.get(`/api/events/${id}`)).json();
  await request.post(`/api/events/${id}/participants`, {
    data: { name: 'Lee', availability: { [ev.slots[0]]: 1, [ev.slots[1]]: 2 } },
  });

  await page.reload();
  await expect(page.locator('.matrix tbody tr')).toHaveCount(2);
  const best = page.locator('.best li').first();
  await expect(best).toContainText('Everyone can make it');
  await expect(best).toContainText('2/2');

  await best.locator('[data-pick]').click();
  await expect(page.locator('.banner-final')).toBeVisible();
  await expect(page.locator('.banner-final a', { hasText: 'Google Calendar' })).toHaveAttribute('href', /calendar\.google\.com/);
  const ics = await request.get(`/api/events/${id}/event.ics`);
  expect(await ics.text()).toContain('SUMMARY:Project kickoff');
});

test('open time range: paint availability and see the best time', async ({ page, isMobile }) => {
  await startPoll(page, 'Book club');
  await page.click('[data-mode="grid"]');
  await expect(page.locator('#start')).toBeVisible();
  await page.click('#submit');
  await expect(page.locator('#mine .cell[data-slot]').first()).toBeVisible();

  const cell = (r, c) => page.locator(`#mine .cell[data-r="${r}"][data-c="${c}"]`);
  if (isMobile) {
    for (const r of [2, 3]) await cell(r, 0).tap();
  } else {
    const a = await cell(2, 0).boundingBox();
    const b = await cell(3, 1).boundingBox();
    await page.mouse.move(a.x + 5, a.y + 5);
    await page.mouse.down();
    await page.mouse.move(b.x + 5, b.y + 5, { steps: 4 });
    await page.mouse.up();
  }
  await expect(page.locator('#mine .cell.yes')).toHaveCount(isMobile ? 2 : 4);

  await page.fill('#name', 'Sam');
  await page.click('#save');
  await expect(page.locator('.best li').first()).toContainText('1/1');
});

test('page never scrolls sideways', async ({ page }) => {
  await startPoll(page, 'Width check');
  const day = await page.locator('[data-add]').first().getAttribute('data-add');
  for (let i = 0; i < 4; i++) await page.click(`[data-add="${day}"]`);
  await page.click(`[data-copy="${day}"]`);
  await page.click('#submit');
  await page.click('#fill');
  await page.fill('#name', 'Sam');
  await page.click('#save');
  await expect(page.locator('.matrix')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('unknown poll shows a friendly error', async ({ page }) => {
  await page.goto('/e/doesnotexist');
  await expect(page.getByRole('heading', { name: 'Poll not found' })).toBeVisible();
});
