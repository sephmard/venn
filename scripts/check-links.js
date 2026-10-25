// Fails if a Markdown file links to a file in this repo that doesn't exist: `npm run lint:links`.
// External links aren't fetched (they'd make CI flaky); only links within the repo are checked.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'site', 'dist', 'playwright-report', 'test-results', '.wrangler']);

function* markdownFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdownFiles(path);
    else if (entry.name.endsWith('.md')) yield path;
  }
}

const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(?:href|src|srcset)="([^"]+)"/g;
const problems = [];
for (const file of markdownFiles(root)) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, ''); // ignore code blocks
  for (const m of text.matchAll(LINK)) {
    const target = (m[1] || m[2]).split('#')[0].split('?')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, mailto:, …
    const resolved = target.startsWith('/') ? join(root, target) : join(dirname(file), target);
    if (!existsSync(resolved)) problems.push(`${relative(root, file)}: broken link to ${target}`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('All repository links in Markdown files point to existing files.');
