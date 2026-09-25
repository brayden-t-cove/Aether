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
  await expect(page.getByText('No returns in this period yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Import returns' }).first().click();
  await field(page, 'Market', 'select').selectOption({ label: 'US · United States' });
  await page.locator('input[type=file]').setInputFiles('e2e/fixtures/amazon-returns.tsv');
  await expect(page.getByText('4 returns (5 units) will be added')).toBeVisible();
  await expect(page.getByText("1 aren't matched to a product yet")).toBeVisible();
  const preview = page.locator('table');
  await expect(preview.locator('tr', { hasText: 'Unknown gizmo' })).toContainText('Unmatched');
  await expect(preview.locator('tr', { hasText: 'Sample W4 window camera' })).toContainText('Sample Window Cam');
  await expect(preview.locator('tr', { hasText: 'B0SAMPLE1' }).first()).toContainText('Sample Doorbell'); // matched by the listing's ASIN

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible();
  await expect.poll(async () => (await slackMessages(request)).at(-1)).toMatch(/imported 4 Amazon returns \(5 units\)/);

  await page.locator('input[type=file]').setInputFiles('e2e/fixtures/amazon-returns.tsv');
  await expect(page.getByText('0 returns (0 units) will be added, 4 already imported (skipped)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
});

test('the returns page charts the trend, reasons and products, with a table view', async ({ page }) => {
  await login(page);
  await page.goto('/returns?period=all');
  const stat = (label) => page.locator('.stat', { hasText: label }).locator('.stat-value');
  await expect(stat('Units returned')).toHaveText('5');
  await expect(stat('Defect or quality')).toHaveText('20%');
  await expect(stat('Not matched to a product')).toHaveText('1');

  const chart = page.getByRole('img', { name: 'Units returned per month by channel' });
  await expect(chart).toBeVisible();
  await expect(chart.locator('.chart-value')).toHaveText(['1', '2', '2']); // Jul, Aug, Sep totals
  await chart.locator('g[tabindex="0"]').nth(1).hover();
  await expect(page.locator('.chart-tooltip')).toContainText('Amazon: 2');

  await page.getByRole('button', { name: 'Show table' }).click();
  await expect(page.locator('table').first()).toContainText('Total');
  await page.getByRole('button', { name: 'Show chart' }).click();

  await expect(page.getByRole('list', { name: 'Units by reason group' })).toContainText('Changed mind');
  const products = page.locator('.card', { hasText: 'By product' });
  await expect(products.locator('tbody tr').first()).toContainText('Sample Doorbell');
  await products.getByRole('button', { name: 'Sample Doorbell' }).click();
  await expect(stat('Units returned')).toHaveText('3');
});

test('an unmatched return is assigned and future imports learn the match', async ({ page }) => {
  await login(page, 'editor');
  await page.goto('/returns?period=all');
  const unmatched = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Returns not matched to a product' }) });
  await expect(unmatched).toContainText('Unknown gizmo');
  await unmatched.getByLabel('Product').selectOption({ label: 'Sample Hub (HB1 V2)' });
  await unmatched.getByRole('button', { name: 'Assign' }).click();
  await expect(unmatched).toHaveCount(0);
  await expect(page.locator('.stat', { hasText: 'Not matched' }).locator('.stat-value')).toHaveText('0');

  await page.goto('/products');
  await page.getByRole('link', { name: 'Sample Hub', exact: true }).click();
  await expect(page.getByText('B0MYSTERY')).toBeVisible();
  await expect(page.getByRole('link', { name: '1 unit returned' })).toBeVisible();
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
