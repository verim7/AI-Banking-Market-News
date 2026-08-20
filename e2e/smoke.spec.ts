import { expect, test } from '@playwright/test';

const ADMIN = { email: 'admin@example.com', password: 'smoke-test-password-1' };
const SCOPED = { email: 'ch@example.com', password: 'another-long-password-2' };

async function login(page: import('@playwright/test').Page, who: typeof ADMIN) {
  await page.goto('/');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
}

test('rejects a bad password', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('invalid email or password')).toBeVisible();
});

test('Market Lens renders tiles and charts', async ({ page }) => {
  await login(page, ADMIN);
  await expect(page.getByText('AI articles in view')).toBeVisible();
  await expect(page.getByRole('img', { name: /By region/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Coverage over time/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /By AI use case/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /By type of AI/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /By L1 process/ })).toBeVisible();
});

test('the Lens lists every article with its AI analysis', async ({ page }) => {
  await login(page, ADMIN);

  const table = page.locator('table.analysis');
  await expect(table).toBeVisible();
  for (const heading of ['AI focus', 'Type of AI', 'L1 process', 'Stage']) {
    await expect(table.getByRole('columnheader', { name: heading })).toBeVisible();
  }

  // The row carries the classifier's judgements, not just the headline.
  const row = table.locator('tr', {
    hasText: 'German retail banks cut AML false positives with machine learning',
  });
  await expect(row).toBeVisible();
  // Target the chips, not bare text: this headline contains the words
  // "machine learning" itself, so a text match hits the title too.
  await expect(row.locator('.chip', { hasText: 'Machine Learning' })).toBeVisible();
  await expect(row.locator('.chip', { hasText: 'Financial Crime & AML' })).toBeVisible();
  await expect(row.locator('.status', { hasText: 'In production' })).toBeVisible();
  // The stage claim must show the phrase it was read from.
  await expect(row.locator('.evidence')).toContainText('deployed across');
});

test('the Lens opens on twelve months, not the last few days', async ({ page }) => {
  await login(page, ADMIN);
  const from = page.getByLabel('From');
  const value = await from.inputValue();
  const months = (Date.now() - Date.parse(value)) / (30 * 86_400_000);
  expect(months).toBeGreaterThan(11);
  expect(months).toBeLessThan(13);
});

test('the tabs say what they are for', async ({ page }) => {
  await login(page, ADMIN);
  await expect(page.getByRole('button', { name: 'This Week' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review Queue' })).toBeVisible();

  await page.getByRole('button', { name: 'Review Queue' }).click();
  await expect(page.getByText(/Deciding\./)).toBeVisible();

  await page.getByRole('button', { name: 'This Week' }).click();
  await expect(page.getByText(/Reading\./)).toBeVisible();
});

test('filtering by region narrows the Lens', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('tab', { name: 'Archive' }).or(
    page.getByRole('button', { name: 'Archive' })).click();

  await expect(page.getByText('Swiss private banks deploy generative AI copilots')).toBeVisible();

  await page.getByLabel('Region').selectOption('switzerland');
  await expect(page.getByText('Swiss private banks deploy generative AI copilots')).toBeVisible();
  await expect(
    page.getByText('German retail banks cut AML false positives with machine learning'),
  ).toHaveCount(0);
});

test('favouriting an article moves it into the Favorites tab', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('button', { name: 'Archive' }).click();

  const title = 'US bank pilots a customer service chatbot';
  const article = page.locator('.article', { hasText: title });

  // Wait for the list to render before inspecting the star: checking too early
  // reports "not favourited" for an article that simply is not on screen yet.
  await expect(article).toBeVisible();

  // The suite runs against a persistent local database, so start from a known
  // state rather than assuming this article is not already a favourite.
  const remove = article.getByRole('button', { name: 'Remove favourite' });
  if (await remove.count() > 0) {
    await remove.click();
    await expect(article.getByRole('button', { name: 'Add favourite' })).toBeVisible();
  }

  await article.getByRole('button', { name: 'Add favourite' }).click();
  await expect(article.getByRole('button', { name: 'Remove favourite' })).toBeVisible();

  await page.getByRole('button', { name: 'Favorites' }).click();
  await expect(page.getByText(title)).toBeVisible();
});

test('the HIL Checker triages and exports', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('button', { name: 'Review Queue' }).click();

  await page.getByRole('button', { name: 'To review' }).click();
  await page.getByRole('button', { name: 'Select all shown' }).click();
  await expect(page.getByText(/\d+ selected/)).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^market-lens-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('a scoped user sees only their region and no Admin tab', async ({ page }) => {
  await login(page, SCOPED);

  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('Swiss private banks deploy generative AI copilots')).toBeVisible();
  await expect(
    page.getByText('MAS sets out AI governance expectations for Singapore banks'),
  ).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Admin' })).toHaveCount(0);
});

test('signing out returns to the login form', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

// Static assets are served before the Worker, and the SPA fallback returns
// index.html for any unmatched GET. That swallowed every GET /api/* in
// production — /api/health served the login page — while POSTs still reached
// the Worker, so login failed with a real error pointing at a health check
// that could not be read. run_worker_first in wrangler.toml fixes it; these
// assertions make sure it stays fixed.
test('GET /api/* reaches the Worker rather than the SPA fallback', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.headers()['content-type']).toContain('application/json');
  const body = await res.json();
  // A fully migrated database must report every table present. Checking only
  // `users` once let a half-applied migration report "ok" while login died
  // inserting a session — users is the 5th table the migration creates and
  // sessions the 11th.
  expect(body.missingTables).toEqual([]);
  expect(body.database).toBe('ok');
  expect(body.ok).toBe(true);
});

test('an unknown /api path returns the Worker JSON 404, not index.html', async ({ request }) => {
  const res = await request.get('/api/definitely-not-a-route');
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ error: 'not found' });
});

test('a client-side route still falls back to the SPA', async ({ request }) => {
  const res = await request.get('/favorites');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/html');
});
