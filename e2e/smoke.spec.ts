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
  for (const heading of ['AI focus', 'Type', 'L1 process', 'Stage']) {
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
  await expect(row.locator('.status', { hasText: 'Production' })).toBeVisible();
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

  await page.getByRole('button', { name: /^Region:/ }).click();
  await page.getByRole('option', { name: /Switzerland/ }).click();
  await page.keyboard.press('Escape');
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
  // And every column a later migration added, for the same reason one level
  // down: article_scores existed while use_case_evidence did not, so health
  // said "ok" and the Lens answered 500.
  expect(body.missingColumns).toEqual([]);
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

test('filter options come with counts and never offer an empty result', async ({ page }) => {
  await login(page, ADMIN);

  // Every option carries a count, and options that would match nothing are
  // simply not offered — that is what makes an empty result unselectable.
  await page.getByRole('button', { name: /^Region:/ }).click();
  const options = page.locator('.ms-panel .ms-option');
  await expect(options.first()).toBeVisible();
  for (const text of await options.allTextContents()) {
    expect(text).toMatch(/\d+$/);
  }
  await page.keyboard.press('Escape');
});

test('choosing a filter narrows the others but not itself', async ({ page }) => {
  await login(page, ADMIN);

  const optionsOf = async (name: string) => {
    await page.getByRole('button', { name: new RegExp(`^${name}:`) }).click();
    // Wait for the panel: reading straight after the click returns an empty
    // list, which then compares as "narrowed" against anything.
    await expect(page.locator('.ms-panel .ms-option').first()).toBeVisible();
    const texts = await page.locator('.ms-panel .ms-option').allTextContents();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ms-panel')).toHaveCount(0);
    return texts;
  };

  const regionsBefore = await optionsOf('Region');
  const typesBefore = await optionsOf('Type of AI');

  await page.getByRole('button', { name: /^Type of AI:/ }).click();
  await page.getByRole('option', { name: /Agentic/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('table.analysis tbody tr')).toHaveCount(1);

  // Regions narrow to those that actually have an agentic article…
  expect((await optionsOf('Region')).length).toBeLessThan(regionsBefore.length);
  // …while the dimension being filtered keeps all of its options, so a second
  // value can still be added rather than replacing the first.
  expect((await optionsOf('Type of AI')).length).toBe(typesBefore.length);
});

test('the table sorts on the server, not just the visible page', async ({ page }) => {
  await login(page, ADMIN);
  const header = page.getByRole('columnheader', { name: /AI focus/ });
  const scores = () => page.locator('table.analysis tbody tr td.num .meter-value').allTextContents();

  // Wait for the response, not the header. aria-sort flips the instant the
  // click is handled, while the rows only change when the server answers —
  // asserting on the header reads the previous order and passes by luck.
  /*
   * Waiting for the response is necessary and not sufficient.
   *
   * aria-sort flips the instant the click is handled, and the response arrives
   * before React has re-rendered the rows, so reading the DOM at either of
   * those moments reads the previous order. This test passed on that race
   * until a later change shifted the timing by a few milliseconds.
   *
   * So poll the rendered numbers until they are both present and in the
   * expected order. That is the only signal that means what the test claims.
   */
  const sortBy = async (dir: 'asc' | 'desc') => {
    await Promise.all([
      page.waitForResponse((r) =>
        r.url().includes('/api/articles?') && r.url().includes(`sortDir=${dir}`) && r.ok()),
      header.getByRole('button').click(),
    ]);
    await expect(header).toHaveAttribute(
      'aria-sort', dir === 'desc' ? 'descending' : 'ascending');

    await expect.poll(async () => {
      const n = (await scores()).map(Number);
      if (n.length === 0) return false;
      const wanted = [...n].sort((a, b) => (dir === 'desc' ? b - a : a - b));
      return n.every((v, i) => v === wanted[i]);
    }, { message: `rows never settled into ${dir} order` }).toBe(true);

    return (await scores()).map(Number);
  };

  const desc = await sortBy('desc');
  expect(desc.length).toBeGreaterThan(1);

  const asc = await sortBy('asc');
  expect(asc.length).toBe(desc.length);

  // And it sorts the whole result, not the page: the top score descending must
  // be the bottom score ascending.
  expect(desc[0]).toBe(asc[asc.length - 1]);
});

test('the use case is quoted from the article, or absent', async ({ page }) => {
  await login(page, ADMIN);
  const row = page.locator('table.analysis tbody tr', { hasText: 'HSBC scales machine learning' });
  await expect(row.locator('.cell-usecase q')).toContainText('rolled out to all retail customers');

  // And where the article says nothing, the cell says so rather than inventing.
  const quiet = page.locator('table.analysis tbody tr', { hasText: 'MAS sets out AI governance' });
  await expect(quiet.locator('.cell-usecase')).toContainText('Not described in the article');
});

test('the archive offers the same table, sorting and export', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.locator('table.analysis')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Excel' })).toBeVisible();
});

// The drill-down. A row used to offer only a link to somebody else's site,
// which is a poor answer to "what did this bank actually do".
test('selecting a row opens the article in place', async ({ page }) => {
  await login(page, ADMIN);

  await page.locator('table.analysis tbody tr', { hasText: 'German retail banks cut AML' })
    .first().click();

  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: /German retail banks cut AML/ })).toBeVisible();

  // The summary is the article's own sentences, so it must be findable in the
  // extract shown below it. A summary that is not a substring of the source is
  // invention, which is the one thing this must never do.
  const summary = (await drawer.locator('.drawer-summary').innerText()).trim();
  const extract = (await drawer.locator('.drawer-extract').innerText()).trim();
  expect(summary.length).toBeGreaterThan(80);
  expect(extract).toContain(summary.slice(0, 60));

  // The evidence behind the labels, not just the labels.
  await expect(drawer).toContainText('In production');
  await expect(drawer.getByRole('link', { name: /Open the original/ })).toBeVisible();
});

test('Escape closes the drill-down', async ({ page }) => {
  await login(page, ADMIN);
  await page.locator('table.analysis tbody tr').first().click();
  await expect(page.locator('.drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.drawer')).toHaveCount(0);
});

// The row is a control now, and the link inside it is a different control.
// One click must not fire both.
test('the title link still opens the source without opening the drill-down', async ({ page }) => {
  await login(page, ADMIN);
  const link = page.locator('table.analysis tbody tr').first().locator('.cell-title a');
  await expect(link).toHaveAttribute('target', '_blank');
  await link.click({ modifiers: ['Alt'] });   // Alt-click does not navigate
  await expect(page.locator('.drawer')).toHaveCount(0);
});

test('the Lens opens on the most promising, not merely the highest scoring', async ({ page }) => {
  await login(page, ADMIN);
  const rows = page.locator('table.analysis tbody tr');

  // Every row above the first incomplete one must carry both a type and a
  // quoted use case: completeness is a tier, not a tiebreak.
  const first = rows.first();
  await expect(first.locator('.chip')).not.toHaveCount(0);
  await expect(first.locator('.cell-usecase q')).toBeVisible();

  // And a lower-scoring complete article outranks a higher-scoring incomplete
  // one — the case the ordering exists for.
  const titles = await rows.locator('.cell-title a').allInnerTexts();
  expect(titles.indexOf('BaFin publishes guidance on machine learning model risk'))
    .toBeLessThan(titles.indexOf('Deloitte survey: generative AI adoption across European banks'));
});
