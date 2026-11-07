import { test, expect } from '@playwright/test';
import { ACCOUNTS_URL } from '../playwright.config.js';

// The template builder on wide screens (Ivy's spec, Seph 2026-11-04: "looks rough in desktop"): a
// step column wide enough for the whole template link with Copy beside it, Back/Save/Next in one
// row under the card, and the step's "1 of 10" only for screen readers beside the steps list. On a
// phone (the mobile project) none of this applies, and the phone layout stays as it was.
test.use({ baseURL: ACCOUNTS_URL });

async function template(page, who) {
  await page.context().setExtraHTTPHeaders({ 'x-test-user': who });
  await page.goto('/me');
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.locator('.acct-who')).toBeVisible();
  const res = await page.request.post('/api/brands', { data: { name: 'Tarheel Trailblazers', accent: '#8a2b0e' } });
  return (await res.json()).id;
}

const box = (page, sel) =>
  page
    .locator(sel)
    .first()
    .evaluate((el) => el.getBoundingClientRect().toJSON());

for (const width of [1200, 1440]) {
  test(`builder at ${width}: the template link fits beside Copy, and the bar sits under the card`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'wide screens only');
    await page.setViewportSize({ width, height: 900 });
    const id = await template(page, `wide-${width}-${Date.now()}`);
    await page.goto(`/brand/${id}#organizer`); // as My polls opens it
    const share = page.locator('[data-panel="share"]');
    await expect(share).toBeVisible();

    expect((await box(page, '.step-panels')).width).toBeGreaterThanOrEqual(520);
    const input = page.locator('.brand-links .link-row input').first();
    await expect(input).toHaveValue(/\/new\?brand=/);
    expect(await input.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const copy = page.getByRole('button', { name: 'Copy template link' });
    // It reads "Copy" (the label above says which link); its name stays "Copy template link".
    await expect(copy.locator('.copy-short')).toBeVisible();
    expect((await copy.locator('.copy-what').boundingBox()).width).toBeLessThanOrEqual(1);
    const [i, c] = [await input.boundingBox(), await copy.boundingBox()];
    expect(Math.abs(i.y - c.y)).toBeLessThan(2);
    expect(c.x).toBeGreaterThan(i.x + i.width);
    await expect(share.locator('.link-label').first()).toHaveText('Template link');

    // "1 of 10" is for screen readers: the steps list shows the step.
    await expect(share.getByRole('heading', { name: '1 of 10 Share' })).toBeVisible();
    expect((await box(page, '[data-panel="share"] .step-of')).width).toBeLessThanOrEqual(1);
    await expect(page.locator('.steps [data-step="share"]')).toHaveAttribute('aria-current', 'step');

    // Back, Save and Next: one row, right under the card, Next at the column's right edge.
    await page.locator('.steps [data-step="colours"]').click();
    await page.locator('#b-accent').fill('#225588');
    await page.locator('#b-accent').dispatchEvent('input');
    const card = await box(page, '[data-panel="colours"]');
    const [back, save, next] = [await box(page, '#back'), await box(page, '#submit'), await box(page, '#next')];
    expect(back.top - card.bottom).toBeGreaterThanOrEqual(12);
    expect(back.top - card.bottom).toBeLessThanOrEqual(20);
    expect(Math.abs(save.top - back.top)).toBeLessThan(2);
    expect(Math.abs(next.top - back.top)).toBeLessThan(2);
    expect(Math.abs(next.right - card.right)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
}

test('builder at 960: the step menu at the top of the step column, links stacked, no sideways scroll', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'wide screens only');
  await page.setViewportSize({ width: 960, height: 900 });
  const id = await template(page, `mid-${Date.now()}`);
  await page.goto(`/brand/${id}#organizer`); // as My polls opens it
  await expect(page.locator('[data-panel="share"]')).toBeVisible();
  await expect(page.locator('.steps')).toBeHidden();
  const menu = page.locator('.step-panels > #step-menu');
  await expect(menu.locator('summary')).toHaveText(/1 of 10 ·\s*Share/);
  // It opens downwards, and goes to a step.
  await menu.locator('summary').click();
  await menu.locator('[data-step="colours"]').click();
  await expect(page.locator('[data-panel="colours"]')).toBeVisible();
  await expect(menu.locator('summary')).toHaveText(/4 of 10 ·\s*Colours/);
  await menu.locator('summary').click();
  await menu.locator('[data-step="share"]').click();
  // Too narrow for Copy beside the link: under it, full width, with its whole name.
  const [i, c] = [
    await page.locator('.brand-links .link-row input').first().boundingBox(),
    await page.getByRole('button', { name: 'Copy template link' }).boundingBox(),
  ];
  expect(c.y).toBeGreaterThan(i.y + i.height);
  await expect(page.locator('.brand-links .copy-short').first()).toBeHidden();
  expect((await page.locator('.brand-links .copy-what').first().boundingBox()).width).toBeGreaterThan(100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  // Narrowed to a phone, the menu goes back to the bar.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.locator('.step-bar > #step-menu summary')).toHaveText(/1\/10\s*Share/);
});

test('builder: the keyboard goes steps, the step, Back, Save, Next, then the preview', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'wide screens only');
  await page.setViewportSize({ width: 1200, height: 900 });
  const id = await template(page, `keys-${Date.now()}`);
  await page.goto(`/brand/${id}#organizer`);
  await expect(page.locator('[data-panel="share"]')).toBeVisible();
  const sorted = await page.evaluate(
    (sels) => {
      const els = sels.map((s) => document.querySelector(s));
      return els.every((el, i) => i === 0 || els[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    },
    ['.steps', '.step-panels', '#back', '#submit', '#next', '.brand-editor > .preview-box'],
  );
  expect(sorted).toBe(true);
  // The preview still sits beside the step, at the top.
  const [pv, panels] = [
    await page.locator('.brand-editor > .preview-box').boundingBox(),
    await page.locator('.step-panels').boundingBox(),
  ];
  expect(pv.x).toBeGreaterThan(panels.x + panels.width);
});
