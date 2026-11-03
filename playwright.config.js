import { defineConfig, devices } from '@playwright/test';

const PORT = 8791;
const FAKE_AI_PORT = 8792;
// Accounts (e2e/account.spec.js): a second Venn with sign-in switched on, and a stand-in for Google.
const ACCOUNTS_PORT = 8794;
const FAKE_OAUTH_PORT = 8793;
export const ACCOUNTS_URL = `http://localhost:${ACCOUNTS_PORT}`;
export const FAKE_OAUTH_URL = `http://localhost:${FAKE_OAUTH_PORT}`;

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
  webServer: [
    {
      command: 'node server.js',
      // Fake OAuth client IDs switch on the calendar buttons; the tests mock Google and Microsoft.
      // AI calls go to the fake Claude API below.
      env: {
        PORT: String(PORT),
        DB_PATH: ':memory:',
        GOOGLE_CLIENT_ID: 'test-google-client',
        MICROSOFT_CLIENT_ID: 'test-ms-client',
        ANTHROPIC_API_KEY: 'sk-test',
        ANTHROPIC_BASE_URL: `http://localhost:${FAKE_AI_PORT}`,
        AI_RATE_LIMIT: '1000',
        AI_WEEKLY_LIMIT: '1000', // the tests all come from one address
        CREATE_RATE_LIMIT: '0', // so are all their polls and answers
        ANSWER_RATE_LIMIT: '0',
        USAGE_RATE_LIMIT: '0',
        AI_ALLOWANCE_RATE_LIMIT: '0',
        // Usage stats on, so the stats page (and every count the app sends) is tested.
        STATS_TOKEN: 'test-stats',
      },
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node server.js',
      env: {
        PORT: String(ACCOUNTS_PORT),
        DB_PATH: ':memory:',
        GOOGLE_CLIENT_ID: 'test-google-client',
        GOOGLE_CLIENT_SECRET: 'test-google-secret',
        OAUTH_TEST_BASE: `http://localhost:${FAKE_OAUTH_PORT}`,
        // Email sign-in, with its emails sent to the same stand-in, and no breach check.
        EMAIL_FROM: 'Venn <hi@venn.test>',
        RESEND_API_KEY: 're_test',
        RESEND_API_URL: `http://localhost:${FAKE_OAUTH_PORT}/resend`,
        PWNED_PASSWORDS: 'off',
        CREATE_RATE_LIMIT: '0',
        ANSWER_RATE_LIMIT: '0',
      },
      url: ACCOUNTS_URL,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node e2e/fake-oauth.js',
      env: { PORT: String(FAKE_OAUTH_PORT) },
      port: FAKE_OAUTH_PORT,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node e2e/fake-anthropic.js',
      env: { PORT: String(FAKE_AI_PORT) },
      port: FAKE_AI_PORT,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
