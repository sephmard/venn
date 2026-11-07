// The one Use AI box above Date · Vote (ai-draft.js, src/ask-kind.js): the same place on both
// forms, Venn picks the kind and moves to the other form when it needs to, carrying a brand
// template's link, keeping what was typed, never creating anything, and one request a press.
import { test, expect } from '@playwright/test';

async function ask(page, text) {
  if (await page.locator('#ai-draft').isHidden()) await page.click('#ai-open');
  await page.fill('#ai-prompt', text);
  await page.click('#ai-go');
  await expect(page.locator('#ai-done')).toBeVisible();
}
/** Every request to an AI endpoint, from here on. */
const aiCalls = (page) => {
  const calls = [];
  page.on('request', (r) => /\/api\/ai\/(?!allowance)/.test(r.url()) && calls.push(r.url()));
  return calls;
};

test('the box sits above Date · Vote, in the same place on both forms, and the old buttons are gone', async ({ page }) => {
  const at = async (path) => {
    await page.goto(path);
    const bar = page.getByRole('button', { name: 'Describe it, and Venn sets it up' });
    await expect(bar).toBeVisible();
    const [b, s] = [await bar.boundingBox(), await page.locator('.kind-switch').boundingBox()];
    expect(b.y + b.height).toBeLessThanOrEqual(s.y);
    expect(b.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('.ai-head')).toHaveCount(0); // no Use AI beside a section's heading
    await expect(page.getByRole('button', { name: 'Use AI' })).toHaveCount(0);
    return { bar: b.y, sw: s.y };
  };
  const [date, vote] = [await at('/new'), await at('/new/topic')];
  expect(Math.abs(date.bar - vote.bar)).toBeLessThanOrEqual(1);
  expect(Math.abs(date.sw - vote.sw)).toBeLessThanOrEqual(1);
  // Closed, the form's first field is still on the first screen.
  const title = await page.locator('#title').boundingBox();
  expect(title.y + title.height).toBeLessThanOrEqual(page.viewportSize().height);
  // Open: a 16px box, Esc closes it and focus goes back to the bar.
  await page.click('#ai-open');
  await expect(page.locator('#ai-prompt')).toBeFocused();
  expect(await page.locator('#ai-prompt').evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  expect((await page.locator('#ai-go').boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Escape');
  await expect(page.locator('#ai-draft')).toBeHidden();
  await expect(page.locator('#ai-open')).toBeFocused();
  await expect(page.locator('#ai-open')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('from Date, choices move to Vote, filled in, focused on what Venn did, with no poll made', async ({ page }) => {
  await page.goto('/new');
  const created = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/events') && created.push(r));
  await ask(page, 'Italian, Thai or Mexican?');
  await expect(page).toHaveURL(/\/new\/topic$/);
  const done = page.locator('#ai-done');
  await expect(done).toHaveAttribute('role', 'status');
  await expect(done.locator('.ai-kind')).toHaveText('Venn made this a vote, because you named choices to pick from.');
  await expect(done.locator('p')).toBeFocused();
  await expect(page.locator('#title')).toHaveValue('Italian, Thai or Mexican?');
  expect(await page.locator('#opts input').evaluateAll((els) => els.map((e) => e.value))).toEqual(['Italian', 'Thai', 'Mexican']);
  await expect(page.locator('#ai-prompt')).toHaveValue('Italian, Thai or Mexican?'); // the words stay in the box
  // Undo puts back the kind too.
  await done.getByRole('button', { name: 'Undo' }).click();
  await expect(page).toHaveURL(/\/new$/);
  expect(created).toHaveLength(0);
});

test('from Vote, a time to find moves to Date with the days filled in', async ({ page }) => {
  await page.goto('/new/topic');
  await ask(page, 'dinner any Friday this month');
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.locator('#ai-done .ai-kind')).toHaveText('Venn made this a date poll, because you asked when.');
  await expect(page.locator('#free-list .chip').first()).toBeVisible();
  await expect(page.locator('#ai-undo')).toBeVisible();
});

test('choices on a set day: a vote with the day in its note, and the date poll one tap away with no second request', async ({
  page,
}) => {
  await page.goto('/new');
  const calls = aiCalls(page);
  await ask(page, 'pizza or tacos on Friday?');
  await expect(page).toHaveURL(/\/new\/topic$/);
  await expect(page.locator('#ai-done .ai-kind')).toHaveText('Venn made this a vote, because Friday is already set.');
  await expect(page.locator('#title')).toHaveValue('Pizza or Tacos?');
  await expect(page.locator('#desc')).toHaveValue(/^Friday, \w{3} \d{1,2}$/);
  await page.getByRole('button', { name: 'Make it a date poll instead' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.locator('#title')).toHaveValue('Pizza or Tacos?');
  await expect(page.locator('#free-list .chip')).toHaveCount(1);
  expect(calls).toHaveLength(1);
  // The vote it left is as it was before: no choices, no note.
  await page.locator('.kind-switch a[href^="/new/topic"]').click();
  await expect(page.locator('#title')).toHaveValue('');
  await expect(page.locator('#desc')).toHaveValue('');
});

test('nothing typed is lost: moving keeps each form’s draft, and Undo brings back the vote it replaced', async ({ page }) => {
  await page.goto('/new/topic');
  await page.fill('#title', 'Book club');
  await page.locator('.kind-switch a[href="/new"]').click();
  await expect(page).toHaveURL(/\/new$/);
  await ask(page, 'dinner Friday');
  await page.locator('.kind-switch a[href^="/new/topic"]').click();
  await expect(page.locator('#title')).toHaveValue('Book club');
  await page.locator('.kind-switch a[href="/new"]').click();
  await expect(page).toHaveURL(/\/new$/);
  await ask(page, 'a vote on films');
  await expect(page).toHaveURL(/\/new\/topic$/);
  await expect(page.locator('#ai-done')).toContainText('It replaced the vote you’d started. Undo brings it back.');
  await expect(page.locator('#title')).not.toHaveValue('Book club');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await page.locator('.kind-switch a[href^="/new/topic"]').click();
  await expect(page.locator('#title')).toHaveValue('Book club');
});

test('a template’s link stays when Venn moves to the other form', async ({ page, request }) => {
  const res = await request.post('/api/brands', { data: { name: 'Crux Climbing', accent: '#c2410c' } });
  test.skip(!res.ok(), 'brand templates need sign-in on this Venn');
  const { id } = await res.json();
  await page.goto(`/new?brand=${id}`);
  await ask(page, 'Italian, Thai or Mexican?');
  await expect(page).toHaveURL(new RegExp(`/new/topic\\?brand=${id}$`));
  await expect(page.locator('#title')).toHaveValue('Italian, Thai or Mexican?'); // what AI wrote wins
  await page.goto('/new?brand=none');
  await ask(page, 'Italian, Thai or Mexican?');
  await expect(page).toHaveURL(/\/new\/topic\?brand=none$/);
});

test('an AI request that fails leaves the form as it was, and asking again works', async ({ page }) => {
  await page.goto('/new');
  await page.fill('#title', 'Picnic');
  await page.route('**/api/ai/draft', (route) => route.abort(), { times: 1 });
  await page.click('#ai-open');
  await page.fill('#ai-prompt', 'Italian, Thai or Mexican?');
  await page.click('#ai-go');
  await expect(page.locator('#ai-err')).not.toBeEmpty();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.locator('#title')).toHaveValue('Picnic');
  await expect(page.locator('#ai-go')).toBeEnabled();
  await page.click('#ai-go');
  await expect(page).toHaveURL(/\/new\/topic$/);
});

test('no box on a white-label template’s forms, and the switch still works', async ({ page }) => {
  const brand = await (await page.request.post('/api/brands', { data: { name: 'Acme', hideVenn: true } })).json();
  for (const path of ['/new', '/new/topic']) {
    const looked = page.waitForResponse((r) => r.url().endsWith(`/api/brands/${brand.id}`));
    await page.goto(`${path}?brand=${brand.id}`);
    await looked;
    await expect(page.locator('.kind-switch')).toBeVisible();
    await expect(page.locator('#ai-open')).toBeHidden();
  }
  await page.locator('.kind-switch a[href^="/new?"]').click();
  await expect(page).toHaveURL(new RegExp(`/new\\?brand=${brand.id}$`));
});

test('moving to a vote with no link lands in the account’s vote default, and the AI’s question wins', async ({ page }) => {
  const { id } = await (
    await page.request.post('/api/brands', { data: { name: 'Supper club', title: 'Our next supper' } })
  ).json();
  // The account and its defaults are stood in for, as this Venn has no sign-in (default-template-ai.spec.js).
  await page.addInitScript(() => localStorage.setItem('venn:account', JSON.stringify({ initial: 'S', name: 'Sam' })));
  await page.route('**/api/me/defaults', (r) =>
    r.fulfill({ json: { defaults: { date: null, vote: { id, name: 'Supper club' } } } }),
  );
  await page.goto('/new');
  await expect(page.locator('.brand-bar')).toHaveCount(0); // no date default
  await ask(page, 'Italian, Thai or Mexican?');
  await expect(page).toHaveURL(/\/new\/topic$/);
  await expect(page.locator('.brand-bar')).toContainText('Supper club');
  await expect(page.locator('#title')).toHaveValue('Italian, Thai or Mexican?');
  expect(await page.locator('#opts input').evaluateAll((els) => els.map((e) => e.value))).toEqual(['Italian', 'Thai', 'Mexican']);
});

test('going between Date and Vote, nothing jumps: the bar is drawn with the switch', async ({ page }) => {
  await page.goto('/new');
  await expect(page.locator('#ai-open')).toBeVisible();
  for (const to of ['/new/topic', '/new']) {
    // Where the switch sits on every frame from the tap until the other form has settled.
    await page.evaluate(() => {
      window.__ys = [];
      const t0 = performance.now();
      const tick = () => {
        const sw = document.querySelector('.kind-switch');
        if (sw) window.__ys.push(Math.round(sw.getBoundingClientRect().y));
        if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.locator(`.kind-switch a[href="${to}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${to}$`));
    await expect(page.locator('#ai-open')).toBeVisible();
    await page.waitForTimeout(1300);
    const ys = await page.evaluate(() => window.__ys);
    expect(new Set(ys).size, `switch positions: ${[...new Set(ys)]}`).toBe(1);
    await page.click('#ai-open'); // and the bar drawn early works
    await expect(page.locator('#ai-prompt')).toBeFocused();
    await page.keyboard.press('Escape');
  }
});

test('a question with no time in it makes a vote, yes or no when it is one', async ({ page }) => {
  await page.goto('/new');
  await ask(page, 'I want to ask my wife if she thinks I’m cute');
  await expect(page).toHaveURL(/\/new\/topic$/);
  await expect(page.locator('#ai-done .ai-kind')).toHaveText('Venn made this a vote, because you asked yes or no.');
  await expect(page.getByRole('radio', { name: 'Yes or no' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#title')).toHaveValue('Do you think I’m cute?');
  await expect(page.locator('#ai-err')).toBeEmpty();
  // An open one: a vote with options to check.
  await page.goto('/new');
  await ask(page, 'what kind of dog should we get');
  await expect(page).toHaveURL(/\/new\/topic$/);
  await expect(page.locator('#ai-done .ai-kind')).toHaveText(
    'Venn made this a vote, because there’s no date to find. Check the options it suggested.',
  );
  expect(await page.locator('#opts input').evaluateAll((els) => els.map((e) => e.value))).toEqual([
    'Labrador',
    'Beagle',
    'Poodle',
  ]); // A question with nothing named ("what should we make for dinner?"): Claude suggests a few to start from.
  await page.goto('/new');
  await ask(page, 'What should we make for dinner?');
  await expect(page).toHaveURL(/\/new\/topic$/);
  await expect(page.locator('#ai-done .ai-kind')).toHaveText(
    'Venn made this a vote, because there’s no date to find. Check the options it suggested.',
  );
  await expect(page.locator('#title')).toHaveValue('What should we make for dinner?');
  expect(await page.locator('#opts input').evaluateAll((els) => els.map((e) => e.value))).toEqual([
    'Pasta',
    'Tacos',
    'Stir-fry',
    'Curry',
  ]);
});
