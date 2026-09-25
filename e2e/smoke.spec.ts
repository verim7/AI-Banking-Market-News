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

/**
 * The Market Lens keeps every dropdown behind a "More filters" disclosure.
 *
 * Native <details>, so the inputs stay in the DOM when it is closed and
 * `getByLabel('From')).toHaveValue(...)` still resolves — but a click needs
 * the control visible, so anything that opens a dropdown opens this first.
 *
 * A no-op where there is no disclosure: the Archive and the Review Queue draw
 * the filter bar plainly, and the helper is called from shared code that runs
 * on all three.
 */
const openMoreFilters = async (page: import('@playwright/test').Page) => {
  const details = page.locator('details.morefilters');
  if (await details.count() > 0 && await details.first().getAttribute('open') === null) {
    await details.first().locator('> summary').click();
  }
  // Always, on every path, including the one where there was no disclosure to
  // open. `count()` does not retry and cannot tell "this page draws the bar
  // plainly" from "the disclosure was renamed" — and a helper that silently
  // does nothing would re-arm exactly the trap this change-set documented in
  // docs/papercuts.md: the four `toHaveCount(0)` assertions downstream would
  // go from proving a control is gone to proving nothing at all.
  await expect(page.locator('.filterbar')).toBeVisible();
};

/**
 * The Lens opens filtered to grades A, B and C — the reviewed use cases and
 * nothing else. Tests that are about something other than grades need the whole
 * fixture set back, and most of the fixtures are unreviewed.
 */
const showEveryGrade = async (page: import('@playwright/test').Page) => {
  await openMoreFilters(page);
  await page.getByRole('button', { name: /^Use case grade:/ }).click();
  // Clearing refetches, and a row from the previous render stays on screen the
  // whole time — so waiting for a row proves nothing, and waiting for any
  // /articles response can be satisfied by one already in flight. The request
  // that carries no grades= is the one this click caused.
  await Promise.all([
    page.waitForResponse((r) =>
      r.url().includes('/api/articles?') && !r.url().includes('grades=') && r.ok()),
    page.getByRole('button', { name: /^Clear use case grade/ }).click(),
  ]);
  await page.keyboard.press('Escape');
  await expect(dataRows(page).first()).toBeVisible();
};

/**
 * Trends & Summary holds what used to sit on top of the Market Lens: the four
 * counts and the coverage-over-time chart. It seeds the same default filters,
 * so its figures and the Lens's table footer describe the same view.
 */
const openTrends = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Trends & Summary' }).click();
  // Waiting for a tile to EXIST is not waiting for data: every tile renders at
  // zero while the request is in flight, which is the same trap `dataRows`
  // exists for on the Lens. This page has no rows to wait for, so wait for the
  // count to stop being zero.
  await expect(page.locator('.tile', { hasText: 'AI articles in view' }).locator('.value'))
    .not.toHaveText('0');
};

test('rejects a bad password', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('invalid email or password')).toBeVisible();
});

test('the Market Lens draws the cuts, and no longer the counts', async ({ page }) => {
  await login(page, ADMIN);
  await expect(page.getByRole('img', { name: /By region/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /By type of AI/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /By L1 process/ })).toBeVisible();

  // The four tiles and the full-width time chart were about 1,200px of context
  // above the first article row. They are worth having and not worth scrolling
  // past forty times a week, so they have their own tab.
  await expect(page.locator('.tile')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /Coverage over time/ })).toHaveCount(0);

  // The headline number people actually quote stays on the page people read.
  await expect(page.locator('.table-head .subtle')).toContainText('in production');
});

test('Trends & Summary carries the counts, the chart and its caveat', async ({ page }) => {
  await login(page, ADMIN);
  await openTrends(page);

  await expect(page.locator('.tile')).toHaveCount(4);
  await expect(page.getByRole('img', { name: /Coverage over time/ })).toBeVisible();

  // Every figure on the page counts news coverage. A page headed "where banks
  // have got to with AI" that does not say so is claiming a survey nobody
  // carried out, so the caveat is asserted rather than trusted to survive.
  await expect(page.getByText(/not what banks have built/)).toBeVisible();

  // The summary reads the numbers out, and always ends by saying how much of
  // it a person actually read.
  const summary = page.locator('.summary-lines');
  await expect(summary).toContainText('distinct AI use cases');
  await expect(summary).toContainText(/reviewed by hand|read and graded by hand/);
});

test('the board names institutions under the stage each one reached',
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, ADMIN);
    await openTrends(page);

    const board = page.locator('.board');
    await expect(board).toBeVisible();

    // Three rungs, in order, and the count as well as the order: [].every() is
    // true, so a board that rendered no stages at all would pass an
    // order-only assertion.
    const stages = board.locator('.board-stage h3');
    await expect(stages).toHaveCount(3);
    const labels = await stages.allInnerTexts();
    expect(labels.map((t) => t.split('\n')[0])).toEqual(
      ['Announced', 'Pilot or testing', 'In production']);

    // Not uppercased. `.card h3` sets 12px uppercase for every card heading in
    // the app, and these headings deliberately opt out — the house sheet
    // forbids capital-letter words and the density exception covers table
    // headers and tile labels, not a new surface.
    const transforms = await stages.evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).textTransform));
    expect(transforms).toHaveLength(3);
    expect(transforms.every((t) => t === 'none')).toBe(true);

    // Every line is a named institution and a named task, both written by a
    // reviewer reading the article. A board entry with one and not the other
    // is the failure this page cannot afford.
    const entries = board.locator('.board-list li');
    const n = await entries.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) {
      const e = entries.nth(i);
      await expect(e.locator('.board-entry a')).not.toBeEmpty();
      await expect(e.locator('.board-task')).not.toBeEmpty();
      // And a mark beside it, logo or initials.
      await expect(e.locator('.inst-mark')).toBeVisible();
    }

    // The in-production count on the board is the same number the tile below
    // it reports. Two counts of one thing on one page is how a page comes to
    // disagree with itself.
    const inProd = board.locator('.board-stage').filter({ hasText: 'In production' });
    await expect(inProd.locator('.board-count')).not.toBeEmpty();
  });

test('the board\'s headline counts what the board shows, legibly', async ({ page }) => {
  await login(page, ADMIN);
  await openTrends(page);

  // The headline and the columns under it are one count. It used to say
  // "4 of 5 articles" over a board of three use cases.
  const key = await page.locator('.board-key').innerText();
  const m = key.match(/^(\d+) of (\d+) named use cases/);
  expect(m, `headline "${key}"`).not.toBeNull();
  const entries = await page.locator('.board-list li').count();
  const running = await page
    .locator('.board-cell[data-stage="in_production"] .board-list li').count();
  expect(Number(m![1])).toBe(running);
  expect(Number(m![2])).toBe(entries);

  // Nothing on the board below the sheet's 14px floor. Its supporting text
  // was 12px when it was built; the count first, because every() over an
  // empty list is true (docs/papercuts.md).
  const sizes = await page.locator('.board .subtle, .board-stage-note, .board-foot')
    .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
  expect(sizes.length).toBeGreaterThanOrEqual(3);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);

  // A four-letter monogram stays inside its tile.
  const spills = await page.locator('.inst-mark').evaluateAll((els) =>
    els.filter((el) => el.scrollWidth > el.clientWidth + 1).length);
  expect(await page.locator('.inst-mark').count()).toBeGreaterThan(0);
  expect(spills).toBe(0);
});

