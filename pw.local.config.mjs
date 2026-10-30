import base from './playwright.config.js';
const swap = (s) => s.replaceAll('8791', '8941').replaceAll('8792', '8942');
export default {
  ...base,
  use: { ...base.use, baseURL: swap(base.use.baseURL), launchOptions: { executablePath: '/opt/pw-browsers/chromium' } },
  webServer: base.webServer.map((w) => ({ ...w, url: w.url && swap(w.url), port: w.port && +swap(String(w.port)), reuseExistingServer: false, env: Object.fromEntries(Object.entries(w.env || {}).map(([k, v]) => [k, swap(String(v))])) })),
};
