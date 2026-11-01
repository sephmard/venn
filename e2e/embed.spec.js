// White label and embedding (src/embed.js, docs/EMBED.md): a poll in another website's frame.

import { createServer } from 'node:http';
import { test, expect } from '@playwright/test';

// The other website: a server of its own, on another port (another origin), as browsers only let a
// local page frame a local one.
let host, HOST;
let pageHtml = '';
test.beforeAll(async () => {
  host = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(pageHtml));
  await new Promise((r) => host.listen(0, r));
  HOST = `http://localhost:${host.address().port}`;
});
test.afterAll(() => host.close());
const options = [8, 9].map((d) => ({ start: Date.UTC(2030, 0, d, 18), end: Date.UTC(2030, 0, d, 20) }));

/** A template (with these settings) and a poll made from it, through the API as another app would. */
async function brandedPoll(page, brand) {
  const b = await (await page.request.post('/api/brands', { data: { name: 'Acme', accent: '#2563eb', ...brand } })).json();
  const res = await page.request.post('/api/events', {
    data: { title: 'Team lunch', organizer: 'Sam', timezone: 'UTC', mode: 'options', options, brand: b.id },
  });
  return (await res.json()).id;
}

/** The other website: a page with the poll in a frame, and embed.js, keeping what it hears. */
async function hostPage(page, baseURL, id) {
  pageHtml = `<!doctype html><html><body><h1>Acme intranet</h1>
        <iframe id="venn" src="${baseURL}/embed/${id}" title="Team lunch" allow="clipboard-write" style="width:100%;height:300px;border:0"></iframe>
        <script>window.heard = []; document.addEventListener('venn', (e) => heard.push(e.detail));</script>
        <script src="${baseURL}/embed.js" async></script></body></html>`;
  await page.goto(`${HOST}/polls`);
  return page.frameLocator('#venn');
}

test('a template’s website shows its poll in a frame: the poll alone, fitted, and it hears the answer', async ({
  page,
  baseURL,
}) => {
  const id = await brandedPoll(page, { embedSites: [HOST] });
  const frame = await hostPage(page, baseURL, id);
  await expect(frame.locator('.brand-bar')).toContainText('Acme');
  // No Venn bar or footer, one small credit.
  await expect(frame.locator('.topbar')).toBeHidden();
  await expect(frame.locator('.footer')).toBeHidden();
  await expect(frame.locator('.embed-credit a')).toHaveText('Made with Venn');
  // embed.js fits the frame to the poll.
  await expect.poll(async () => (await page.locator('#venn').boundingBox()).height).toBeGreaterThan(300);

  await frame.locator('#mine .row').first().locator('[data-vote="2"]').click();
  await frame.locator('#name').fill('Ana');
  await frame.locator('#save').click();
  const yes = frame.locator('#submit-check[open] #sc-yes');
  const go = frame.locator('.party-go');
  await yes.or(go).first().waitFor();
  if (await yes.isVisible()) await yes.click();
  await go.click();
  await expect(frame.locator('#save-state')).toHaveText('Submitted');
  await expect
    .poll(() => page.evaluate(() => window.heard.map((m) => m.type)))
    .toEqual(expect.arrayContaining(['ready', 'height', 'answered']));
  const answered = await page.evaluate(() => window.heard.find((m) => m.type === 'answered'));
  expect(answered).toEqual({ venn: 1, type: 'answered', poll: id, updated: false });
});

test('white label: no Venn on the poll, in the frame or on its own link', async ({ page, baseURL }) => {
  const id = await brandedPoll(page, { embedSites: [HOST], hideVenn: true });
  const frame = await hostPage(page, baseURL, id);
  await expect(frame.locator('.brand-bar')).toContainText('Acme');
  await expect(frame.locator('.embed-credit')).toHaveCount(0);
  await page.goto(`/e/${id}`);
  await expect(page.locator('.brand-bar')).toContainText('Acme');
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.footer')).toBeHidden();
  await expect(page).toHaveTitle('Team lunch');
});

test('a website the template doesn’t list can’t show its polls', async ({ page, baseURL }) => {
  const id = await brandedPoll(page, { embedSites: ['http://localhost:1'] });
  await hostPage(page, baseURL, id);
  // The browser refuses to draw it: the frame never gets the poll.
  await page.waitForTimeout(1000);
  const frame = page.frames().find((f) => f.url().includes(`/embed/${id}`));
  const drawn = frame ? await frame.locator('.brand-bar').count() : 0;
  expect(drawn).toBe(0);
});
