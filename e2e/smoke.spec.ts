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
  await expect(page.getByText('Articles in view')).toBeVisible();
  await expect(page.getByRole('img', { name: /By region/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Coverage over time/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /By AI use case/ })).toBeVisible();
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
  await page.getByRole('button', { name: 'HIL Checker' }).click();

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
