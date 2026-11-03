import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Topic polls: decide what or where (not when), then find a date for it.

async function noBlockingA11y(page, label) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    blocking,
    `${label}\n${blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('\n')}`,
  ).toEqual([]);
}

/** Make a topic poll from /new and land on it as its organizer. */
async function createTopic(page, { title, options, yesNo = false, single = false }) {
  await page.goto('/new');
  await page.getByRole('link', { name: '🗳️ Vote' }).click();
  await expect(page).toHaveURL(/\/new\/topic$/);
  // The kind of question first, then the question itself (its example changes to fit).
  if (yesNo) {
    await page.getByRole('radio', { name: 'Yes or no' }).click();
    await expect(page.locator('#title')).toHaveAttribute('placeholder', 'Should we do a book swap?');
    await expect(page.locator('#yesno')).toHaveText(/Everyone answers\s*Yes\s*No/);
  }
  await page.getByLabel('Your question').fill(title);
  if (!yesNo) {
    for (let i = 0; i < options.length; i++) {
      if (i >= 2) await page.getByRole('button', { name: '+ Add option' }).click();
      await page.getByLabel(`Option ${i + 1}`, { exact: true }).fill(options[i]);
    }
    if (single) await page.getByRole('switch', { name: 'One pick each' }).check();
  }
  await page.getByLabel(/Your name/).fill('Priya');
  await page.click('#submit');
  await page.locator('.party-go').click();
  await page.locator('.party').waitFor({ state: 'detached' });
  await expect(page).toHaveURL(/\/e\/\w+$/);
  return page.url();
}

async function answer(browser, url, name, votes) {
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await g.goto(url);
  for (const [label, vote] of votes) {
    const row = g.locator('.topic-row', { hasText: label });
    if (vote === 'pick') await row.click();
    else await row.getByRole('radio', { name: vote }).click();
  }
  await g.getByLabel('Your name').fill(name);
  await g.getByRole('button', { name: 'Submit' }).click();
  await expect(g.locator('#toast')).toContainText('your answer is in');
  await ctx.close();
}