test('the board ranks institutions by size, Tier 1 banks first', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, ADMIN);
  await openTrends(page);

  // The fixtures hold two G-SIBs (Deutsche Bank, HSBC) and a Singapore D-SIB
  // (OCBC), so both bank tiers are present and their order can be read.
  const bands = page.locator('.board-band');
  const keys = await bands.evaluateAll((els) => els.map((el) => el.getAttribute('data-band')));
  expect(keys.slice(0, 2)).toEqual(['tier1', 'tier2']);

  const heads = await page.locator('.board-band-head h4').allInnerTexts();
  expect(heads).toHaveLength(keys.length);
  expect(heads[0]).toMatch(/^Tier 1 banks/);

  const tier1 = await page.locator('.board-band[data-band="tier1"] .board-entry a').allInnerTexts();
  expect(tier1.length).toBeGreaterThan(0);
  expect(tier1.every((n) => ['Deutsche Bank', 'HSBC'].includes(n))).toBe(true);
  await expect(page.locator('.board-band[data-band="tier2"] .board-entry a').first())
    .toHaveText('OCBC');

  // Tier 1 sits above Tier 2 on the page, not just earlier in the DOM.
  const y1 = (await page.locator('.board-band[data-band="tier1"]').boundingBox())!.y;
  const y2 = (await page.locator('.board-band[data-band="tier2"]').boundingBox())!.y;
  expect(y1).toBeLessThan(y2);

  // Every entry is in exactly one band, so the bands and the stage counts
  // describe the same board.
  const inBands = await page.locator('.board-band .board-list li').count();
  const counted = (await page.locator('.board-count').allInnerTexts())
    .reduce((n, t) => n + Number(t), 0);
  expect(inBands).toBeGreaterThan(0);
  expect(inBands).toBe(counted);

  // A cell sits under its own column: the in-production cell of a band starts
  // where the In production head starts.
  const head = await page.locator('.board-stage').filter({ hasText: 'In production' }).boundingBox();
  const cell = await page.locator('.board-band').first()
    .locator('.board-cell[data-stage="in_production"]').boundingBox();
  expect(Math.abs(head!.x - cell!.x)).toBeLessThan(2);

  // Sentence case, like every other heading on the board.
  const transforms = await page.locator('.board-band-head h4').evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).textTransform));
  expect(transforms.length).toBeGreaterThan(0);
  expect(transforms.every((t) => t === 'none')).toBe(true);
});

test('the approved weekly brief sits above the board, labelled as AI-written', async ({ page }) => {
  await login(page, ADMIN);
  await openTrends(page);

  const brief = page.locator('section.brief');
  await expect(brief).toBeVisible();
  await expect(brief.getByRole('heading')).toContainText('This week\u2019s brief');
  const lines = brief.locator('.brief-lines li');
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toContainText('HSBC now scores every retail transaction');
  // The one paragraph on the page a model wrote says so, where it is read.
  await expect(brief.locator('.brief-note')).toContainText('Written with AI');

  // Above the board, which stays the page's subject.
  const y = (await brief.boundingBox())!.y;
  expect(y).toBeLessThan((await page.locator('section.board').boundingBox())!.y);
});

test('the board admits only reviewed use cases, and says what it leaves out',
  async ({ page }) => {
    await login(page, ADMIN);
    await openTrends(page);

    // The footer states the two things a reader would otherwise have to guess:
    // how many entries there are, and that the page read a bounded number of
    // articles to find them.
    const foot = page.locator('.board-foot');
    await expect(foot).toContainText(/\d+ reviewed use cases with a named institution/);
    await expect(foot).toContainText('written by a reviewer reading the article');

    // The caveat is above the bank names, not in a footnote. A board of named
    // institutions is exactly where "this counts coverage, not the market"
    // has to be visible.
    const caveat = page.locator('.board .subtle', { hasText: 'not what banks have built' });
    await expect(caveat).toBeVisible();
    expect((await caveat.boundingBox())!.y)
      .toBeLessThan((await page.locator('.board-stages').boundingBox())!.y);
  });

test('on a phone the stages stack and the arrows go', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, ADMIN);
  await openTrends(page);

  const stages = page.locator('.board-stage');
  const first = await stages.first().boundingBox();
  const last = await stages.last().boundingBox();
  expect(first).not.toBeNull();
  expect(last).not.toBeNull();
  // Stacked, not side by side: same x, further down.
  expect(Math.abs(last!.x - first!.x)).toBeLessThan(2);
  expect(last!.y).toBeGreaterThan(first!.y);

  // A left-to-right arrow between stacked columns points at nothing.
  await expect(page.locator('.board-arrow').first()).toBeHidden();

  // Stacked, a cell names its stage itself — the column head is a screen
  // away — and a cell with nothing in it is not shown at all.
  const labels = page.locator('.board-cell:not(.is-empty) .board-cell-label');
  expect(await labels.count()).toBeGreaterThan(0);
  await expect(labels.first()).toBeVisible();
  await expect(page.locator('.board-cell.is-empty').first()).toBeHidden();

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('the Lens lists every article with its AI analysis', async ({ page }) => {
  await login(page, ADMIN);

  const table = page.locator('table.analysis');
  await expect(table).toBeVisible();
  // Type of AI is not among them: it is a breakdown in the right pane and the
  // quoted use-case sentence usually names the technique, so the column mostly
  // repeated the row. Stage very much is — it carries the sentence its claim
  // was read from, which is what the assertions below check.
  for (const heading of ['AI focus', 'L1 process', 'Stage']) {
    await expect(table.getByRole('columnheader', { name: heading })).toBeVisible();
  }
  await expect(table.getByRole('columnheader', { name: 'Type', exact: true })).toHaveCount(0);

  // The row carries the classifier's judgements, not just the headline.
  const row = table.locator('tr', {
    hasText: 'German retail banks cut AML false positives with machine learning',
  });
  await expect(row).toBeVisible();
  await expect(row.locator('.chip', { hasText: 'P23 – Financial crime prevention' })).toBeVisible();
  await expect(row.locator('.status', { hasText: 'Production' })).toBeVisible();
  // The stage claim must show the phrase it was read from.
  await expect(row.locator('.evidence')).toContainText('deployed across');

  // The AI type is read for every article and is no longer a column here, so
  // it has to be somewhere a reader can reach in one click. Targeted as a chip
  // rather than as text: this headline contains the words "machine learning"
  // itself, so a text match would hit the title too.
  await row.click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.chip', { hasText: 'Machine Learning' })).toBeVisible();
});

