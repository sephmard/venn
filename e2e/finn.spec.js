import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';

// Finn, the Venn dog: a note at a few moments on the poll page, once per poll, and stickers to share.

const t = (d) => Date.UTC(2030, 0, d, 18);
const options = [8, 9, 10].map((d) => ({ start: t(d), end: t(d) + 7_200_000 }));
const LINES = {
  waiting: /Finn is waiting by the door|Finn is keeping an ear out|Finn is guarding the poll/,
  first: /first answer is in|Someone answered|One answer in/,
  everyone: /Finn found a date that works for everyone|Finn sniffed it out|Finn is doing a little spin/,
  picked: /party hat on|marked the calendar with a paw|counting the sleeps/,
  match: /Finn knew you’d be there|Finn saved you a seat|Finn approves/,
  lost: /sniff out this poll|under the sofa|end of it/,
};

async function poll(request, extra = {}) {
  const res = await request.post('/api/events', {
    data: { title: 'Dinner at Rosa’s', emoji: '🍝', timezone: 'UTC', mode: 'options', options, ...extra },
  });
  return res.json();
}
const answer = async (request, id, name, availability) =>
  (await request.post(`/api/events/${id}/participants`, { data: { name, availability } })).json();

async function noSeriousA11yProblems(page, label) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    label,
  ).toEqual([]);
}

test('Finn waits for the first answer, cheers it, and finds a date for everyone, each once', async ({ page, request }) => {
  const { id, adminToken } = await poll(request);
  await page.goto(`/e/${id}#admin=${adminToken}`);
  const finn = page.locator('.finn');
  await expect(finn).toHaveAttribute('data-finn', 'waiting');
  await expect(finn.getByRole('status')).toHaveText(LINES.waiting);
  // The picture is decorative; the words carry it.
  await expect(finn.locator('img')).toHaveAttribute('alt', '');
  await expect(finn.locator('.finn-fig')).toHaveAttribute('aria-hidden', 'true');
  const close = finn.getByRole('button', { name: "Close Finn's note" });
  const box = await close.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);

  // Seen once: not again on this poll.
  await page.reload();
  await expect(page.locator('#ev-title')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(finn).toHaveCount(0);

  // The first guest answers.
  await answer(request, id, 'Ana', { [t(9)]: 2 });
  await page.reload();
  await expect(finn).toHaveAttribute('data-finn', 'first');
  await expect(finn.getByRole('status')).toHaveText(LINES.first);
  // Closed, it stays closed while the page refreshes.
  await close.click();
  await expect(finn).toHaveCount(0);

  // Everyone can make the 9th.
  await answer(request, id, 'Jo', { [t(9)]: 2 });
  await answer(request, id, 'Lee', { [t(9)]: 1, [t(8)]: 2 });
  await page.reload();
  await expect(finn).toHaveAttribute('data-finn', 'everyone');
  await expect(finn.getByRole('status')).toHaveText(LINES.everyone);
  await noSeriousA11yProblems(page, 'Finn note');
});

test('a picked date: Finn for the organizer, a match for a guest who said yes, and stickers to share', async ({
  page,
  browser,
  request,
}) => {
  const { id, adminToken } = await poll(request);
  const ana = await answer(request, id, 'Ana', { [t(9)]: 2 });
  await answer(request, id, 'Jo', { [t(8)]: 2 });
  await request.post(`/api/events/${id}/finalize`, { data: { start: t(9) }, headers: { 'x-admin-token': adminToken } });

  await page.goto(`/e/${id}#admin=${adminToken}`);
  await expect(page.locator('.finn')).toHaveAttribute('data-finn', 'picked');
  await expect(page.locator('.finn [role=status]')).toHaveText(LINES.picked);

  // Ana said yes to the date.
  const guest = await browser.newContext();
  const g = await guest.newPage();
  await g.goto(`/e/${id}#edit=${ana.id}.${ana.editToken}`);
  await expect(g.locator('.finn')).toHaveAttribute('data-finn', 'match');
  await expect(g.locator('.finn [role=status]')).toHaveText(LINES.match);
  await guest.close();

  // Stickers, from the "It's set" banner.
  const open = page.locator('.final-more').getByRole('button', { name: 'Finn stickers' });
  await expect(open).toBeVisible();
  expect((await open.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await open.click();
  const sheet = page.getByRole('dialog', { name: 'Finn stickers' });
  await expect(sheet).toBeVisible();
  const stickers = sheet.getByRole('button', { name: /sticker$/ });
  await expect(stickers).toHaveCount(6);
  await expect(sheet.locator('[aria-busy]')).toHaveCount(0);
  // Each is a see-through 512×512 picture with a white edge.
  const pixels = await sheet
    .locator('img')
    .first()
    .evaluate((img) => {
      const c = Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
      let edge = null;
      // Walk in from the left at the caption's height until the first solid pixel: the white edge.
      for (let x = 0; x < 256 && !edge; x++) if (at(x, 418)[3] === 255) edge = at(x + 2, 418);
      return { size: [img.naturalWidth, img.naturalHeight], corner: at(0, 0), edge };
    });
  expect(pixels.size).toEqual([512, 512]);
  expect(pixels.corner[3]).toBe(0);
  expect(pixels.edge.slice(0, 3)).toEqual([255, 255, 255]);
  await noSeriousA11yProblems(page, 'sticker sheet');

  // Saving one downloads the PNG.
  const first = stickers.first();
  await expect(first).toHaveAccessibleName(/^(Save|Share) the “It’s set!” sticker$/);
  const [download] = await Promise.all([page.waitForEvent('download'), first.click()]);
  expect(download.suggestedFilename()).toBe('finn-its-set.png');
  const png = readFileSync(await download.path());
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512]);
  expect(png[25]).toBe(6); // RGBA: see-through
  await expect(page.locator('#toast')).toContainText('Sticker saved');

  // Escape closes it, and focus goes back to the button.
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('Finn turns up when a poll or page is not found', async ({ page }) => {
  await page.goto('/e/doesnotexist');
  await expect(page.getByRole('heading', { name: 'Poll not found' })).toBeVisible();
  await expect(page.locator('.finn-lost-line')).toHaveText(LINES.lost);
  await expect(page.locator('.finn-lost img')).toHaveAttribute('alt', '');
  await page.goto('/no-such-page');
  await expect(page.locator('main')).toContainText('Finn couldn’t sniff out this page.');
  await page.goto('/');
  await expect(page.locator('.meet-finn')).toContainText('Meet Finn, the Venn dog.');
});

test('with reduced motion, Finn still shows, without moving', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { id, adminToken } = await poll(request);
  await page.goto(`/e/${id}#admin=${adminToken}`);
  await expect(page.locator('.finn [role=status]')).toHaveText(LINES.waiting);
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.finn')).length)).toBe(0);
  // No sideways scrolling on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