test('vote on options, pick the favourite, then find a date for it', async ({ page, browser }) => {
  const url = await createTopic(page, { title: 'Where should we eat?', options: ["Rosa's", "Luigi's", 'Taco Loco'] });
  await expect(page.getByRole('heading', { name: 'Where should we eat?' })).toBeVisible();
  await noBlockingA11y(page, 'topic poll, organizer');

  await answer(browser, url, 'Marcus', [
    ["Rosa's", 'Yes'],
    ["Luigi's", 'No'],
    ['Taco Loco', 'If needed'],
  ]);
  await answer(browser, url, 'Ana', [
    ["Rosa's", 'Yes'],
    ['Taco Loco', 'Yes'],
  ]);

  await page.reload();
  await expect(page.locator('.best-hero')).toContainText("Rosa's");
  await expect(page.locator('.best-hero')).toContainText('2 of 2 would go');
  await expect(page.locator('.t-result', { hasText: 'Taco Loco' })).toContainText('1 yes · 1 if needed');
  await page.getByRole('button', { name: "Pick Rosa's" }).click();
  await expect(page.getByRole('heading', { name: "Go with Rosa's?" })).toBeVisible();
  await page.getByRole('button', { name: 'Pick it' }).click();
  await expect(page.locator('.banner-final')).toContainText("Decided Rosa's");

  // Guests see what was decided.
  const g = await (await browser.newContext()).newPage();
  await g.goto(url);
  await expect(g.locator('.banner-final h2')).toHaveText("Rosa's");
  await expect(g.getByRole('link', { name: 'Find a date for it' })).toHaveCount(0);
  await noBlockingA11y(g, 'topic poll, decided, guest');
  await g.close();

  // The organizer finds a date for it: a date poll with what was decided filled in.
  await page.getByRole('link', { name: 'Find a date for it' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.locator('#title')).toHaveValue("Rosa's");
  await expect(page.locator('#location')).toHaveValue("Rosa's");
});

test('a vote waits for an answer before offering Pick, unless the organizer picks one anyway', async ({ page, browser }) => {
  const url = await createTopic(page, { title: 'Where to?', options: ['Park', 'Beach', 'Museum'] });
  const results = page.locator('.t-results');
  // Alone on a new vote: the options, without empty bars, "0 yes" or Pick.
  await expect(results.locator('.t-result')).toHaveCount(3);
  await expect(results.locator('.t-bar, .t-count')).toHaveCount(0);
  await expect(page.locator('[data-pick]')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toContainText('Share the link and the favourite shows here.');
  // The group decided in the chat: Pick one anyway puts Pick this on every row.
  await page.getByRole('button', { name: 'Pick one anyway' }).click();
  await expect(results.getByRole('button', { name: 'Pick this' })).toHaveCount(3);
  await expect(results.getByRole('button', { name: 'Pick this' }).first()).toBeFocused();
  await expect(page.getByRole('button', { name: 'Pick one anyway' })).toHaveCount(0);
  await expect(results.locator('.t-bar')).toHaveCount(0);

  // A guest answers: the tally, the favourite and Pick are back.
  await answer(browser, url, 'Marcus', [['Beach', 'Yes']]);
  await page.reload();
  await expect(page.locator('.best-hero')).toContainText('Beach');
  await expect(results.locator('.t-bar')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Pick one anyway' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pick Beach' }).click();
  await page.getByRole('button', { name: 'Pick it' }).click();
  await expect(page.locator('.banner-final')).toContainText('Decided Beach');
});

test('Pick one anyway picks with no answers at all', async ({ page }) => {
  await createTopic(page, { title: 'Should we do a book swap?', yesNo: true });
  await page.getByRole('button', { name: 'Pick one anyway' }).click();
  await page.locator('.t-result', { hasText: 'Yes' }).getByRole('button', { name: 'Pick this' }).click();
  await page.getByRole('button', { name: 'Pick it' }).click();
  await expect(page.locator('.banner-final h2')).toHaveText('Yes');
});

test('a yes or no question takes one pick each', async ({ page, browser }) => {
  const url = await createTopic(page, { title: 'Should we do a trip this spring?', yesNo: true });
  await answer(browser, url, 'Jordan', [['Yes', 'pick']]);
  const g = await (await browser.newContext()).newPage();
  await g.goto(url);
  await expect(g.getByRole('heading', { name: 'What do you say?' })).toBeVisible();
  const yes = g.getByRole('radio', { name: 'Yes' });
  await yes.click();
  await expect(yes).toHaveAttribute('aria-checked', 'true');
  // One pick: choosing No takes Yes away.
  await g.getByRole('radio', { name: 'No' }).click();
  await expect(yes).toHaveAttribute('aria-checked', 'false');
  await expect(g.locator('.t-result').first()).toContainText('Yes1 vote');
  await noBlockingA11y(g, 'yes or no poll, guest');
  await g.close();
});

test('the topic form says what is missing', async ({ page }) => {
  await page.goto('/new/topic');
  // No date-poll templates (vote starters instead), no made-up name: the question is typed in full.
  await expect(page.locator('[data-occasion]')).toHaveCount(0);
  await expect(page.locator('[data-starter]').first()).toBeVisible();
  await expect(page.locator('#title')).toHaveValue('');
  await page.getByLabel(/Your name/).fill('Lee');
  await page.getByLabel('Option 1', { exact: true }).fill('Dune');
  await page.getByLabel('Option 2', { exact: true }).fill('Piranesi');
  await expect(page.locator('#summary')).toContainText('Add your question');
  await page.getByLabel('Your question').fill('Which book next?');
  await page.getByLabel('Option 1', { exact: true }).fill('Dune');
  await page.getByLabel('Option 2', { exact: true }).fill('dune');
  await expect(page.locator('#summary')).toContainText('in the list twice');
  await page.getByLabel('Option 2', { exact: true }).fill('Piranesi');
  await expect(page.locator('#summary')).toHaveText('2 options to vote on');
  await noBlockingA11y(page, 'topic create page');
});

test('the Date · Vote switch is the same on both forms, and Back goes between them', async ({ page }) => {
  await page.goto('/new');
  const nav = page.getByRole('navigation', { name: 'Kind of Venn' });
  await expect(nav.getByRole('link', { name: '📅 Date' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: '🗳️ Vote' }).click();
  await expect(page).toHaveURL(/\/new\/topic$/);
  await expect(nav.getByRole('link', { name: '🗳️ Vote' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.create-lede')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/new$/);
  await expect(nav.getByRole('link', { name: '📅 Date' })).toHaveAttribute('aria-current', 'page');
  const widths = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(widths).toBeLessThanOrEqual(0);
});

test('a leader on "if needed" alone isn’t called the favourite', async ({ page }) => {
  // Taco Spot: both would go, but only if needed; Rosa's and Luigi's have a yes each.
  const made = await (
    await page.request.post('/api/events', {
      data: {
        title: 'Where should we eat?',
        organizer: 'Priya',
        timezone: 'UTC',
        mode: 'topic',
        options: [{ label: 'Rosa’s' }, { label: 'Luigi’s' }, { label: 'Taco Spot' }],
      },
    })
  ).json();
  const ev = await (await page.request.get(`/api/events/${made.id}`)).json();
  const [rosa, luigi, taco] = ev.options.map((o) => o.id);
  for (const [name, availability] of [
    ['Ana', { [rosa]: 2, [taco]: 1 }],
    ['Ben', { [luigi]: 2, [taco]: 1 }],
  ])
    await page.request.post(`/api/events/${made.id}/participants`, { data: { name, availability } });
  await page.goto(`/e/${made.id}`);
  const hero = page.locator('.best-hero');
  await expect(hero.locator('.best-when')).toHaveText('Taco Spot');
  await expect(hero.locator('.kicker')).toHaveText('Everyone could go');
  await expect(hero).toContainText('2 of 2 would go (2 if needed)');
});

// A decided vote asks one question about what was picked, as a picked date does; a pick-one vote
// asks nothing, so its tally stays as it was decided.
async function decidedVote(request, { options, single = false, pick, answers = [] }) {
  const made = await (
    await request.post('/api/events', {
      data: { title: 'Where should we eat?', organizer: 'Priya', timezone: 'UTC', mode: 'topic', single, options },
    })
  ).json();
  const ev = await (await request.get(`/api/events/${made.id}`)).json();
  const id = (label) => ev.options.find((o) => o.label === label).id;
  for (const [name, said] of answers)
    await request.post(`/api/events/${made.id}/participants`, {
      data: { name, availability: Object.fromEntries(Object.entries(said).map(([l, v]) => [id(l), v])) },
    });
  return {
    made,
    id,
    decide: () =>
      request.post(`/api/events/${made.id}/finalize`, {
        data: { option: id(pick) },
        headers: { 'x-admin-token': made.adminToken },
      }),
  };
}

test('decided: "Are you in?" about the pick, answered as new and as before', async ({ page, browser }) => {
  const { made, id, decide } = await decidedVote(page.request, { options: ['Rosa’s', 'Luigi’s', 'Taco Loco'], pick: 'Luigi’s' });
  const url = `/e/${made.id}`;
  // Marcus answers before it's decided: yes to Rosa's, no to Luigi's.
  const ctx = await browser.newContext();
  const m = await ctx.newPage();
  await m.goto(url);
  await m.locator('.topic-row', { hasText: 'Rosa’s' }).getByRole('radio', { name: 'Yes' }).click();
  await m.locator('.topic-row', { hasText: 'Luigi’s' }).getByRole('radio', { name: 'No' }).click();
  await m.getByLabel('Your name').fill('Marcus');
  await m.getByRole('button', { name: 'Submit' }).click();
  await expect(m.locator('#toast')).toContainText('your answer is in');
  await decide();

  // A new guest: one question, the options gone, the name as before.
  await page.goto(url);
  await expect(page.locator('.banner-final h2')).toHaveText('Luigi’s');
  await expect(page.getByRole('heading', { name: 'It’s decided. Are you in?' })).toBeVisible();
  await expect(page.locator('.topic-row')).toHaveCount(0);
  const final = page.getByRole('group', { name: 'It’s decided. Are you in?' });
  await expect(final.getByRole('button')).toHaveText(['Yes', 'If needed', 'No']);
  await page.getByLabel('Your name').fill('Ana');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('#save-err')).toHaveText('Tap Yes, If needed or No first.');
  await final.getByRole('button', { name: 'If needed' }).click();
  await expect(final.getByRole('button', { name: 'If needed' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('#toast')).toContainText('your answer is in');
  await noBlockingA11y(page, 'decided vote, guest');

  // Marcus comes back: his no is pressed; a yes changes only Luigi's.
  await m.reload();
  const his = m.getByRole('group', { name: 'It’s decided. Are you in?' });
  await expect(his.getByRole('button', { name: 'No' })).toHaveAttribute('aria-pressed', 'true');
  await his.getByRole('button', { name: 'Yes' }).click();
  await expect(his.getByRole('button', { name: 'No' })).toHaveAttribute('aria-pressed', 'false');
  await m.getByRole('button', { name: 'Update answer' }).click();
  await expect(m.locator('#toast')).toContainText('Answer updated.');
  await ctx.close();

  const ev = await (await page.request.get(`/api/events/${made.id}`)).json();
  const said = Object.fromEntries(ev.participants.map((p) => [p.name, p.availability]));
  expect(said.Marcus).toEqual({ [id('Rosa’s')]: 2, [id('Luigi’s')]: 2 });
  expect(said.Ana).toEqual({ [id('Luigi’s')]: 1 });
});

test('decided pick-one and yes-or-no votes ask nothing more', async ({ page }) => {
  for (const [options, pick] of [
    [['Rosa’s', 'Luigi’s'], 'Luigi’s'],
    [['Yes', 'No'], 'No'],
    [['Yes', 'No'], 'Yes'],
  ]) {
    const { made, decide } = await decidedVote(page.request, {
      options,
      single: true,
      pick,
      answers: [['Ben', { [options[0]]: 2 }]],
    });
    await decide();
    await page.goto(`/e/${made.id}`);
    await expect(page.locator('.banner-final h2')).toHaveText(pick);
    await expect(page.locator('#mine-h, #answer-final, .topic-row, #save')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'The group' })).toBeVisible();
    // On a wide screen, the group takes the row rather than half of it.
    const w = (await page.locator('.panels > .panel').boundingBox()).width;
    if (page.viewportSize().width >= 1000) expect(w).toBeGreaterThan(600);
    await expect(page.locator('.t-result', { hasText: options[0] })).toContainText('1 vote');
  }
});

test('after voting, a guest is offered a vote of their own; never the organizer, in a frame or on white label', async ({
  page,
  browser,
  isMobile,
}) => {
  const vote = (data = {}) =>
    page.request
      .post('/api/events', {
        data: { title: 'Where to?', organizer: 'Priya', timezone: 'UTC', mode: 'topic', options: ['Park', 'Beach'], ...data },
      })
      .then((r) => r.json());
  const yours = (p) => p.getByRole('link', { name: 'Planning something? Make yours in 30 seconds' });
  const made = await vote();
  const g = await (
    await browser.newContext(isMobile ? { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } } : {})
  ).newPage();
  await g.goto(`/e/${made.id}`);
  await expect(g.locator('.topic-row').first()).toBeVisible();
  await expect(yours(g)).toHaveCount(0);
  await g.locator('.topic-row', { hasText: 'Beach' }).getByRole('radio', { name: 'Yes' }).click();
  await g.getByLabel('Your name').fill('Ana');
  await g.getByRole('button', { name: 'Submit' }).click();
  await expect(yours(g)).toBeVisible();
  expect(await yours(g).getAttribute('href')).toBe('/new/topic?from=guest');
  expect((await yours(g).boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(yours(g)).toHaveClass('link-btn');
  // Under the group's results, not in the answer card.
  await expect(g.locator('section[aria-labelledby="group-h"] #make-yours')).toHaveCount(1);
  await expect(g.locator('[aria-labelledby="mine-h"] #make-yours')).toHaveCount(0);
  await noBlockingA11y(g, 'vote, guest after voting, Make yours');
  await yours(g).click();
  await expect(g).toHaveURL(/\/new\/topic\?from=guest$/);
  await g.context().close();

  // The organizer, with their own answer in: no.
  await page.goto(`/e/${made.id}#admin=${made.adminToken}`);
  await expect(page.locator('.t-results')).toBeVisible();
  await expect(yours(page)).toHaveCount(0);

  // In a frame (/embed) and on a white-label poll: no.
  const brand = await (await page.request.post('/api/brands', { data: { name: 'Acme', hideVenn: true } })).json();
  for (const [where, ev] of [
    ['embed', made],
    ['e', await vote({ brand: brand.id })],
  ]) {
    const ana = await (
      await page.request.post(`/api/events/${ev.id}/participants`, { data: { name: 'Ana', availability: { 1: 2 } } })
    ).json();
    await page.goto(`/${where}/${ev.id}#edit=${ana.id}.${ana.editToken}`);
    await expect(page.locator('#save')).toHaveText('Update answer');
    await expect(yours(page)).toHaveCount(0);
  }
});