test('the Lens opens where the collection starts, not on the last few days', async ({ page }) => {
  await login(page, ADMIN);
  // A fixed date rather than a rolling window: the backfill before it is too
  // sparse to read as a trend. Asserted exactly, so moving it is a decision.
  await expect(page.getByLabel('From')).toHaveValue('2026-07-01');

  // The window is spelled out beside the count it applies to, which is now on
  // Trends & Summary — and that page has to seed the same default, or the two
  // tabs report different totals for one database.
  await openTrends(page);
  await expect(page.getByLabel('From')).toHaveValue('2026-07-01');
  await expect(page.locator('.tile .note', { hasText: 'published since 2026-07-01' }))
    .toBeVisible();
});

test('the masthead names the house, on every tab and at every width',
  async ({ page }) => {
    await login(page, ADMIN);
    const mast = page.locator('.topbar h1');

    // It lives in the app shell, so it survives every tab — asserted on three
    // rather than assumed, because "always at the top" is the requirement.
    for (const tab of ['Market Lens', 'Trends & Summary', 'Archive']) {
      await page.getByRole('button', { name: tab }).click();
      await expect(mast).toContainText('Synpulse');
      await expect(mast).toContainText('AI Banking Tracker');
    }

    // The tab title too: it is the one string that proves which bundle is
    // being served without signing in.
    await expect(page).toHaveTitle('Synpulse · AI Banking Tracker');

    // Not uppercased, by any rule at any depth. The format sheet this app is
    // built from says "DON'T USE CAPITAL LETTER WORDS" and names Synpulse
    // among the words to capitalise normally — and the wordmark carried an
    // inherited `text-transform: uppercase` until the rebrand. A house rule
    // that nothing can fail is a house rule nobody keeps.
    const transforms = await mast.locator('span').evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).textTransform));
    // The count first. `[].every(…)` is `true`, so restructuring the masthead
    // out from under this locator would delete the guarantee and leave the
    // test green — which is the same vacuous-assertion trap this change-set
    // wrote up in docs/papercuts.md, one file away.
    expect(transforms.length).toBeGreaterThanOrEqual(3);
    expect(transforms.every((t) => t === 'none')).toBe(true);

    // And it survives a phone without shrinking under the 14px floor or
    // pushing the bar off the screen.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(mast).toBeVisible();
    const sizes = await mast.locator('.wordmark span').evaluateAll((els) =>
      els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
    // Likewise: `Math.min()` of nothing is Infinity, which clears any floor.
    expect(sizes.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

test('the tabs say what they are for, in the order the work is done', async ({ page }) => {
  await login(page, ADMIN);

  const tabs = page.getByRole('navigation', { name: 'Sections' }).getByRole('button');
  await expect(tabs).toHaveText(
    ['Market Lens', 'Trends & Summary', 'Review Queue', 'Archive', 'Admin']);

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

  await openMoreFilters(page);
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

  // The whole tab list, not three absences: an assertion that a tab is missing
  // passes just as well when the nav failed to render at all.
  const tabs = page.getByRole('navigation', { name: 'Sections' }).getByRole('button');
  await expect(tabs).toHaveText(['Market Lens', 'Trends & Summary', 'Archive']);
});

test('administrators see the internal tabs, muted', async ({ page }) => {
  await login(page, ADMIN);
  const nav = page.getByRole('navigation', { name: 'Sections' });

  const internal = nav.locator('button.tab-internal');
  await expect(internal).toHaveText(['Review Queue', 'Admin']);
  // And the everyday ones are not muted — the difference is the whole signal.
  await expect(nav.getByRole('button', { name: 'Market Lens' })).not.toHaveClass(/tab-internal/);

  // Muted is not disabled. An administrator still works in these.
  await nav.getByRole('button', { name: 'Review Queue' }).click();
  await expect(nav.getByRole('button', { name: 'Review Queue' }))
    .toHaveAttribute('aria-current', 'page');
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

  // Anonymous callers get the verdict and nothing else. The endpoint used to
  // answer everyone with the table list, the column list, whether
  // SESSION_SECRET was set and how many users existed — reconnaissance for
  // anyone who asked, and sixteen database queries per unauthenticated
  // request. Both halves of that are now behind a session, and the full
  // diagnosis is asserted in the test below.
  expect(body).toEqual({ ok: true });
});

// Split from the test above rather than continued inside it, because the two
// halves need different clients. The session cookie is `Secure`, which is
// right in production and means Playwright's APIRequestContext will not send
// it to an http:// dev origin. Chromium will, because it treats localhost as
// trustworthy — so the request is made from inside the page, which is also
// exactly the path the app itself takes.
test('a signed-in caller still gets the full migration diagnosis', async ({ page }) => {
  await login(page, ADMIN);
  const full = await page.evaluate(
    () => fetch('/api/health', { credentials: 'same-origin' }).then((r) => r.json()));

  // A fully migrated database must report every table present. Checking only
  // `users` once let a half-applied migration report "ok" while login died
  // inserting a session — users is the 5th table the migration creates and
  // sessions the 11th.
  expect(full.missingTables).toEqual([]);
  // And every column a later migration added, for the same reason one level
  // down: article_scores existed while use_case_evidence did not, so health
  // said "ok" and the Lens answered 500.
  expect(full.missingColumns).toEqual([]);
  expect(full.database).toBe('ok');
  expect(full.ok).toBe(true);
  // The detail is the point of being signed in: an anonymous caller sees none
  // of these keys, so a test that only checked `ok` would pass either way.
  expect(full.sessionSecret).toBe(true);
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
  await openMoreFilters(page);
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
  await showEveryGrade(page);

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
  const rowsBefore = await dataRows(page).count();

  await openMoreFilters(page);
  await page.getByRole('button', { name: /^Type of AI:/ }).click();
  // The count has to be read after the refetch lands. count() does not retry,
  // so reading it straight after the click returns the pre-filter number and
  // the assertion compares the old list against itself.
  await Promise.all([
    page.waitForResponse((r) =>
      r.url().includes('/api/articles?') && r.url().includes('aiTypes=agentic_ai') && r.ok()),
    page.getByRole('option', { name: /Agentic/ }).click(),
  ]);
  await page.keyboard.press('Escape');
  // Narrowed, not emptied. A count pinned to the fixture set instead broke the
  // day a fixture was added for something else entirely, which told nobody
  // anything about whether filtering works.
  await expect(dataRows(page).first()).toBeVisible();
  await expect.poll(() => dataRows(page).count()).toBeLessThan(rowsBefore);

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
    const [response] = await Promise.all([
      // Match the sort KEY as well as the direction. Matching the direction
      // alone was unambiguous only while the page opened on aiIntensity
      // descending, so the first click could only produce ascending. The Lens
      // now opens on published descending — which also matches `sortDir=desc`
      // — and this waiter would settle on the page-load response and compare
      // a date-ordered list against an AI-focus-ordered one.
      page.waitForResponse((r) =>
        r.url().includes('/api/articles?')
        && r.url().includes('sort=aiIntensity')
        && r.url().includes(`sortDir=${dir}`) && r.ok()),
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

    const body = await response.json() as { articles: { aiIntensity: number }[] };
    return { rendered: (await scores()).map(Number), served: body.articles.map((a) => a.aiIntensity) };
  };

  // Descending first. The Lens opens sorted by DATE now, so AI focus is a new
  // column and a new column starts descending — the old order asked for
  // ascending and waited ten seconds for a request the click would never make.
  // Whichever way round it is, this comment has to match the page's default
  // sort, which is the thing that changed.
  const desc = await sortBy('desc');
  expect(desc.rendered.length).toBeGreaterThan(1);

  const asc = await sortBy('asc');
  expect(asc.rendered.length).toBe(desc.rendered.length);

  // And it sorts the whole result, not the page: the top score descending must
  // be the bottom score ascending.
  //
  // Asserted on what the server returned, not on what the table drew. Rows
  // reporting the same use case fold into one, and the lead of a folded group
  // is whichever member the current sort put first — so under ascending the
  // group shows its weakest article and under descending its strongest, and
  // the rendered ends legitimately differ. The claim this test makes is about
  // the ordering, which is the server's, so it reads the server's answer.
  expect(desc.served[0]).toBe(asc.served[asc.served.length - 1]);
});

test('the use case is quoted from the article, or absent', async ({ page }) => {
  await login(page, ADMIN);
  await showEveryGrade(page);
  // Whichever of the three HSBC reports leads the fold, the cell shows a
  // sentence somebody can check — that is the claim, not which byline won.
  // Targeted by the use case rather than by a headline, because the lead is
  // now the member that describes it best rather than the one the sort
  // happened to deliver first.
  const row = dataRows(page).filter({ hasText: 'HSBC' });
  await expect(row.locator('.cell-usecase q')).toContainText('retail transaction');

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

// Grade ordering has no column header to drive it — the Lens opens on AI focus
// now — so it is asserted in packages/worker/tests/queries.test.ts against a
// real SQLite, where the A/B/C/unreviewed/D order and its promise tiebreak can
// be stated far more precisely than by reading rows off a page.

// Promise ordering is no longer reachable from the Lens UI — grade is the
// default and no header sorts by promise — but it did not go away: it is the
// tiebreak inside every grade, which is where most of the table now sits.
// Its own assertions live in packages/worker/tests/queries.test.ts, against a
// real SQLite, where they can be stated more precisely than through a page.

test('banking area and bank category leave the filters for the table', async ({ page }) => {
  await login(page, ADMIN);
  await showEveryGrade(page);

  // Gone from the filter bar…
  // Opened first, and this is not housekeeping: `getByRole` reads the
  // accessibility tree, which excludes anything hidden by CSS. With the
  // disclosure closed these assertions would pass whether the dropdowns had
  // been removed or not — a test that cannot fail.
  await openMoreFilters(page);
  await expect(page.getByRole('button', { name: /^Banking area:/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Bank category:/ })).toHaveCount(0);

  // …and from the statistics.
  await expect(page.getByRole('heading', { name: 'By banking area' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'By bank category' })).toHaveCount(0);

  // …and not columns on the Lens either, which opens on seven rather than ten.
  await expect(page.getByRole('columnheader', { name: 'Banking area' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Bank category' })).toHaveCount(0);

  // Still columns in the Archive, which is the place for looking something up
  // rather than reading the market — removing them from the app entirely would
  // have left the export carrying two columns no page ever showed.
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('columnheader', { name: 'Banking area' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Bank category' })).toBeVisible();

  const wealth = page.locator('table.analysis tbody tr', { hasText: 'private banks deploy' });
  await expect(wealth).toContainText('Private Banking & Wealth');

  // …and on the article itself, which is where a reader looks when the table is
  // not carrying the columns. The Market Lens drops both to make room for the
  // use cases, so the drawer is what stops that from losing them — and this
  // assertion is what stops the drawer from quietly losing them too.
  await wealth.first().click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Banking area', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Bank category', { exact: true })).toBeVisible();
  await expect(drawer).toContainText('Private Banking & Wealth');
});

test('no article is unreachable from a filter', async ({ page }) => {
  await login(page, ADMIN);
  // Facet counts are computed under the other active filters, and the Lens
  // opens filtered to two grades — so the counts this asserts on have to be
  // taken over the whole fixture set.
  await showEveryGrade(page);

  // The option is offered whatever its count. It stood at zero for a long time
  // because every fixture carried a region; f14 — a Swiss vendor story the
  // region tag misses, which is the Swiss tab's whole argument — made it one.
  // The count is not the invariant. Being offered is: an option that appeared
  // only when non-empty would make its absence something the reader has to
  // interpret, and the article behind it unreachable from any filter.
  await openMoreFilters(page);
  await page.getByRole('button', { name: /^Region:/ }).click();
  const regionOptions = page.locator('.ms-panel .ms-option');
  await expect(regionOptions.first()).toBeVisible();
  await expect(regionOptions.last()).toContainText('Not classified');
  await page.keyboard.press('Escape');

  // Some fixtures carry no L1 process tag. Before this option they matched no
  // value in this filter at all, so no combination of choices could show them.
  // (This used the AI use case filter until that filter was removed for
  // overlapping the process taxonomy; the invariant belongs to every filter.)
  await openMoreFilters(page);
  await page.getByRole('button', { name: /^L1 process:/ }).click();
  const processOptions = page.locator('.ms-panel .ms-option');
  await expect(processOptions.first()).toBeVisible();
  const last = processOptions.last();
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
  // The tiles live on Trends & Summary now. Waiting for one to be visible is
  // waiting for the data: every tile renders at zero while the request is in
  // flight, so reading one immediately asserts on the loading state.
  await openTrends(page);

  const tile = page.locator('.tile', { hasText: 'AI use cases identified' });
  await expect(tile).toBeVisible();

  // Confirmed means the article describes the use case in its own words and the
  // type of AI is known — the same test that decides what tops the table, so
  // the tile and the ranking cannot disagree.
  const confirmed = Number((await tile.locator('.value').textContent())?.trim());
  expect(confirmed).toBeGreaterThan(0);
  // Reviewed grades where they exist, the rule heuristic where they do not —
  // and the article count they were folded from, so a use-case figure lower
  // than "AI articles in view" reads as folding rather than as loss.
  await expect(tile.locator('.note')).toContainText(/from \d+ reports · \d+ deployed/);
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
  // The Archive, not the Lens. The Lens dropped to seven columns and now fits
  // a laptop without scrolling sideways at all — which is the point of that
  // change and would make this test assert on a table that never needed to
  // scroll. The Archive keeps all ten, so the frozen-edge behaviour still has
  // somewhere real to be tested.
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.locator('table.analysis')).toBeVisible();
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

  // And so is every filter. On a phone the disclosure earns the most — the bar
  // was 185px of dropdowns above the first article — so what is asserted here
  // is that closing it hid nothing: the search box is out in the open, and one
  // click brings the rest back.
  await expect(page.getByLabel('Search')).toBeVisible();
  await expect(page.locator('.filterbar')).toBeHidden();
  await openMoreFilters(page);
  await expect(page.locator('.filterbar')).toBeVisible();
});

test('recent articles are marked in place, so no tab is needed for them', async ({ page }) => {
  await login(page, ADMIN);
  await showEveryGrade(page);

  // f1 is dated within the last week by the fixtures; f7 is months old. The
  // marker has to distinguish them, or it is decoration.
  const fresh = dataRows(page).filter({ hasText: 'private banks deploy' });
  const old = dataRows(page).filter({ hasText: 'BaFin publishes guidance' });

  await expect(fresh.locator('.fresh')).toHaveCount(1);
  await expect(old.locator('.fresh')).toHaveCount(0);

  // It says what it means in words, not as a colour needing a legend. The
  // words are shorter than they were — the badge now sits under the date in
  // the frozen first column, where "published" is both redundant and wider
  // than the column. The title attributes still carry the precise claim.
  await expect(fresh.locator('.fresh')).toHaveText('This week');
  await expect(fresh.locator('.fresh'))
    .toHaveAttribute('title', 'Published in the last 7 days');

  // And it is in the date cell, not the headline cell. Date and recency are
  // one fact; reading them from opposite ends of a row was the arithmetic this
  // redesign removed.
  await expect(fresh.locator('td.cell-date .fresh')).toHaveCount(1);

  // The second band, nine days back in the fixtures. Two markers are only
  // worth having if a reader can tell them apart, so the words differ and the
  // class differs — the colour is never the only thing carrying the meaning.
  const lastWeek = dataRows(page).filter({ hasText: 'US bank pilots' });
  await expect(lastWeek.locator('.fresh')).toHaveText('Last week');
  await expect(lastWeek.locator('.fresh'))
    .toHaveAttribute('title', 'Published 7 to 14 days ago');
  await expect(lastWeek.locator('.fresh.last-week')).toHaveCount(1);
  await expect(fresh.locator('.fresh.last-week')).toHaveCount(0);
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
  await openTrends(page);
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
  await expect(charts).toHaveText(['By region', 'By L1 process (P1–P38)', 'By type of AI']);

  // And the process landscape is the supplied P1-P38, not the old shorthand.
  const chart = page.locator('figure.card', { hasText: 'By L1 process' });
  await expect(chart).toContainText(/P\d+ – /);

  // Every label is readable in full. The column used to be a fixed 190px with
  // an ellipsis, which cut exactly the words that tell P28 from P29.
  const labels = chart.locator('.bar-row > span:first-child');
  const clipped = await labels.evaluateAll((els) =>
    els.filter((el) => el.scrollWidth > el.clientWidth + 1
                    || el.scrollHeight > el.clientHeight + 1).length);
  expect(clipped).toBe(0);
});

test('the Lens and the Review Queue say what they are for', async ({ page }) => {
  await login(page, ADMIN);

  // The Lens names the axes it classifies on and the audience it serves. It
  // used to do so across two paragraphs above the filters; that is one line
  // and a chip row now, so this asserts the things that had to survive the
  // cut — the process taxonomy by name, and who the reader is meant to be.
  const lens = page.locator('.content');
  // The taxonomy is named in the L1 chart's own title now, beside the thing it
  // describes, rather than in a lede sentence above the page.
  await expect(lens).toContainText('P1–P38');
  // What has to survive every trim: the process taxonomy by name, and what the
  // grade letters mean, since the view opens filtered to them and an
  // unexplained letter is worse than none. The chip explains the letter it
  // carries; the note beside it says where everything else went, in words
  // rather than in a second letter.
  await expect(filterChip(page, 'A · AI use case')).toBeVisible();
  await expect(lens).toContainText('Market news and unread articles are one click away');

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
  await showEveryGrade(page);

  await openMoreFilters(page);
  await page.getByRole('button', { name: /^Use case grade:/ }).click();
  const options = page.locator('.ms-panel .ms-option');
  await expect(options.first()).toBeVisible();
  // "Not reviewed yet" is an option like any other, so no article is stranded.
  await expect(options.last()).toContainText('Not reviewed yet');

  await page.getByRole('option', { name: /A · AI use case/ }).click();
  await page.keyboard.press('Escape');

  // The three use cases, and none of the news the rules used to dress up as
  // one. Three rows for five articles: the HSBC rollout is graded A under
  // three bylines and folds to a single lead.
  await expect(dataRows(page)).toHaveCount(3);
  // Filtered rather than order-matched: toContainText with an array pins the
  // order too, and the order is the reader's choice, which is not what this
  // asserts. The HSBC fold is matched on the institution rather than on a
  // headline — which of its three bylines leads is decided by how fully each
  // describes the use case, not by anything this test is about.
  await expect(dataRows(page).filter({ hasText: 'German retail banks cut AML' }))
    .toHaveCount(1);
  await expect(dataRows(page).filter({ hasText: 'HSBC' })).toHaveCount(1);
  await expect(dataRows(page).filter({ hasText: /Deloitte survey|BaFin/ })).toHaveCount(0);
});

test('the tile reports what was read, not what was inferred', async ({ page }) => {
  await login(page, ADMIN);
  await openTrends(page);

  const tile = page.locator('.tile', { hasText: 'AI use cases identified' });

  // Five articles graded A, and three use cases: the HSBC fraud rollout is one
  // use case reported by three outlets. The fixture's B rows — the survey and
  // the supervisory guidance — must not be counted at all.
  //
  // The two figures being different is the assertion. When this tile counted
  // articles it read "5 AI articles in view" beside "5 AI use cases
  // identified", which is the same number wearing two labels.
  await expect(tile.locator('.value')).toHaveText('3');
  await expect(tile.locator('.note')).toContainText('from 5 reports');
  // Deployed reads the Stage column: Deutsche and HSBC are live, the OCBC
  // credit-memo work is a pilot and is still a use case.
  await expect(tile.locator('.note')).toContainText('2 deployed');

  const inView = page.locator('.tile', { hasText: 'AI articles in view' });
  expect(Number((await inView.locator('.value').textContent())?.trim()))
    .toBeGreaterThan(Number((await tile.locator('.value').textContent())?.trim()));
});

test('the table footer reconciles with the use-case tile', async ({ page }) => {
  await login(page, ADMIN);
  await expect(dataRows(page).first()).toBeVisible();

  // The table folds the rows it has loaded; the tile counts the whole view.
  // On the default Lens every row is loaded, so the two must state the same
  // number — a reader comparing them is the first person to find a drift.
  //
  // They are on two tabs now, which makes this the test that proves Trends &
  // Summary seeds identical default filters. If it ever opens on a different
  // window, this is what says so.
  const footer = (await page.locator('.table-head .subtle').textContent()) ?? '';
  const shownOnLens = /(\d+) use cases/.exec(footer)?.[1];
  expect(shownOnLens).toBeTruthy();

  await openTrends(page);
  const tile = page.locator('.tile', { hasText: 'AI use cases identified' });
  await expect(tile.locator('.value')).toHaveText(shownOnLens!);
});

test('one use case reported by three outlets is one row, foldable', async ({ page }) => {
  await login(page, ADMIN);
  await showEveryGrade(page);
  const rows = dataRows(page);
  // allInnerTexts and count do not auto-wait, so the table has to be there
  // before either is read or they answer for an empty page.
  await expect(rows.first()).toBeVisible();

  // f9, f11 and f12 are the same HSBC fraud rollout under three bylines, in two
  // different ISO weeks. Only the lead is a row of its own — and which of the
  // three leads is decided by how fully it describes the use case, not by the
  // sort, so this asserts on the fold rather than on a headline.
  const titles = await rows.locator('.cell-title a').allInnerTexts();
  expect(titles.filter((t) => t.includes('HSBC'))).toHaveLength(1);

  const lead = rows.filter({ hasText: 'HSBC' });
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

test('the breakdowns sit beside the table, and filter it from there',
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, ADMIN);
    await expect(dataRows(page).first()).toBeVisible();

    // Beside, not above: this is the whole point of the pane, and x is the
    // only assertion that can tell the two apart.
    const pane = await page.locator('.lens-pane').boundingBox();
    const table = await page.locator('.table-scroll').boundingBox();
    expect(pane).not.toBeNull();
    expect(table).not.toBeNull();
    expect(pane!.x).toBeGreaterThan(table!.x + table!.width - 1);

    // The page itself must still fit. A <table> in a plain `1fr` grid column
    // widens the grid to its own min-content width and gives the whole page a
    // sideways scrollbar; `minmax(0, 1fr)` keeps the overflow inside
    // .table-scroll, where it is the design.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // A bar still filters, and now says so in the chip row — which is the
    // other half of the trade: the chart moved out of the reading path, so the
    // filter it applies has to be visible from where the reader is.
    const bar = page.locator('.lens-pane figure.card')
      .filter({ hasText: 'By region' }).locator('.bar-row-action').first();
    const wanted = (await bar.innerText()).split('\n')[0]!.trim();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/articles?') && r.ok()),
      bar.click(),
    ]);

    const chip = filterChip(page, wanted);
    await expect(chip).toBeVisible();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/articles?') && r.ok()),
      chip.getByRole('button').click(),
    ]);
    await expect(chip).toHaveCount(0);
    await expect(bar).toHaveAttribute('aria-pressed', 'false');
  });

test('the pane can be collapsed, and stays collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, ADMIN);

  // Frozen Date and Article cost about 370px permanently, so on a 1366 laptop
  // the pane and the table compete for the same width. Giving the table all of
  // it is one click, and worth remembering.
  await page.getByRole('button', { name: 'Hide breakdowns' }).click();
  await expect(page.locator('.lens-pane figure.card')).toHaveCount(0);

  await page.reload();
  await expect(dataRows(page).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Breakdowns', exact: true })).toBeVisible();
  await expect(page.locator('.lens-pane figure.card')).toHaveCount(0);

  // Left as found, as the rest of this suite does with remembered settings.
  await page.getByRole('button', { name: 'Breakdowns', exact: true }).click();
  await expect(page.locator('.lens-pane figure.card').first()).toBeVisible();
});

test('on a phone the breakdowns are below the table, and closed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, ADMIN);
  await expect(dataRows(page).first()).toBeVisible();

  // Source order is what a narrow screen gets, and a pane floating above the
  // rows would be the original complaint — context before content — in a new
  // shape. So it is a different tree, not the same one restyled: a <details>
  // under the table, which is also what a screen reader walks past rather than
  // through.
  await expect(page.locator('.lens-pane')).toHaveCount(0);
  const table = await page.locator('table.analysis').boundingBox();
  const details = await page.locator('.lens-breakdowns').boundingBox();
  expect(table).not.toBeNull();
  expect(details).not.toBeNull();
  expect(details!.y).toBeGreaterThan(table!.y);

  await expect(page.locator('.lens-breakdowns figure.card').first()).toBeHidden();
  await page.locator('.lens-breakdowns > summary').click();
  await expect(page.locator('.lens-breakdowns figure.card').first()).toBeVisible();
});

test('the Lens opens on the reviewed use cases only, and says what the grades mean',
  async ({ page }) => {
    await login(page, ADMIN);

    const lens = page.locator('.content');
    await expect(filterChip(page, 'A · AI use case')).toBeVisible();
    await expect(lens).toContainText('Market news and unread articles');

    // A only. B is the AI news around the use cases — a research unit, an
    // adoption programme, a vendor launch — and it belongs one click away
    // rather than mixed into a table that claims to show peers doing things.
    // One selection names itself rather than counting: "A · AI use case" is
    // shorter than "1 selected" and says which one.
    await openMoreFilters(page);
    await expect(page.getByRole('button', { name: /^Use case grade:/ }))
      .toContainText('A · AI use case');

    await expect(dataRows(page).first()).toBeVisible();
    const titles = await dataRows(page).locator('.cell-title a').allInnerTexts();
    // The fixture's D (MAS guidance), its B market-news row and the OCBC pilot
    // that is a B are all out; only the use cases remain.
    expect(titles.some((t) => t.startsWith('MAS sets out AI governance'))).toBe(false);
    expect(titles.some((t) => t.startsWith('Deloitte survey'))).toBe(false);
    expect(titles.some((t) => t.startsWith('BaFin publishes'))).toBe(false);
  });

/** A chip in the active-filter row, by the text it reads. */
const filterChip = (page: import('@playwright/test').Page, text: string | RegExp) =>
  page.locator('.fchip').filter({ hasText: text });

test('the Lens opens on the use cases, not on a page of context', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, ADMIN);
  await expect(dataRows(page).first()).toBeVisible();

  // The measurement the whole redesign exists for, and the one number that
  // would have failed before it. Baseline on this viewport was y=1239 — an
  // h2, a four-line pitch, a four-line note about the date window, a 185px
  // filter bar, four tiles and two charts before any article. The counts and
  // the coverage chart moved to Trends & Summary, the prose became a chip row,
  // and the dropdowns went behind a disclosure.
  //
  // A ratchet. It measures 270 now — the duplicate heading, the lede and the
  // table's own capitalised title are gone — against 358 before that pass and
  // 1239 when this work started, a viewport and a third of heading, prose,
  // filters, tiles and charts before the first article. The threshold keeps
  // headroom for the chip row wrapping under another font. Lower it as the
  // page improves, never raise it.
  const table = await page.locator('table.analysis').boundingBox();
  expect(table).not.toBeNull();
  expect(table!.y).toBeLessThan(340);
});

