import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// A one-line note on an answer ("Can only stay till 9"), on date and vote polls: added under Your
// name, shown in The group's Notes, kept private where names or answers are hidden.

const t0 = Date.UTC(2030, 0, 8, 18);
const H = 3_600_000;

async function noBlockingA11y(page, label) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    blocking,
    `${label}\n${blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('\n')}`,
  ).toEqual([]);
}

/** A date poll or a vote, made through the API: { id, adminToken, keys } (keys: what to answer). */
async function makePoll(request, kind, more = {}) {
  const body =
    kind === 'vote'
      ? { title: 'Where should we eat?', organizer: 'Priya', timezone: 'UTC', mode: 'topic', options: ['Rosa’s', 'Taco Loco'] }
      : { title: 'Dinner', organizer: 'Priya', timezone: 'UTC', mode: 'options', options: [{ start: t0, end: t0 + 2 * H }] };
  const made = await (await request.post('/api/events', { data: { ...body, ...more } })).json();
  const ev = await (await request.get(`/api/events/${made.id}`)).json();
  return { ...made, keys: kind === 'vote' ? ev.options.map((o) => String(o.id)) : ev.slots.map(String) };
}

/** Answer yes to the first option on the page as `name` (with an optional note), and send it. */
async function answer(page, kind, name, note) {
  if (kind === 'vote') await page.locator('.topic-row').first().getByRole('radio', { name: 'Yes' }).click();
  else await page.locator('#mine .row [data-vote="2"]').first().click();
  await page.fill('#name', name);
  if (note != null) {
    if (!(await page.locator('#note').count())) await page.getByRole('button', { name: '+ Add a note' }).click();
    await page.locator('#note').fill(note);
  }
  await page.click('#save');
  if (kind === 'date') await page.locator('.party-go').click();
}

const notes = (page) => page.locator('#notes-slot');

