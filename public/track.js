// Usage stats from the browser (see src/usage.js for what's counted, and why it's anonymous):
// only when this server keeps stats, and never from browsers that ask not to be tracked.

import { getConfig } from './ui.js';

export async function track(name, props = {}) {
  if (navigator.globalPrivacyControl || navigator.doNotTrack === '1') return;
  if (!(await getConfig()).usage) return;
  fetch('/api/usage', {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, props }),
  }).catch(() => {});
}