test('each row leads with the use case, and the whole table fits a laptop',
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, ADMIN);
    const first = dataRows(page).first();
    await expect(first).toBeVisible();

    // Who did what, first and at full width; the article it came from
    // underneath as its source. They used to be two columns, and the use case
    // got 150px of a row the journalist's headline was wider than.
    const lead = first.locator('td.cell-lead');
    await expect(lead.locator('.lead-headline')).not.toBeEmpty();
    await expect(lead.locator('a')).toHaveCount(1);

    // Every column, including Stage at the far right, on a 1440 laptop with the
    // breakdown pane open. It overflowed by about 100px before the merge.
    const overflow = await page.locator('.table-scroll').evaluate(
      (el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole('columnheader', { name: 'Stage' })).toBeInViewport();
  });

test('changing a filter dims the rows in place instead of moving the page',
  async ({ page }) => {
    await login(page, ADMIN);
    await expect(dataRows(page).first()).toBeVisible();
    const before = (await page.locator('table.analysis').boundingBox())!.y;

    // Hold the next list request so the in-between state can be looked at.
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/api/articles?*', async (route) => {
      await held;
      await route.continue();
    });

    await filterChip(page, 'A · AI use case').getByRole('button').click();

    // The old rows stay, dimmed, and nothing above them moved. The page used
    // to insert a "Loading…" line here, which pushed the table down and back
    // up again on every change.
    await expect(page.locator('.table-scroll.is-loading')).toBeVisible();
    expect((await page.locator('table.analysis').boundingBox())!.y).toBe(before);
    await expect(page.locator('table.analysis')).toHaveAttribute('aria-busy', 'true');

    release();
    // Wait for the held handler to finish passing its request on; removing the
    // route under it would hand the same request to Playwright twice.
    await page.unrouteAll({ behavior: 'wait' });
    await expect(page.locator('.table-scroll.is-loading')).toHaveCount(0);
  });

