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

/**
 * Article rows, excluding the table's empty state.
 *
 * `tbody tr` also matches the "Nothing matches these filters" row, so waiting
 * for a row is satisfied before any data has arrived. That is not theoretical:
 * it is why the drill-down test clicked a cell with no handler on it and why a
 * tile assertion read zero on a page that a moment later showed seven.
 */
const dataRows = (page: import('@playwright/test').Page) =>
  page.locator('table.analysis tbody tr').filter({ has: page.locator('td.cell-title') });

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
  await expect(row.locator('.chip', { hasText: 'P23 – Financial crime prevention' })).toBeVisible();
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

test('the tabs say what they are for, in the order the work is done', async ({ page }) => {
  await login(page, ADMIN);

  const tabs = page.getByRole('navigation', { name: 'Sections' }).getByRole('button');
  await expect(tabs).toHaveText(['Market Lens', 'Review Queue', 'Archive', 'Admin']);

  await page.getByRole('button', { name: 'Review Queue' }).click();
  await expect(page.getByText(/reviewed use-case list/)).toBeVisible();

  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText(/Searching\./)).toBeVisible();
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
  const res = await request.get('/archive');
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
  await expect(dataRows(page)).toHaveCount(1);

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

  // And where the article says nothing — and nobody has reviewed it — the cell
  // says so rather than inventing. (The MAS article used to serve here; it is
  // now reviewed as a grade D, which is itself the point of the review.)
  const quiet = page.locator('table.analysis tbody tr', { hasText: 'US bank pilots a customer' });
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
  await dataRows(page).first().click();
  await expect(page.locator('.drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.drawer')).toHaveCount(0);
});

// The row is a control now, and the link inside it is a different control.
// One click must not fire both.
test('the title link still opens the source without opening the drill-down', async ({ page }) => {
  await login(page, ADMIN);
  const link = dataRows(page).first().locator('.cell-title a');
  await expect(link).toHaveAttribute('target', '_blank');
  await link.click({ modifiers: ['Alt'] });   // Alt-click does not navigate
  await expect(page.locator('.drawer')).toHaveCount(0);
});

test('the Lens opens on the reviewed use cases, strongest grade first', async ({ page }) => {
  await login(page, ADMIN);
  const rows = dataRows(page);

  // A leads, B follows. The fixture grades f2 A and f6 B.
  await expect(rows.nth(0).locator('.grade')).toHaveText('A');
  await expect(rows.nth(1).locator('.grade')).toHaveText('B');

  const titles = await rows.locator('.cell-title a').allInnerTexts();
  const at = (t: string) => titles.findIndex((x) => x.startsWith(t));

  // C outranks an article nobody has read: the Deloitte survey is graded C and
  // the BaFin guidance is unreviewed.
  expect(at('Deloitte survey')).toBeLessThan(at('BaFin publishes guidance'));

  // And the D goes last — below every unreviewed row. The MAS guidance is the
  // fixture's D: a reviewer read it and found no use case, which is the only
  // thing here we *know* to be worthless. An unread article is merely unknown.
  expect(at('MAS sets out AI governance')).toBe(titles.length - 1);
});

// Promise ordering is no longer reachable from the Lens UI — grade is the
// default and no header sorts by promise — but it did not go away: it is the
// tiebreak inside every grade, which is where most of the table now sits.
// Its own assertions live in packages/worker/tests/queries.test.ts, against a
// real SQLite, where they can be stated more precisely than through a page.

