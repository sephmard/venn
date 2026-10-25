import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'dist/', '.wrangler/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // Browser code (also imported by the server and worker, so it must stay dependency-free).
  { files: ['public/**/*.js'], languageOptions: { globals: globals.browser } },
  // Cloudflare Worker + shared API: web-standard globals only.
  { files: ['src/**/*.js'], languageOptions: { globals: { ...globals.serviceworker, console: 'readonly' } } },
  { files: ['server.js', 'test/**/*.js', '*.config.js'], languageOptions: { globals: globals.node } },
  // Playwright tests run in Node but pass callbacks into the browser.
  { files: ['e2e/**/*.js', 'scripts/**/*.js'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