test('motion stops for readers who have asked for less of it', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await login(page, ADMIN);
  await showEveryGrade(page);

  const toggle = page.locator('.group-toggle').first();
  await expect(toggle).toBeVisible();
  await toggle.click();

  const members = page.locator('tr.row-member');
  await expect(members.first()).toBeVisible();
  const names = await members.evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).animationName));
  // The count first: every() over nothing is true (see docs/papercuts.md).
  expect(names.length).toBeGreaterThan(0);
  expect(names.every((n) => n === 'none')).toBe(true);
  await context.close();
});

test('the filters that are on are chips, and each one undoes itself',
  async ({ page }) => {
    await login(page, ADMIN);

    // The prose this replaces could not be clicked, and could drift: the old
    // paragraph said "showing A only" whatever the grade filter held.
    const grade = filterChip(page, 'A · AI use case');
    await expect(grade).toBeVisible();
    await expect(page.locator('.content')).toContainText('Market news and unread articles');

    await Promise.all([
      page.waitForResponse((r) =>
        r.url().includes('/api/articles?') && !r.url().includes('grades=') && r.ok()),
      grade.getByRole('button').click(),
    ]);

    await expect(grade).toHaveCount(0);
    // And the sentence beside the chips goes with it, because it was only ever
    // true while that chip was there.
    await expect(page.locator('.content')).not.toContainText('Market news and unread articles');
  });

