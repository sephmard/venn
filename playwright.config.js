import { defineConfig, devices } from '@playwright/test';

const PORT = 8791;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], timezoneId: 'America/New_York' } },
    { name: 'mobile', use: { ...devices['Pixel 7'], timezoneId: 'Europe/London' } },
  ],
  webServer: {
    command: 'node server.js',
    // Fake OAuth client IDs switch on the calendar buttons; the tests mock Google and Microsoft.
    env: {
      PORT: String(PORT),
      DB_PATH: ':memory:',
      GOOGLE_CLIENT_ID: 'test-google-client',
      MICROSOFT_CLIENT_ID: 'test-ms-client',
    },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
