import { test, expect } from '@playwright/test';

// The home page's Venn: from a noisy chat to the day that works, and friends you can pull apart.

test('the messages find their friends, the circles meet, and Saturday pops out', { tag: '@site' }, async ({ page }) => {
  await page.goto('/');
  const venn = page.locator('.venn');
  await expect(venn.locator('.venn-chip')).toHaveCount(10);
  await expect(venn.locator('.venn-chip').first()).toContainText('Ana');
  await expect(venn).toHaveAttribute('data-settled', 'true', { timeout: 18000 });
  await expect(venn.locator('.venn-hit')).not.toHaveClass(/\boff\b/);
  // Then the messages float out again, faint, with the day still showing.
  await expect
    .poll(
      () =>
        venn
          .locator('.venn-chip')
          .first()
          .evaluate((el) => +getComputedStyle(el).opacity),
      { timeout: 6000 },
    )
    .toBeGreaterThan(0.3);
  await expect(venn.locator('.venn-hit')).not.toHaveClass(/\boff\b/);
});

test('pull a friend away and the day goes; let go and it comes back', { tag: '@site' }, async ({ page, context, isMobile }) => {
  await page.goto('/');
  const venn = page.locator('.venn');
  await venn.scrollIntoViewIfNeeded();
  await expect(venn).toHaveAttribute('data-settled', 'true', { timeout: 18000 });
  const hit = venn.locator('.venn-hit');
  const lee = await venn.locator('.venn-c.c3').boundingBox();
  const [x, y] = [lee.x + lee.width / 2, lee.y + lee.height * 0.75];
  if (isMobile) {
    // Press and hold, then drag (a quick swipe would scroll).
    const cdp = await context.newCDPSession(page);
    const touch = (type, ty) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: ty }] });
    await touch('touchStart', y);
    await page.waitForTimeout(400);
    for (let i = 1; i <= 6; i++) await touch('touchMove', y + i * 25);
    await expect(hit).toHaveClass(/\boff\b/);
    await touch('touchEnd');
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 150, { steps: 6 });
    await expect(hit).toHaveClass(/\boff\b/);
    await page.mouse.up();
  }
  await expect(hit).not.toHaveClass(/\boff\b/);
});

test('with reduced motion, the Venn is still: the circles met, Saturday shown', { tag: '@site' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const venn = page.locator('.venn');
  await expect(venn).toHaveAttribute('data-settled', 'true');
  await expect(venn.locator('.venn-hit')).not.toHaveClass(/\boff\b/);
  await expect(venn.locator('.venn-c.c1')).toHaveCSS('opacity', '1');
});

test('Works with Claude: one quiet line under Create a Venn, to Venn’s page in Claude', { tag: '@site' }, async ({ page }) => {
  await page.goto('/');
  const line = page.locator('.hero .claude-note').getByRole('link', { name: /Works with Claude/ });
  await expect(line).toHaveAttribute('href', 'https://claude.ai/directory/venn');
  await expect(line).toHaveAttribute('target', '_blank');
  await expect(line).toHaveAccessibleName('Works with Claude (opens Venn’s page in Claude, in a new tab)'.replace('’', "'"));
  expect((await line.boundingBox()).height).toBeGreaterThanOrEqual(44);
  // Create a Venn stays the one button: the line is a plain link below it, with no logo.
  const start = await page.locator('.hero .btn-start').boundingBox();
  expect((await line.boundingBox()).y).toBeGreaterThan(start.y + start.height);
  await expect(page.locator('.hero .claude-note img, .hero .claude-note svg')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