test('removing a chip leaves focus in the chip row, not at the top of the page',
  async ({ page }) => {
    await login(page, ADMIN);

    const grade = filterChip(page, 'A · AI use case');
    await Promise.all([
      page.waitForResponse((r) =>
        r.url().includes('/api/articles?') && !r.url().includes('grades=') && r.ok()),
      grade.getByRole('button').click(),
    ]);

    // The clicked button is unmounted by its own click, and a browser hands
    // focus back to <body> when that happens — so clearing three filters from
    // the keyboard meant tabbing in from the top of the document three times.
    const focused = await page.evaluate(() => document.activeElement?.className ?? '');
    expect(focused).toContain('filterchips');
  });

test('the bar clears only what the bar draws', async ({ page }) => {
  await login(page, ADMIN);

  // The Lens draws its search box outside the disclosure. The bar inside it
  // used to count that term and wipe it — so a reader with only a search term
  // saw "Clear (1)" above a row of empty dropdowns, and pressing it emptied a
  // box that is not in the same container.
  // By role, not by label: once the term is set there is a chip whose
  // aria-label reads "Remove filter — Search: agents", and getByLabel matches
  // on substring, so it would resolve to two elements.
  const box = page.getByRole('searchbox', { name: 'Search' });

  await openMoreFilters(page);
  const clear = page.locator('.filterbar').getByRole('button', { name: /^Clear/ });
  // One, for the grade filter the Lens opens with.
  await expect(clear).toHaveText('Clear (1)');

  await box.fill('agents');
  await expect(filterChip(page, 'Search: agents')).toBeVisible();
  // Still one. The term is real and is chipped, but it is not in this box.
  await expect(clear).toHaveText('Clear (1)');

  // And pressing it does not reach outside the box either.
  await clear.click();
  await expect(box).toHaveValue('agents');

  // The chip row does own the whole view, and clears the term with everything
  // else — which is the difference between the two buttons.
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(box).toHaveValue('');
});

