import { expect, field, login, nav, slackMessages, test } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('a listing is added on the product page', async ({ page }) => {
  await login(page, 'editor');
  await page.goto('/products');
  await page.getByRole('link', { name: 'Sample Doorbell', exact: true }).click();
  await page.getByRole('button', { name: 'Add listing' }).click();
  const form = page.locator('form').filter({ hasText: 'Listing ID' });
  await field(form, 'Market', 'select').selectOption({ label: 'US · United States' });
  await field(form, 'State', 'select').selectOption('live');
  await field(form, 'Listing ID').fill('B0SAMPLE1');
  await field(form, 'SKU').fill('SD-SKU');
  await form.getByRole('button', { name: 'Add listing' }).click();
  await expect(page.getByLabel('State of Amazon listing')).toHaveValue('live');
  await expect(page.getByText('B0SAMPLE1 · SD-SKU')).toBeVisible();
});

test('an Amazon returns report is previewed, imported, and re-importing is harmless', async ({ page, request }) => {
  await login(page, 'editor');
  await nav(page, 'Returns');
  await expect(page.getByText(/^No returns in .* yet\.$/)).toBeVisible();
  await page.getByRole('link', { name: 'Import returns' }).first().click();
  await field(page, 'Market', 'select').selectOption({ label: 'US · United States' });
  await page.getByLabel('Returns report file').setInputFiles('e2e/fixtures/amazon-returns.tsv');
  await expect(page.getByText('4 returns (5 units) will be added')).toBeVisible();
  await expect(page.getByText("1 aren't matched to a product yet")).toBeVisible();
  const preview = page.locator('table');
  await expect(preview.locator('tr', { hasText: 'Unknown gizmo' })).toContainText('Unmatched');
  await expect(preview.locator('tr', { hasText: 'Sample W4 window camera' })).toContainText('Sample Window Cam');
  await expect(preview.locator('tr', { hasText: 'B0SAMPLE1' }).first()).toContainText('Sample Doorbell'); // matched by the listing's ASIN

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible();
  await expect.poll(async () => (await slackMessages(request)).at(-1)).toMatch(/imported 4 Amazon returns \(5 units\)/);

  await page.getByLabel('Returns report file').setInputFiles('e2e/fixtures/amazon-returns.tsv');
  await expect(page.getByText('0 returns (0 units) will be added, 4 already imported (skipped)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
});

test('the returns page shows one month: buckets, comments, the key, platform vs notes and products', async ({ page }) => {
  await login(page);
  await page.goto('/returns?month=2026-09');
  const stat = (label) => page.locator('.stat', { hasText: label }).locator('.stat-value');
  // September: the W4 return with no note. The carrier-damaged one never reached a customer, so it's set aside; it still waits for a product.
  await expect(page.getByLabel('Month to show')).toHaveValue('2026-09');
  await expect(stat('Units returned')).toHaveText('1');
  await expect(stat('Left a comment')).toHaveText('0%');
  await expect(stat('Not matched to a product')).toHaveText('1');

  // The trend runs over the 12 months up to the one shown.
  const chart = page.getByRole('img', { name: 'Units returned per month by channel' });
  await expect(chart.locator('.chart-value')).toHaveText(['1', '2', '1']); // Jul, Aug, Sep totals
  await chart.locator('g[tabindex="0"]').nth(1).hover();
  await expect(page.locator('.chart-tooltip')).toContainText('Amazon: 2');
  await page.getByRole('button', { name: 'Show table' }).click();
  await expect(page.locator('th', { hasText: 'Total' })).toBeVisible();
  await page.getByRole('button', { name: 'Show chart' }).click();

  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.getByLabel('Month to show')).toHaveValue('2026-08');
  await expect(stat('Units returned')).toHaveText('2');
  await page.getByRole('button', { name: 'Previous month' }).click();
  // July: one return, "Stopped working", picked as Defective.
  await expect(stat('Units returned')).toHaveText('1');
  await expect(stat('Left a comment')).toHaveText('100%');
  await expect(stat('Top bucket')).toHaveText('Performance / Hardware');
  await expect(page.locator('.donut-legend').first()).toContainText('Performance / Hardware1 · 100%');
  await expect(page.locator('.donut-legend').nth(1)).toContainText('Left a comment1 · 100%');

  // The key: every bucket with its definition; opening one shows its sub-reasons.
  const bucket = page.getByRole('button', { name: /^Performance \/ Hardware/ });
  await expect(bucket).toContainText("The camera connects but doesn't do its job");
  await bucket.click();
  await expect(page.getByRole('list', { name: 'Performance / Hardware by sub-reason' })).toContainText('Works briefly then dies');

  const vs = page.getByRole('table', { name: "Platform reason against the buyer's note" });
  await expect(vs.locator('tr', { hasText: 'Defective / does not work' })).toContainText('100%');

  // A product opens in place, with what its buyers wrote, instead of filtering the page.
  const products = page.locator('.card', { hasText: 'By product' });
  await products.getByRole('button', { name: 'Sample Doorbell' }).click();
  await expect(products.locator('.product-detail')).toContainText('“Stopped working”');
  await expect(stat('Units returned')).toHaveText('1');
  await expect(page).not.toHaveURL(/productId/);
});

test('an unmatched return is assigned and future imports learn the match', async ({ page }) => {
  await login(page, 'editor');
  await page.goto('/returns?month=2026-09');
  const unmatched = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Returns not matched to a product' }) });
  await expect(unmatched).toContainText('Unknown gizmo');
  await unmatched.getByLabel('Product').selectOption({ label: 'Sample Hub (HB1 V2)' });
  await unmatched.getByRole('button', { name: 'Assign' }).click();
  await expect(unmatched).toHaveCount(0);
  await expect(page.locator('.stat', { hasText: 'Not matched' }).locator('.stat-value')).toHaveText('0');

  await page.goto('/products');
  await page.getByRole('link', { name: 'Sample Hub', exact: true }).click();
  await expect(page.getByText('B0MYSTERY')).toBeVisible();
  // Its only return was damaged by the carrier and never reached a customer, so it's set aside, not counted as returned.
  await expect(page.getByRole('heading', { name: 'Listings & returns' })).toBeVisible();
  await expect(page.getByRole('link', { name: /returned$/ })).toHaveCount(0);
});

test("what's connected shows how each product's returns were matched, and a group can be moved", async ({ page }) => {
  await login(page, 'editor');
  await page.goto('/products');
  await page.getByRole('link', { name: 'What’s connected' }).click();
  await expect(page.getByRole('heading', { name: 'What’s connected to each product' })).toBeVisible();
  const card = (name) => page.getByRole('region', { name, exact: true });
  // The doorbell's returns came in through its ASIN listing; the W4 return was matched from its title.
  await expect(card('Sample Doorbell').locator('tr', { hasText: 'B0SAMPLE1' })).toContainText('Listing');
  const w4 = card('Sample Window Cam').locator('tr', { hasText: 'Sample W4 window camera' });
  await expect(w4).toContainText('Guessed at import');

  await page.getByLabel('Only products with something to check').check();
  await expect(card('Sample Doorbell')).toHaveCount(0);
  await expect(card('Sample Window Cam')).toBeVisible();

  // Move it to the V2 and back: its SKU becomes a listing, so it's no longer a guess.
  await w4.getByLabel(/^Move .* to$/).selectOption({ label: 'Sample Window Cam (V2) (SW-200)' });
  await w4.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByText('Nothing to check: every group is matched by a listing.')).toBeVisible();
  await page.getByLabel('Only products with something to check').uncheck();
  const moved = card('Sample Window Cam (V2)').locator('tr', { hasText: 'Sample W4 window camera' });
  await expect(moved).toContainText('Listing');
  await moved.getByLabel(/^Move .* to$/).selectOption({ label: 'Sample Window Cam (W4)' });
  await moved.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(card('Sample Window Cam').locator('tr', { hasText: 'Sample W4 window camera' })).toContainText('Listing');
});

