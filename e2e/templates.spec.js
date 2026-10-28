import { test, expect } from '@playwright/test';
import { PAGES } from '../pages/pages.js';
import { TEMPLATES, templateIndex } from '../public/templates.js';
import { showNextMonth } from './helpers.js';

// Templates on the create page (a row of cards, seasonal ones first), the ?template= link that
// chooses one, the template pages on the website, and Finn's little surprises.

const cards = (page) => page.locator('.templates [data-occasion]:visible');
const card = (page, name) => page.locator('.templates [data-occasion]', { hasText: name });
const noSideways = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

test('templates: a row of cards to scroll, the season’s first, that fill in the plan', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 10, 20, 12)); // November 20
  await page.goto('/new/pick');
  await expect(cards(page)).toHaveText([
    /Friendsgiving/,
    /Holiday party/,
    /Secret Santa/,
    /Dinner/,
    /Drinks/,
    /Coffee/,
    /Book club/,
    /Brunch/,
    /Game night/,
    /Hike/,
    /Party/,
    /Gym/,
    /Run/,
    /Bike/,
    /Golf/,
    /Trip/,
  ]);
  // New Year's is out of season: on the page, but hidden.
  await expect(card(page, 'New Year’s')).toBeHidden();
  // The row scrolls on its own; the page never scrolls sideways.
  const row = page.locator('.templates');
  expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await noSideways(page);
  // Big enough to tap, with a name for screen readers.
  const box = await card(page, 'Friendsgiving').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole('group', { name: 'Templates' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Friendsgiving', exact: true })).toBeVisible();

  // With the keyboard: tabbing along the row scrolls it to the card in focus.
  await card(page, 'Friendsgiving').focus();
  for (let i = 0; i < 15; i++) await page.keyboard.press('Tab');
  await expect(card(page, 'Trip')).toBeFocused();
  expect(await row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect(card(page, 'Trip')).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(card(page, 'Trip')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-length="days"]')).toHaveAttribute('aria-pressed', 'true');

  // Friendsgiving: its emoji, a name to suggest, an evening four hours long, and a note for everyone.
  await card(page, 'Friendsgiving').click();
  await expect(card(page, 'Friendsgiving')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, 'Trip')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#emoji-tile')).toHaveText('🦃');
  await expect(page.locator('#title')).toHaveAttribute('placeholder', "Friendsgiving at Ana's");
  await expect(page.locator('#more-box')).toHaveAttribute('open', '');
  await expect(page.locator('#desc')).toHaveValue(/Potluck!/);
  await expect(page.locator('#location')).toHaveAttribute('placeholder', 'Whose place? Add the address');
  await expect(page.locator('[data-length="240"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#other-box summary')).toHaveText('Custom');
  // Another template swaps the note; what someone wrote themselves stays.
  await card(page, 'Secret Santa').click();
  await expect(page.locator('#desc')).toHaveValue(/draw names/);
  await page.fill('#desc', 'Bring snacks');
  await card(page, 'Dinner').click();
  await expect(page.locator('#desc')).toHaveValue('Bring snacks');
  await expect(page.locator('#title')).toHaveAttribute('placeholder', 'Dinner');
  await expect(page.locator('#location')).toHaveAttribute('placeholder', 'A place, an address or a video link');
});

test('templates: holiday ones lead in December, and the trip leads when asking when people are available', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 11, 12, 12)); // December 12
  await page.goto('/new/pick');
  await expect(cards(page).first()).toHaveText(/Holiday party/);
  await expect(cards(page).nth(2)).toHaveText(/New Year’s/);
  await expect(card(page, 'Friendsgiving')).toBeHidden();
  await page.clock.setFixedTime(new Date(2026, 6, 1, 12)); // July: everyday ones only
  await page.goto('/new/free');
  await expect(cards(page).first()).toHaveText(/Trip/);
  await expect(cards(page)).toHaveCount(13);
  await noSideways(page);
});

test('a ?template= link chooses that template, even out of season', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 6, 1, 12)); // July
  await page.goto('/new?template=secret-santa');
  await expect(card(page, 'Secret Santa')).toHaveAttribute('aria-pressed', 'true');
  await expect(cards(page).first()).toHaveText(/Secret Santa/); // out of season, it shows up front
  await expect(page.locator('#emoji-tile')).toHaveText('🎁');
  await expect(page.locator('#desc')).toHaveValue(/Gift budget/);
  await expect(page).toHaveURL(/\/new$/);
  // An everyday one, by its name.
  await page.goto('/new?template=trip');
  await expect(card(page, 'Trip')).toHaveAttribute('aria-pressed', 'true');
  // A name it doesn't know is ignored.
  await page.goto('/new?template=nope');
  await expect(page.locator('.templates [aria-pressed="true"]')).toHaveCount(0);
});