test('the date window is a chip, and clearing it offers the default back',
  async ({ page }) => {
    await login(page, ADMIN);

    // This is the "Show all dates" / "Back to 1 July 2026" pair, relocated out
    // of a four-line paragraph. The window is the one filter the reader did
    // not choose, so it is stated whether it is set or not — a row that simply
    // omitted it would make the Archive's larger total look like a different
    // set of articles.
    const since = filterChip(page, 'Since 1 Jul 2026');
    await expect(since).toBeVisible();

    await Promise.all([
      page.waitForResponse((r) =>
        r.url().includes('/api/articles?') && !r.url().includes('from=') && r.ok()),
      since.getByRole('button').click(),
    ]);

    const all = filterChip(page, 'All dates · back to 1 Jul 2026');
    await expect(all).toBeVisible();
    await expect(page.getByLabel('From')).toHaveValue('');

    await Promise.all([
      page.waitForResponse((r) =>
        r.url().includes('/api/articles?') && r.url().includes('from=2026-07-01') && r.ok()),
      all.click(),
    ]);
    await expect(page.getByLabel('From')).toHaveValue('2026-07-01');
  });

test('the dropdowns are one click away, not gone', async ({ page }) => {
  await login(page, ADMIN);

  // The disclosure is closed on open, but native <details> keeps its contents
  // in the DOM — which is why the date assertions elsewhere still resolve, and
  // why this asserts hidden rather than absent.
  await expect(page.locator('details.morefilters')).not.toHaveAttribute('open', '');
  await expect(page.locator('.filterbar')).toBeHidden();
  await expect(page.getByLabel('From')).toHaveValue('2026-07-01');

  // Searching is the one filter people reach for without knowing which
  // dimension they want, so it stays out in the open.
  await expect(page.getByLabel('Search')).toBeVisible();

  await openMoreFilters(page);
  // The complete path, kept: the L1 chart shows the top 14 of some 38
  // processes, so bars alone would leave the tail unreachable from any control.
  await expect(page.getByRole('button', { name: /^L1 process:/ })).toBeVisible();
});

