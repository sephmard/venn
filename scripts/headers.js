// Writes public/_headers from src/security-headers.js: `npm run headers`.
import { writeFileSync } from 'node:fs';
import { SECURITY_HEADERS } from '../src/security-headers.js';

const title = (name) => name.replace(/(^|-)\w/g, (c) => c.toUpperCase());
const lines = ['/*', ...Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${title(k)}: ${v}`)];
writeFileSync(new URL('../public/_headers', import.meta.url), lines.join('\n') + '\n');
console.log('wrote public/_headers');
