/**
 * Loads the built SPA in a real browser and fails if it does not come up.
 *
 * This exists because of a day the deployed site was black. Dependabot had
 * raised `react` to 19 and left `react-dom` at 18; the two packages talk to
 * each other through undocumented internals that React 19 renamed, so
 * `createRoot` threw on the first line it ran. Nothing else noticed:
 * TypeScript was clean, all 551 unit tests passed, Vite built without a
 * warning and the deploy workflow went green. Every check the project had
 * inspected the source. None of them ever asked a browser to run it.
 *
 * So this one does, and it is deliberately shallow. It does not log in or
 * click anything — it serves `dist`, opens the page, and insists on two
 * things: that no uncaught error reached the console, and that React actually
 * put something inside `#root`. Both were false on the broken build and both
 * are true on any build that works at all. A deeper test here would need
 * fixtures and an API, and would start failing for reasons that have nothing
 * to do with "does the page come up".
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'web', 'dist');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error(`No build to smoke test at ${dist}. Run \`npm run build:web\` first.`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml',
};

// A stand-in for Cloudflare's asset layer: anything that is not a real file
// falls through to index.html, which is how a single-page app's routes work.
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  let file = path.join(dist, pathname);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(dist, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

// CI downloads the browser Playwright expects. A sandbox that already has a
// different build of Chromium can point at it instead of downloading a second
// one, which is the only reason this is configurable.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage();

const problems = [];
page.on('pageerror', (error) => problems.push(`uncaught ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
});

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

// The app calls the API immediately and gets a 404 from this static server,
// which it handles by showing the sign-in screen. That is a mounted app, so
// wait for the mount rather than for a quiet network.
await page.waitForFunction(() => document.getElementById('root')?.childElementCount > 0, null, { timeout: 10_000 })
  .catch(() => {});

const mounted = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0);
const text = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim());

await browser.close();
server.close();

// A request to a path this static server does not have is expected, and the
// browser reports it as a console error. It is not the app failing.
const real = problems.filter((p) => !/Failed to load resource.*\b(404|401)\b/i.test(p));

if (mounted === 0 || real.length > 0) {
  console.error('The built SPA does not come up in a browser.');
  if (mounted === 0) console.error('  #root is empty — React never mounted.');
  for (const problem of real) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`The built SPA mounts. First screen reads: ${text.slice(0, 80)}`);