test('banking area and bank category leave the filters for the table', async ({ page }) => {
  await login(page, ADMIN);

  // Gone from the filter bar…
  await expect(page.getByRole('button', { name: /^Banking area:/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Bank category:/ })).toHaveCount(0);

  // …and from the statistics.
  await expect(page.getByRole('heading', { name: 'By banking area' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'By bank category' })).toHaveCount(0);

  // Still on the article, where they describe the row rather than slice the
  // market. Removing them from the app entirely would have left the export
  // carrying two columns the page never showed.
  await expect(page.getByRole('columnheader', { name: 'Banking area' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Bank category' })).toBeVisible();

  const wealth = page.locator('table.analysis tbody tr', { hasText: 'private banks deploy' });
  await expect(wealth).toContainText('Private Banking & Wealth');
});

test('no article is unreachable from a filter', async ({ page }) => {
  await login(page, ADMIN);

  // Every fixture carries a region, so this option stands at zero — and it is
  // still offered. An option that appeared only when non-empty would make its
  // absence something the reader has to interpret.
  await page.getByRole('button', { name: /^Region:/ }).click();
  const regionOptions = page.locator('.ms-panel .ms-option');
  await expect(regionOptions.first()).toBeVisible();
  await expect(regionOptions.last()).toContainText('Not classified');
  await expect(regionOptions.last()).toContainText('0');
  await page.keyboard.press('Escape');

  // Six fixtures carry no use-case tag. Before this option they matched no
  // value in this filter at all, so no combination of choices could show them.
  await page.getByRole('button', { name: /^AI use case:/ }).click();
  const useCaseOptions = page.locator('.ms-panel .ms-option');
  await expect(useCaseOptions.first()).toBeVisible();
  const last = useCaseOptions.last();
  await expect(last).toContainText('Not classified');
  const advertised = Number((await last.locator('.ms-count').textContent())?.trim());
  expect(advertised).toBeGreaterThan(0);

  await last.click();
  await page.keyboard.press('Escape');

  // The count the option advertised has to be accounted for on screen. It is no
  // longer one row per article: rows reporting the same bank doing the same
  // thing fold together, so the option counts articles and the table shows use
  // cases. Nothing may go missing in the difference — an option promising 6 and
  // accounting for 4 is a bug nobody can diagnose on screen.
  // Polled, not read once: the filter is applied by a round trip, and a bare
  // count answers for whatever is on screen at the instant it runs.
  await expect.poll(async () => {
    const leads = await dataRows(page).count();
    const folded = (await page.locator('.group-toggle').allInnerTexts())
      .reduce((n, t) => n + Number(/(\d+) more/.exec(t)?.[1] ?? 0), 0);
    return leads + folded;
  }).toBe(advertised);
});

test('the page states how many AI use cases were found', async ({ page }) => {
  await login(page, ADMIN);

  // Wait for the data, not for the tile. Every tile renders at zero while the
  // request is in flight, so reading one immediately asserts on the loading
  // state and fails whatever the real figure is.
  //
  // dataRows, not `tbody tr` — see the helper.
  await expect(dataRows(page).first()).toBeVisible();

  const tile = page.locator('.tile', { hasText: 'AI use cases identified' });
  await expect(tile).toBeVisible();

  // Confirmed means the article describes the use case in its own words and the
  // type of AI is known — the same test that decides what tops the table, so
  // the tile and the ranking cannot disagree.
  const confirmed = Number((await tile.locator('.value').textContent())?.trim());
  expect(confirmed).toBeGreaterThan(0);
  // Reviewed grades where they exist, the rule heuristic where they do not.
  await expect(tile.locator('.note')).toContainText(/deployed · \d+ of \d+ reviewed/);
});

test('the page opens in dark mode without a light flash', async ({ page }) => {
  // Asserted before login and before the bundle has had to do anything: the
  // attribute is set by index.html, because waiting for React to set it is a
  // frame of white on every load.
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Still a choice, not a lock-in.
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();

  await page.getByLabel('Theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // And the choice survives a reload — which is the part the versioned storage
  // key had to not break.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the wide table scrolls in both directions with its edges pinned', async ({ page }) => {
  await login(page, ADMIN);
  const region = page.locator('.table-scroll');
  const title = dataRows(page).first().locator('td.cell-title');

  const before = await title.boundingBox();
  expect(before).not.toBeNull();

  // There is more table than screen in both directions — otherwise the rest of
  // this test would be asserting on a table that never needed to scroll.
  const size = await region.evaluate((el) => ({
    scrollableX: el.scrollWidth > el.clientWidth,
    scrollableY: el.scrollHeight > el.clientHeight,
  }));
  expect(size.scrollableX).toBe(true);
  expect(size.scrollableY).toBe(true);

  await region.evaluate((el) => { el.scrollLeft = el.scrollWidth; el.scrollTop = 200; });

  // The article title has not moved: it is the one column you must still be
  // able to read once you have scrolled right to see the stage.
  const after = await title.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);

  // And the header row has stayed at the top of the scroll region rather than
  // travelling up with the rows. Asserting the position, not mere visibility:
  // a header that has scrolled out of the box can still be "visible" on a page
  // that has not itself been scrolled.
  const head = await page.getByRole('columnheader', { name: 'Article', exact: true })
    .boundingBox();
  const frame = await region.boundingBox();
  expect(head).not.toBeNull();
  expect(frame).not.toBeNull();
  expect(Math.abs(head!.y - frame!.y)).toBeLessThan(2);
});

test('a phone-sized screen does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, ADMIN);

  // The page itself must fit. A table that scrolls inside its own box is the
  // design; a whole page dragging left and right is the bug this guards.
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // Every section is still reachable: the tab strip scrolls rather than
  // wrapping into a wall of buttons.
  await expect(page.getByRole('button', { name: 'Market Lens' })).toBeVisible();
  await expect(page.locator('.filterbar')).toBeVisible();
});

test('recent articles are marked in place, so no tab is needed for them', async ({ page }) => {
  await login(page, ADMIN);

  // f1 is dated within the last week by the fixtures; f7 is months old. The
  // marker has to distinguish them, or it is decoration.
  const fresh = dataRows(page).filter({ hasText: 'private banks deploy' });
  const old = dataRows(page).filter({ hasText: 'BaFin publishes guidance' });

  await expect(fresh.locator('.fresh')).toHaveCount(1);
  await expect(old.locator('.fresh')).toHaveCount(0);

  // It says what it means in words, not as a colour needing a legend.
  await expect(fresh.locator('.fresh')).toHaveText('This week published');
  await expect(fresh.locator('.fresh'))
    .toHaveAttribute('title', 'Published in the last 7 days');
});

test('a decision made in the Archive lands in the Review Queue', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('button', { name: 'Archive' }).click();

  // Through the table and its drill-down, which is the path that had no way to
  // record a decision at all before — the card list has always had its select.
  await page.getByRole('button', { name: 'Table' }).click();
  const title = 'MAS sets out AI governance expectations for Singapore banks';
  await dataRows(page).filter({ hasText: 'MAS sets out AI governance' }).click();

  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Relevant', exact: true }).click();
  await expect(drawer.getByRole('button', { name: 'Relevant', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  // The queue is the record, and it survives a reload rather than living in
  // this page's memory.
  await page.reload();
  await page.getByRole('button', { name: 'Review Queue' }).click();
  await page.getByRole('button', { name: 'Relevant', exact: true }).click();
  await expect(page.getByText(title)).toBeVisible();

  // Put it back, so the suite can run twice against its persistent database.
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('button', { name: 'Table' }).click();
  await dataRows(page).filter({ hasText: 'MAS sets out AI governance' }).click();
  await page.locator('.drawer').getByRole('button', { name: 'Undecided' }).click();
});

test('the coverage chart can be drilled from months to weeks to days', async ({ page }) => {
  await login(page, ADMIN);
  const chart = page.locator('.card', { hasText: 'Coverage over time' });

  // Days is the default: the delta since yesterday is the question the chart is
  // asked most, and a monthly bar cannot answer it.
  await expect(chart.getByRole('button', { name: 'Days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.locator('.subtle').first()).toContainText('articles per day');

  // Each bucket is a real query, not a client-side regrouping, so the label on
  // the axis has to change with it.
  await chart.getByRole('button', { name: 'Months' }).click();
  await expect(chart.getByRole('button', { name: 'Months' })).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.locator('.subtle').first()).toContainText('articles per month');
  await expect(chart.locator('svg')).toHaveAttribute('aria-label', /\d{4}-\d{2}:/);

  await chart.getByRole('button', { name: 'Weeks' }).click();
  await expect(chart.locator('.subtle').first()).toContainText('articles per week');
  // Weeks are labelled by the date they start on, so the axis stays readable.
  await expect(chart.locator('svg')).toHaveAttribute('aria-label', /\d{4}-\d{2}-\d{2}:/);
});

test('the L1 process chart is the second cut, after region', async ({ page }) => {
  await login(page, ADMIN);
  const charts = page.locator('figure.card h2');
  await expect(charts).toHaveText([
    'By region', 'By L1 process', 'By type of AI', 'By AI use case',
  ]);

  // And the process landscape is the supplied P1-P38, not the old shorthand.
  await expect(page.locator('figure.card', { hasText: 'By L1 process' }))
    .toContainText(/P\d+ – /);
});

test('the Lens and the Review Queue say what they are for', async ({ page }) => {
  await login(page, ADMIN);

  // The Lens names the axes it classifies on and the audience it serves. It
  // used to do so across two paragraphs; the summary is two sentences now, so
  // this asserts the two things that had to survive the cut — the process
  // taxonomy by name, and who the reader is meant to be.
  const lens = page.locator('.content');
  await expect(lens).toContainText('P1–P38 process');
  await expect(lens).toContainText(/which processes your peers are automating/);

  await page.getByRole('button', { name: 'Review Queue' }).click();
  const queue = page.locator('.content');
  await expect(queue).toContainText('is this a use case worth putting in front of a bank');
  await expect(queue).toContainText(/AI use-case inventory/);

  // The regression this replaces: the copy still pointed at a tab and a feature
  // that had both been removed, which is worse than saying too little.
  await expect(queue).not.toContainText('This Week');
  await expect(queue).not.toContainText('starring');
});

test('the Sources panel counts what the table below it shows', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('button', { name: 'Admin' }).click();

  // By its heading, not by text: the Roles card lists a "sources.manage"
  // permission, so a substring match finds that one first.
  const panel = page.locator('section.card').filter({
    has: page.getByRole('heading', { name: 'Sources', exact: true }),
  });
  await expect(panel).toBeVisible();

  // A summary that disagrees with the list under it is worse than no summary,
  // so the tile is asserted against the rows rather than against a fixture.
  const configured = panel.locator('.tile', { hasText: 'Sources configured' });
  const stated = Number((await configured.locator('.value').textContent())?.trim());
  await expect(panel.locator('tbody tr')).toHaveCount(stated);

  // Enabled can never exceed configured, whatever the data.
  const enabled = Number(
    (await panel.locator('.tile', { hasText: 'Enabled' }).locator('.value').textContent())?.trim());
  expect(enabled).toBeLessThanOrEqual(stated);

  // Every row says where it stands, not just whether its checkbox is ticked.
  await expect(panel.locator('tbody tr').first().locator('.status')).toBeVisible();
});

test('a reviewed use case is written, graded and still checkable', async ({ page }) => {
  await login(page, ADMIN);

  const row = dataRows(page).filter({ hasText: 'German retail banks cut AML' });
  const cell = row.locator('td.cell-usecase');

  // The written line, not the sentence the term matcher happened to like.
  await expect(cell.locator('.uc-headline'))
    .toHaveText('Deutsche retail — AML transaction monitoring at scale');
  await expect(cell.locator('.grade')).toHaveText('A');

  // And the sentence it was written from, because the line is composed and a
  // composed claim that cannot be checked is worse than a quote.
  await expect(cell.locator('.uc-evidence')).toContainText('deployed machine learning models');
  await expect(cell.locator('.uc-outcome')).toContainText('false positives cut');

  // An article nobody has reviewed still shows the quoted sentence.
  const unreviewed = dataRows(page).filter({ hasText: 'Swiss private banks deploy' });
  await expect(unreviewed.locator('td.cell-usecase .grade')).toHaveCount(0);
});

test('the grade filter separates real use cases from coverage', async ({ page }) => {
  await login(page, ADMIN);

  await page.getByRole('button', { name: /^Use case grade:/ }).click();
  const options = page.locator('.ms-panel .ms-option');
  await expect(options.first()).toBeVisible();
  // "Not reviewed yet" is an option like any other, so no article is stranded.
  await expect(options.last()).toContainText('Not reviewed yet');

  await page.getByRole('option', { name: /A · Deployed/ }).click();
  await page.keyboard.press('Escape');

  // Exactly the deployed one, and none of the commentary the rules used to
  // dress up as a use case.
  await expect(dataRows(page)).toHaveCount(1);
  await expect(dataRows(page).first()).toContainText('German retail banks cut AML');
});

test('the tile reports what was read, not what was inferred', async ({ page }) => {
  await login(page, ADMIN);
  await expect(dataRows(page).first()).toBeVisible();

  const tile = page.locator('.tile', { hasText: 'AI use cases identified' });
  // Two graded A or B out of four reviewed — the fixture's C and D are exactly
  // the articles that must not be counted.
  await expect(tile.locator('.value')).toHaveText('2');
  await expect(tile.locator('.note')).toContainText('1 deployed');
  await expect(tile.locator('.note')).toContainText('reviewed');
});

test('one use case reported by three outlets is one row, foldable', async ({ page }) => {
  await login(page, ADMIN);
  const rows = dataRows(page);
  // allInnerTexts and count do not auto-wait, so the table has to be there
  // before either is read or they answer for an empty page.
  await expect(rows.first()).toBeVisible();

  // f9, f11 and f12 are the same HSBC fraud rollout under three bylines, in two
  // different ISO weeks. Only the lead is a row of its own.
  const titles = await rows.locator('.cell-title a').allInnerTexts();
  expect(titles.filter((t) => t.includes('HSBC'))).toHaveLength(1);

  const lead = rows.filter({ hasText: 'HSBC scales machine learning fraud detection' });
  const toggle = lead.locator('.group-toggle');
  await expect(toggle).toHaveText(/2 more reports of this use case/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // Opening reveals them without opening the drill-down for the row it sits in.
  await expect(page.locator('.drawer')).toHaveCount(0);
  await expect(page.locator('tr.row-member')).toHaveCount(2);

  await toggle.click();
  await expect(page.locator('tr.row-member')).toHaveCount(0);
});

test('clicking a bar filters the whole view to that value', async ({ page }) => {
  await login(page, ADMIN);

  const chart = page.locator('figure.card').filter({ hasText: 'By region' });
  const bar = chart.locator('.bar-row-action').first();
  await expect(bar).toBeVisible();
  const wanted = (await bar.innerText()).split('\n')[0]!.trim();

  await expect(dataRows(page).first()).toBeVisible();
  const before = await dataRows(page).count();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/articles?') && r.ok()),
    bar.click(),
  ]);

  await expect(bar).toHaveAttribute('aria-pressed', 'true');
  await expect(dataRows(page).first().locator('.cell-title .src')).toContainText(wanted);
  expect(await dataRows(page).count()).toBeLessThanOrEqual(before);

  // And the same bar takes it off again — a filter you can only add to is a trap.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/articles?') && r.ok()),
    bar.click(),
  ]);
  await expect(bar).toHaveAttribute('aria-pressed', 'false');
});