for (const kind of ['date', 'vote']) {
  test(`${kind} poll: a guest adds a note, the group sees it, and clearing it takes it away`, async ({
    page,
    browser,
    request,
  }) => {
    const { id, adminToken } = await makePoll(request, kind);
    await page.goto(`/e/${id}`);
    // Collapsed: one 44px link that says what it opens; tapping it puts the cursor in a 16px field.
    const add = page.getByRole('button', { name: '+ Add a note' });
    await expect(add).toHaveAttribute('aria-expanded', 'false');
    expect((await add.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await add.click();
    const field = page.getByLabel('Note for the group (optional)');
    await expect(field).toBeFocused();
    expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
    await expect(notes(page)).toBeEmpty(); // no notes yet: no Notes heading

    await field.fill('Can only stay till 9');
    await answer(page, kind, 'Sam');
    await expect(notes(page).getByRole('heading', { name: 'Notes' })).toBeAttached();
    await expect(notes(page).locator('li')).toHaveText(['Sam Can only stay till 9']);
    await expect(notes(page).locator('li b')).toHaveText('Sam');

    // Back later: the note is in its open field.
    await page.reload();
    await expect(page.getByLabel('Note for the group (optional)')).toHaveValue('Can only stay till 9');

    // The organizer sees it too.
    const org = await (await browser.newContext()).newPage();
    await org.goto(`/e/${id}#admin=${adminToken}`);
    await expect(notes(org).locator('li')).toHaveText(['Sam Can only stay till 9']);
    await noBlockingA11y(org, `${kind} poll, organizer, with a note`);

    // Emptied and sent again: gone, and so is the heading.
    await page.getByLabel('Note for the group (optional)').fill('');
    const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/participants/'));
    await page.click('#save');
    expect((await put).status()).toBe(200);
    await page.reload();
    await expect(notes(page)).toBeEmpty();
    await expect(page.getByRole('button', { name: '+ Add a note' })).toBeVisible();
  });
}

test('hidden names or answers: another guest sees no one else’s note', async ({ browser, request }) => {
  for (const hide of [{ hideNames: true }, { hideResults: true }]) {
    const { id, keys } = await makePoll(request, 'vote', hide);
    await request.post(`/api/events/${id}/participants`, {
      data: { name: 'Ana', availability: { [keys[0]]: 2 }, note: 'Bringing my kids, Ana and Leo' },
    });
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/e/${id}`);
    await answer(guest, 'vote', 'Lee', 'Might be late');
    await expect(guest.locator('#app')).not.toContainText('Bringing my kids');
    // Lee's own note is theirs to see (in the field; and in Notes where the group shows).
    await expect(guest.getByLabel('Note for the group (optional)')).toHaveValue('Might be late');
  }
});

test('a note is text: no markup runs, and a long word wraps on a phone', async ({ page, request }) => {
  const { id, keys } = await makePoll(request, 'date');
  const word = 'x'.repeat(60);
  await request.post(`/api/events/${id}/participants`, {
    data: { name: 'Ana', availability: { [keys[0]]: 2 }, note: '<img src=x onerror=alert(1)>' },
  });
  await request.post(`/api/events/${id}/participants`, { data: { name: 'Lee', availability: { [keys[0]]: 2 }, note: word } });
  let dialog = false;
  page.on('dialog', (d) => ((dialog = true), d.dismiss()));
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/e/${id}`);
  const tab = page.getByRole('tab', { name: /The group/ });
  if (await tab.isVisible()) await tab.click();
  await expect(notes(page).locator('li').first()).toHaveText('Ana <img src=x onerror=alert(1)>');
  await expect(notes(page).locator('img')).toHaveCount(0);
  await expect(notes(page).locator('li').nth(1)).toContainText(word);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(dialog).toBe(false);
});

test('the answer card keeps room for the note’s link while it loads, and saves without it', async ({ page, request }) => {
  const { id, keys } = await makePoll(request, 'date');
  const { id: pid, editToken } = await (
    await request.post(`/api/events/${id}/participants`, {
      data: { name: 'Ana', availability: { [keys[0]]: 2 }, note: 'Can only stay till 9' },
    })
  ).json();
  await page.route('**/answer-note.js*', (r) => r.abort());
  await page.goto(`/e/${id}#edit=${pid}.${editToken}`);
  await expect(page.locator('#name')).toHaveValue('Ana');
  expect((await page.locator('#note-slot').boundingBox()).height).toBeGreaterThanOrEqual(44);
  // The answer changes and saves; the note it had stays.
  await page.locator('#mine .row [data-vote="1"]').first().click();
  const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/participants/'));
  await page.click('#save');
  expect((await put).status()).toBe(200);
  const ev = await (await request.get(`/api/events/${id}`)).json();
  expect(ev.participants[0].note).toBe('Can only stay till 9');
  expect(ev.participants[0].availability[keys[0]]).toBe(1);
});

test('notes pass the accessibility checks in both looks, light and dark', async ({ browser, request }) => {
  for (const retro of [true, false])
    for (const colorScheme of ['light', 'dark']) {
      const { id, keys } = await makePoll(request, 'vote', { retro });
      await request.post(`/api/events/${id}/participants`, {
        data: { name: 'Ana', availability: { [keys[0]]: 2 }, note: 'Can only stay till 9' },
      });
      const ctx = await browser.newContext({ colorScheme });
      if (!retro) await ctx.addInitScript(() => localStorage.setItem('venn:retro', '0'));
      const page = await ctx.newPage();
      await page.goto(`/e/${id}`);
      await expect(notes(page).locator('li')).toHaveText(['Ana Can only stay till 9']);
      await page.getByRole('button', { name: '+ Add a note' }).click();
      await noBlockingA11y(page, `notes, retro ${retro}, ${colorScheme}`);
      await ctx.close();
    }
});

test('once a poll is decided, an answer with no note keeps no empty room for one', async ({ page, request }) => {
  const { id, adminToken, keys } = await makePoll(request, 'date');
  const { id: pid, editToken } = await (
    await request.post(`/api/events/${id}/participants`, { data: { name: 'Ana', availability: { [keys[0]]: 2 } } })
  ).json();
  await request.post(`/api/events/${id}/finalize`, { data: { start: +keys[0] }, headers: { 'x-admin-token': adminToken } });
  await page.goto(`/e/${id}#edit=${pid}.${editToken}`);
  await expect(page.locator('#name')).toHaveValue('Ana');
  await expect(page.locator('#note-slot')).toHaveAttribute('style', /min-height: 0/);
  expect((await page.locator('#note-slot').boundingBox()).height).toBe(0);
});
