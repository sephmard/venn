import { test, expect } from '@playwright/test';
import { openTools } from './helpers.js';

// Notifications on the organizer's phone (Web Push). The browser's push service and the server's
// sending are stood in for here: the panel's part is asking, subscribing and telling the server.

const KEY = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const SUB = {
  endpoint: 'https://web.push.apple.com/QGm1test',
  keys: {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  },
};

/** A poll, opened by its organizer, with the server saying phone notifications are on. */
async function organizerPoll(page, request) {
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: {
        title: 'Dinner',
        timezone: 'UTC',
        mode: 'options',
        options: [{ start: Date.UTC(2030, 0, 4, 19), end: Date.UTC(2030, 0, 4, 21) }],
      },
    })
  ).json();
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), push: KEY } });
  });
  const puts = [];
  let devices = 0;
  let settings = {};
  await page.route(`**/api/events/${id}/notifications`, async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      puts.push(body);
      devices = body.push ? 1 : body.pushRemove ? 0 : devices;
    } else settings = await (await route.fetch()).json();
    await route.fulfill({ json: { ...settings, pushAvailable: true, pushDevices: devices } });
  });
  await page.goto(`/e/${id}#admin=${adminToken}`);
  return puts;
}

test('the organizer turns on notifications on this device, and off again', async ({ page, request }) => {
  // The browser's side: permission is given, and the push service hands back a subscription.
  await page.addInitScript((sub) => {
    let current = null;
    const pushManager = {
      getSubscription: async () => current,
      subscribe: async (opts) => {
        window.__key = opts.applicationServerKey.length;
        current = { endpoint: sub.endpoint, toJSON: () => sub };
        return current;
      },
    };
    const reg = { pushManager };
    Object.defineProperty(Notification, 'permission', { get: () => 'default' });
    Notification.requestPermission = async () => 'granted';
    navigator.serviceWorker.register = async () => reg;
    navigator.serviceWorker.getRegistration = async () => reg;
    Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(reg) });
  }, SUB);
  const puts = await organizerPoll(page, request);
  await openTools(page);
  await page.click('#notify-open');
  const row = page.locator('#push-way');
  await expect(row.locator('legend')).toHaveText('On this device');
  await row.getByRole('button', { name: 'Turn on' }).click();
  await expect(row).toContainText('✓ On.');
  expect(puts.at(-1)).toEqual({ push: SUB });
  expect(await page.evaluate(() => window.__key)).toBe(65); // the server's public key, as bytes
  // Off: only this poll stops, so the device's subscription is kept for the others.
  await row.getByRole('button', { name: 'Turn off' }).click();
  await expect(row.getByRole('button', { name: 'Turn on' })).toBeVisible();
  expect(puts.at(-1)).toEqual({ pushRemove: SUB.endpoint });
});

test('on an iPhone in Safari, it says to add Venn to the Home Screen first', async ({ browser, request }) => {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => delete window.PushManager); // Safari, not from the Home Screen
  await organizerPoll(page, request);
  await openTools(page);
  await page.click('#notify-open');
  await expect(page.locator('#push-way')).toContainText('add Venn to your Home Screen');
  await expect(page.locator('#push-way button')).toHaveCount(0);
  await context.close();
});

test('the Home Screen app opens in the retro look, with the retro icon', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.background_color).toBe('#0d0221');
  expect(manifest.icons.map((i) => i.src)).toContain('/icons/icon-retro.svg');
  for (const { src } of manifest.icons) expect((await request.get(src)).ok()).toBe(true);
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
  expect(sw.headers()['content-type']).toMatch(/javascript/);
});

test('a guest who answered can be notified when the date is picked, and stop', async ({ page, request }) => {
  await page.addInitScript((sub) => {
    let current = null;
    const pushManager = {
      getSubscription: async () => current,
      subscribe: async () => (current = { endpoint: sub.endpoint, toJSON: () => sub }),
    };
    const reg = { pushManager };
    Object.defineProperty(Notification, 'permission', { get: () => 'default' });
    Notification.requestPermission = async () => 'granted';
    navigator.serviceWorker.register = async () => reg;
    navigator.serviceWorker.getRegistration = async () => reg;
    Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(reg) });
  }, SUB);
  const { id } = await (
    await request.post('/api/events', {
      data: {
        title: 'Dinner',
        timezone: 'UTC',
        mode: 'options',
        options: [{ start: Date.UTC(2030, 0, 4, 19), end: Date.UTC(2030, 0, 4, 21) }],
      },
    })
  ).json();
  const ana = await (await request.post(`/api/events/${id}/participants`, { data: { name: 'Ana', availability: {} } })).json();
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), push: KEY } });
  });
  const puts = [];
  await page.route(`**/api/events/${id}/participants/${ana.id}/push`, async (route) => {
    puts.push({ body: route.request().postDataJSON(), token: route.request().headers()['x-edit-token'] });
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(`/e/${id}#edit=${ana.id}.${ana.editToken}`);
  const line = page.locator('#edit-link');
  await line.getByRole('button', { name: '🔔 Notify me when the date is picked' }).click();
  await expect(line).toContainText("You'll get a notification when the date is picked.");
  expect(puts.at(-1)).toEqual({ body: { push: SUB }, token: ana.editToken });
  await line.getByRole('button', { name: 'Turn off' }).click();
  await expect(line.getByRole('button', { name: '🔔 Notify me when the date is picked' })).toBeVisible();
  expect(puts.at(-1).body).toEqual({ pushRemove: SUB.endpoint });
});

test("without notifications on the server, a guest's answer line says nothing about them", async ({ page, request }) => {
  const { id } = await (
    await request.post('/api/events', {
      data: {
        title: 'Dinner',
        timezone: 'UTC',
        mode: 'options',
        options: [{ start: Date.UTC(2030, 0, 4, 19), end: Date.UTC(2030, 0, 4, 21) }],
      },
    })
  ).json();
  const ana = await (await request.post(`/api/events/${id}/participants`, { data: { name: 'Ana', availability: {} } })).json();
  await page.goto(`/e/${id}#edit=${ana.id}.${ana.editToken}`);
  await expect(page.locator('#edit-link')).toContainText('Answering as');
  await expect(page.locator('#edit-link')).not.toContainText('Notify me');
});
