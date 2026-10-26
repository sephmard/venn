import base from './playwright.config.js';
export default { ...base, workers: 4, projects: base.projects.map((p) => ({ ...p, use: { ...p.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } } })) };