test('a comparison grid is built and its cells persist', async ({ page }) => {
  await login(page, 'editor');
  await nav(page, 'Comparisons');
  await page.getByRole('button', { name: 'New comparison' }).click();
  await field(page, 'Name').fill('Doorbells under $100');
  await field(page, 'Luna product', 'select').selectOption({ label: 'Sample Doorbell (SD-100)' });
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Doorbells under $100' })).toBeVisible();
  await expect(page.locator('tbody th', { hasText: 'Price' })).toBeVisible();

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await field(page, 'Brand').fill('Ringer');
  await field(page, 'Product').fill('Battery Doorbell');
  await field(page, 'Price').fill('$99.99');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('thead')).toContainText('Ringer Battery Doorbell');
  await expect(page.locator('thead')).toContainText('$99.99');

  await page.getByLabel('Price for Sample Doorbell').fill('$79.99');
  await page.getByLabel('Price for Ringer Battery Doorbell').click(); // leaving the cell saves it
  await expect(page.getByLabel('Price for Sample Doorbell')).toHaveClass(/saved/);
  await page.getByLabel('Price for Ringer Battery Doorbell').fill('$99.99');
  await page.getByLabel('New row').click();
  await page.getByLabel('New row').fill('Works with Alexa');
  await page.getByRole('button', { name: 'Add row' }).click();
  await expect(page.locator('tbody th', { hasText: 'Works with Alexa' })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Price for Sample Doorbell')).toHaveValue('$79.99');
  await expect(page.getByLabel('Price for Ringer Battery Doorbell')).toHaveValue('$99.99');
  await expect(page.getByText('Ella Editor set "Price" to "$79.99"')).toBeVisible();
});