test('the Lens opens newest first', async ({ page }) => {
  // It used to open on highest AI focus. That answers "which of these is most
  // about AI" and cannot answer "what has landed" — it puts a strong August
  // story above everything from this week, which is what the page is opened
  // for. AI focus is one click away in the toggle above the table.
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/articles?')) asked.push(r.url());
  });

  await login(page, ADMIN);
  await expect(dataRows(page).first()).toBeVisible();

  await expect(page.getByRole('columnheader', { name: /Date/ }))
    .toHaveAttribute('aria-sort', 'descending');

  // Ordered by the server, not by the table: asserting the rendered dates
  // alone would pass on a page that happened to arrive in order.
  expect(asked.at(-1)).toContain('sort=published');
  expect(asked.at(-1)).toContain('sortDir=desc');

  const dates = await page.locator('table.analysis tbody tr td.cell-date .date')
    .allTextContents();
  expect(dates.length).toBeGreaterThan(1);
  expect(dates).toEqual([...dates].sort().reverse());
});

test('the sort toggle is remembered, and never contradicts a column header',
  async ({ page }) => {
    await login(page, ADMIN);
    await expect(dataRows(page).first()).toBeVisible();

    const newest = page.getByRole('button', { name: 'Newest', exact: true });
    const byFocus = page.getByRole('button', { name: 'Highest AI focus' });
    await expect(newest).toHaveAttribute('aria-pressed', 'true');

    await Promise.all([
      page.waitForResponse((r) =>
        r.url().includes('/api/articles?') && r.url().includes('sort=aiIntensity') && r.ok()),
      byFocus.click(),
    ]);

    // The whole point of remembering it: a reload is a new visit.
    await page.reload();
    await expect(dataRows(page).first()).toBeVisible();
    await expect(byFocus).toHaveAttribute('aria-pressed', 'true');
    await expect(newest).toHaveAttribute('aria-pressed', 'false');

    // Two controls, one state. Sorting by a column the toggle does not offer
    // leaves neither button pressed, rather than leaving one lit and lying.
    // Stage rather than the headline: the Lens's merged use-case column is not
    // sortable, because its headline is the reviewer's on some rows and the
    // article's on others, and ordering that mix orders nothing.
    await Promise.all([
      page.waitForResponse((r) =>
        r.url().includes('/api/articles?') && r.url().includes('sort=maturity') && r.ok()),
      page.getByRole('button', { name: /^Stage/ }).click(),
    ]);
    await expect(newest).toHaveAttribute('aria-pressed', 'false');
    await expect(byFocus).toHaveAttribute('aria-pressed', 'false');

    // Leave the stored preference as it was found, like the Archive decision
    // test does — the next test to open the Lens expects its default.
    await Promise.all([
      page.waitForResponse((r) =>
        r.url().includes('/api/articles?') && r.url().includes('sort=published') && r.ok()),
      newest.click(),
    ]);
  });

test('the export carries when the data was collected and when the file was made',
  async ({ page }) => {
    await login(page, ADMIN);
    await expect(dataRows(page).first()).toBeVisible();

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]).then(([d]) => d);

    const stream = await download.createReadStream();
    const csv = await new Promise<string>((resolve, reject) => {
      let out = '';
      stream.on('data', (c) => { out += c; });
      stream.on('end', () => resolve(out));
      stream.on('error', reject);
    });

    const [header, first] = csv.split('\n');
    expect(header).toContain('Collected');
    expect(header).toContain('Exported');
    expect(header).toContain('Grade');

    // Both are real values, not empty columns: a date for the row and a
    // timestamp to the minute for the file.
    const cols = header!.split(',');
    const cells = first!.split(',');
    expect(cells[cols.indexOf('Collected')]).toMatch(/^"?\d{4}-\d{2}-\d{2}/);
    expect(cells[cols.indexOf('Exported')]).toMatch(/^"?\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });


test('Agentic Swiss Banks is parked: nobody sees it, administrators included',
  async ({ page }) => {
    // Hidden for now, not deleted — the tests that covered the page are in git
    // history beside the commit that parked it. What must hold meanwhile is
    // that no role reaches it, and the tab list is asserted whole elsewhere.
    await login(page, ADMIN);
    const nav = page.getByRole('navigation', { name: 'Sections' });
    await expect(nav.getByRole('button')).not.toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Agentic Swiss Banks' })).toHaveCount(0);
    await expect(page.getByText('Agentic Swiss Banks')).toHaveCount(0);
  });

test('every named use case on the Lens carries the tier of its institution',
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, ADMIN);
    await showEveryGrade(page);

    // Third, beside the use case it qualifies.
    const headers = page.locator('table.analysis thead th');
    await expect(headers.nth(2)).toHaveText('Tier');

    // The fixtures' reviewed rows: two G-SIBs and a Singapore D-SIB.
    const tierOf = (text: string) =>
      dataRows(page).filter({ hasText: text }).first().locator('td.cell-tier');
    await expect(tierOf('Deutsche retail')).toHaveText('Tier 1 bank');
    await expect(tierOf('HSBC')).toHaveText('Tier 1 bank');
    await expect(tierOf('OCBC')).toHaveText('Tier 2 bank');
    // The reason is one hover away, not a guess.
    await expect(tierOf('OCBC').locator('span')).toHaveAttribute('title', /Singapore D-SIB/);

    // An unreviewed row names nobody, so it gets no tier — reading one out of
    // the headline would be the classifier guessing who.
    await expect(tierOf('Swiss investors pile into')).toHaveText('—');
  });

test('a column answers whether agents are actually running', async ({ page }) => {
  await login(page, ADMIN);
  await showEveryGrade(page);

  // It used to be leftmost, on the argument that it is the question no other
  // column answers: Type says agentic and stops, Stage says in production and
  // does not say of what. That is still true, and it is still its own column —
  // but it is a narrow question, and the frozen pair is now spent on the two
  // things every row is read by.
  const headers = page.locator('table.analysis thead th');
  await expect(headers.first()).toContainText('Date');
  // The second frozen column is the headline — on the Lens, the merged use
  // case, whose source article sits underneath it.
  await expect(headers.nth(1)).toContainText('Use case');
  await expect(page.getByRole('columnheader', { name: 'Agents running?' })).toBeVisible();

  // f13 is agentic and in production; f12 is machine learning and in
  // production, and reading Stage alone would call that an answer.
  const live = dataRows(page).filter({ hasText: 'Zürcher Kantonalbank' });
  await expect(live.locator('.agent')).toHaveText('Live');
  const notAgentic = dataRows(page).filter({ hasText: 'Core banking vendor' });
  await expect(notAgentic.locator('.agent')).toHaveText('No agents');
});

test('the global Lens carries no standing Swiss filter', async ({ page }) => {
  await login(page, ADMIN);
  await showEveryGrade(page);

  // Same component, two scopes — so the thing worth asserting is that the
  // standing Swiss filter did not leak into the page it was cloned from.
  await expect(dataRows(page).filter({ hasText: 'Swiss investors pile into' })).toHaveCount(1);
  await expect(page.locator('.card', { hasText: 'By region' })).toBeVisible();
});
