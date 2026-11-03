// Answering feels finished and is quick by keyboard: arrow keys move between Yes, If needed and No
// (one tab stop a row), a changed answer says "Answer updated." without a second party, and the
// people in everyone's answers are full-size tap targets.

import { test, expect } from '@playwright/test';
import { submit } from './helpers.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

const poll = async (request) => {
  const dates = ['2030-03-01', '2030-03-02', '2030-03-03'];
  const ev = await (
    await request.post('/api/events', {
      data: { title: 'Lunch', timezone: 'UTC', dates, startMinute: 0, endMinute: 1440, slotMinutes: 1440, durationMinutes: 1440 },
    })
  ).json();
  return ev;
};

test('Yes, If needed and No: one tab stop a row, arrow keys choose', async ({ page, request }) => {
  const { id } = await poll(request);
  await page.goto(`/e/${id}`);
  const row = page.locator('#mine .row').first();
  const vote = (v) => row.locator(`[data-vote="${v}"]`);
  // Nothing chosen yet: Yes is the row's one tab stop.
  await expect(vote(2)).toHaveAttribute('tabindex', '0');
  await expect(vote(1)).toHaveAttribute('tabindex', '-1');
  await expect(vote(0)).toHaveAttribute('tabindex', '-1');
  await vote(2).focus();
  await page.keyboard.press('ArrowRight');
  await expect(vote(1)).toBeFocused();
  await expect(vote(1)).toHaveAttribute('aria-checked', 'true');
  await expect(vote(1)).toHaveAttribute('tabindex', '0');
  await expect(vote(2)).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('ArrowRight');
  await expect(vote(0)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight'); // round to the start
  await expect(vote(2)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(vote(0)).toBeFocused();
  // Tab goes on to the next row's one stop, not to this row's other buttons.
  await page.keyboard.press('Tab');
  await expect(page.locator('#mine .row').nth(1).locator('[data-vote="2"]')).toBeFocused();
});

test('Days, Parts of day and Hours: arrow keys move between them', async ({ page }) => {
  await page.goto('/new/free');
  const level = (k) => page.locator(`[data-level="${k}"]`);
  await expect(level('days')).toHaveAttribute('tabindex', '0');
  await expect(level('hours')).toHaveAttribute('tabindex', '-1');
  await level('days').focus();
  await page.keyboard.press('ArrowRight');
  await expect(level('parts')).toHaveAttribute('aria-checked', 'true');
  await expect(level('parts')).toBeFocused();
  await expect(level('parts')).toHaveAttribute('tabindex', '0');
});

test('a changed answer says so quietly, and the button says Update answer', async ({ page, request }) => {
  const { id } = await poll(request);
  await page.goto(`/e/${id}`);
  await expect(page.locator('#save')).toHaveText('Submit');
  await page.locator('#mine .row').first().locator('[data-vote="2"]').click();
  await page.fill('#name', 'Ana');
  await submit(page); // the first answer: the party
  await expect(page.locator('#save')).toHaveText('Update answer');
  if (await page.locator('#tab-mine').isVisible()) await page.click('#tab-mine');
  await page.locator('#mine .row').nth(1).locator('[data-vote="1"]').click();
  await page.click('#save');
  if (await page.locator('#submit-check[open] #sc-yes').isVisible()) await page.click('#sc-yes');
  await expect(page.locator('#toast')).toHaveText('Answer updated.');
  await expect(page.locator('.party')).toHaveCount(0);
});

test('people in everyone’s answers are 44px tap targets', async ({ page, request }) => {
  const { id } = await poll(request);
  const { slots } = await (await request.get(`/api/events/${id}`)).json();
  await request.post(`/api/events/${id}/participants`, { data: { name: 'Ana', availability: { [slots[0]]: 2 } } });
  await page.goto(`/e/${id}`);
  await expect(page.locator('#mine .row')).toHaveCount(3);
  if (await page.locator('#tab-group').isVisible()) await page.click('#tab-group');
  const person = page.locator('#people .person-btn').first();
  await expect(person).toBeVisible();
  const box = await person.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});
