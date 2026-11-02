import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { submit, openTools } from './helpers.js';

// "Are you sure?" is asked in the page (public/ask.js), never in a browser pop-up: in-app browsers
// can block those, and they look like another product.

async function poll(request) {
  const t0 = Date.UTC(2030, 0, 8, 18);
  const options = [0, 1].map((i) => ({ start: t0 + i * 86_400_000, end: t0 + i * 86_400_000 + 7_200_000 }));
  const { id, adminToken } = await (
    await request.post('/api/events', { data: { title: 'Dinner', organizer: 'Sam', timezone: 'UTC', mode: 'options', options } })
  ).json();
  await request.post(`/api/events/${id}/participants`, { data: { name: 'Ana', availability: { [t0]: 2 } } });
  return { id, adminToken };
}
const names = async (request, id) => (await (await request.get(`/api/events/${id}`)).json()).participants.map((p) => p.name);

test.beforeEach(({ page }) => {
  page.on('dialog', () => {
    throw new Error('No browser pop-up expected');
  });
});

test('a guest removes their own answer, asked in the page', async ({ page, request }) => {
  const { id } = await poll(request);
  await page.goto(`/e/${id}`);
  await page.locator('#mine .row').first().locator('[data-vote="2"]').click();
  await page.locator('#mine .row').nth(1).locator('[data-vote="0"]').click();
  await page.fill('#name', 'Ben');
  await submit(page);
  expect(await names(request, id)).toEqual(['Ana', 'Ben']);
  if (await page.locator('#tab-mine').isVisible()) await page.click('#tab-mine'); // tabs on phones only
  await page.click('#leave');
  const ask = page.getByRole('dialog', { name: 'Remove your answer from this poll?' });
  await expect(ask.getByRole('button', { name: 'Cancel' })).toBeFocused(); // the safe way out first
  await ask.getByRole('button', { name: 'Remove' }).click();
  await expect(ask).toHaveCount(0);
  await expect.poll(() => names(request, id)).toEqual(['Ana']);
});

test("the organizer removes someone's answer, asked in the page", async ({ page, request }) => {
  const { id, adminToken } = await poll(request);
  await page.goto(`/e/${id}#admin=${adminToken}`);
  await page.locator('#people .person-btn', { hasText: 'Ana' }).click();
  await page.getByRole('button', { name: "Remove Ana's answer" }).click();
  await page.getByRole('dialog', { name: "Remove Ana's answer?" }).getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => names(request, id)).toEqual([]);
});

test('Delete poll asks in the page: Cancel and Escape keep it, Delete poll deletes it', async ({ page, request }) => {
  const { id, adminToken } = await poll(request);
  await page.goto(`/e/${id}#admin=${adminToken}`);
  await openTools(page);
  const del = page.locator('#delete-poll');
  const ask = page.getByRole('dialog', { name: 'Delete this poll?' });
  await del.click();
  await expect(ask).toContainText("Everyone's answers go with it. This can't be undone.");
  const results = await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toHaveCount(0);
  await expect(del).toBeFocused();
  await del.click();
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  expect((await request.get(`/api/events/${id}`)).status()).toBe(200);
  await del.click();
  await ask.getByRole('button', { name: 'Delete poll' }).click();
  await expect(page).toHaveURL(/\/new$/);
  expect((await request.get(`/api/events/${id}`)).status()).toBe(404);
});