test('a poll made from a template keeps its emoji and note', async ({ page }) => {
  await page.goto('/new/pick?template=friendsgiving');
  await expect(page.locator('#desc')).toHaveValue(/Potluck!/);
  await page.fill('#organizer', 'Sam');
  await page.click('[data-length="allday"]');
  await page.locator('.cal-day:not(:disabled)').last().click();
  await page.click('#submit');
  await page.getByRole('button', { name: 'View poll' }).click();
  await expect(page.locator('#ev-title')).toContainText('Friendsgiving');
  await expect(page.locator('.note')).toContainText('Potluck!');
});

for (const path of ['/templates/friendsgiving', '/templates/holiday-party', '/templates/secret-santa']) {
  test(`template page ${path}: useful, fits a phone, and its button opens the template`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.faq details')).toHaveCount(4);
    await noSideways(page);
    // The questions open.
    await page.locator('.faq summary').first().click();
    await expect(page.locator('.faq details').first().locator('p')).toBeVisible();
    const slug = path.split('/').pop();
    await page.locator(`.tpl-hero a[href^="/new?template=${slug}&"]`).click();
    await expect(page).toHaveURL(new RegExp(`/new\\?from=${slug}$`)); // the template's name is gone, where they came from stays
    await expect(page.locator('.templates [aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#desc')).not.toHaveValue('');
  });
}

test('the templates page and the home page link to the template pages', async ({ page }) => {
  await page.goto('/');
  await page.locator('#templates a[href="/templates/friendsgiving"]').click();
  await expect(page.locator('h1')).toContainText('Friendsgiving');
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates$/);
  await noSideways(page);
  await page.locator('.tpl-cards a', { hasText: 'Book club' }).click();
  await expect(page).toHaveURL(/\/templates\/book-club$/);
  await page.locator('.tpl-hero .btn').click();
  await expect(card(page, 'Book club')).toHaveAttribute('aria-pressed', 'true');
});

test('every landing page opens its template, and says where people came from', async ({ page, request }) => {
  const sent = [];
  page.on('request', (r) => r.url().endsWith('/api/usage') && sent.push(r.postDataJSON()));
  for (const p of PAGES) {
    await page.goto(p.path);
    await expect(page.locator('h1')).toBeVisible();
    await noSideways(page);
    // Its own title, and its own picture for link previews.
    await expect(page).toHaveTitle(p.title);
    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect((await request.get(new URL(image).pathname)).status()).toBe(200);
    if (!p.template) continue;
    // The button opens the template, quiet ones too (they're only reached by links like this).
    await page.locator('main .btn').first().click();
    await expect(page.locator('.templates [aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#emoji-tile')).toHaveText(TEMPLATES[templateIndex(p.template)].emoji);
  }
  await expect.poll(() => sent.some((e) => e.name === 'view' && e.props.from === 'dnd')).toBe(true);
});

test('a poll made from a landing page is counted as coming from it', async ({ page, request }) => {
  await page.goto('/templates/book-club');
  await page.locator('.tpl-hero .btn').click();
  await page.fill('#title', 'Book club');
  await page.fill('#organizer', 'Sam');
  await showNextMonth(page);
  await page.locator('#when .cal-day:not(:disabled)').first().click();
  await page.click('#submit');
  await expect(page).toHaveURL(/\/e\//);
  const stats = await (await request.get('/api/stats?days=2', { headers: { authorization: 'Bearer test-stats' } })).json();
  expect(
    stats.counts.some((c) => c.name === 'poll.created' && c.props.from === 'book-club' && c.props.plan === 'book-club'),
  ).toBe(true);
});

test('easter eggs: Finn reacts to a few names and to a template tapped over and over', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 30, 12)); // a Friday
  await page.goto('/new/pick');
  await page.locator('#title').pressSequentially('Taco Tuesday');
  await expect(page.locator('#toast')).toHaveText('Taco Tuesday, on a Friday? Finn won’t tell.');
  await expect(page.locator('.egg')).toHaveCount(1); // a burst, out of the way…
  expect(await page.locator('.egg').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  await expect(page.locator('.egg')).toHaveCount(0); // …and gone
  // Tapping the same template five times.
  for (let i = 0; i < 5; i++) await card(page, 'Coffee').click();
  await expect(page.locator('#toast')).toHaveText('Finn agrees: Coffee. Definitely Coffee.');
  await expect(card(page, 'Coffee')).toHaveAttribute('aria-pressed', 'true');
  // It never gets in the way: the form still works.
  await page.fill('#title', 'Coffee with Lee');
  await expect(page.locator('#title')).toHaveValue('Coffee with Lee');
});

test('easter eggs: nothing moves when the device asks for less motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/new/free');
  await page.locator('#title').pressSequentially('Secret Santa');
  await expect(page.locator('#toast')).toHaveText(/^Shh\./);
  await expect(page.locator('.egg')).toHaveCount(0);
});
