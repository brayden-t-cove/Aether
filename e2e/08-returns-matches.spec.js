import { expect, login, test } from './helpers.js';

test.describe.configure({ mode: 'serial' });

// Builds on 05 (Amazon returns) and 07 (TikTok return TT-E2E-1). The fixture workbook is made up, including its customer columns.

test('the customer-match workbook is read in the browser and only IDs and confidences are sent', async ({ page }) => {
  await login(page, 'editor');
  await page.goto('/returns/import');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Customer matches (TikTok)' }) });

  const sent = [];
  page.on('request', (req) => req.url().endsWith('/api/returns/matches') && req.method() === 'POST' && sent.push(req.postData()));
  await card.getByLabel('Customer-match workbook file').setInputFiles('e2e/fixtures/customer-matches.xlsx');
  await expect(card.getByRole('heading', { name: 'Preview: customer-matches.xlsx' })).toBeVisible();
  await expect(card).toContainText("2 returns: 0 High, 0 Medium, 1 Low, 1 Unmatched (1 unmatched with no activation in the buyer's zip). 2 new, 0 changed, 0 unchanged.");
  await expect(card).toContainText('Read 2 rows from "Return Matches" and 1 rows from "Unmatched Returns"');
  await expect(card).toContainText("1 of these returns aren't in Aether yet");

  await card.getByRole('button', { name: 'Save matches' }).click();
  await expect(card.getByRole('heading', { name: 'Matches saved' })).toBeVisible();
  await expect(card).toContainText('On file: 2 returns (0 High, 0 Medium, 1 Low, 1 Unmatched)');

  expect(sent).toHaveLength(2);
  for (const body of sent) {
    expect(body).toContain('TT-E2E-1');
    expect(body).not.toMatch(/Sample Person|000-000|example\.com|Sample St|Thanks anyway/);
  }
});

test('the Returns page leaves out weak matches unless asked for all', async ({ page }) => {
  await login(page);
  await page.goto('/returns?period=all');
  const stat = (label) => page.locator('.stat', { hasText: label }).locator('.stat-value');
  await expect(page.getByLabel('Customer match')).toHaveValue('strong');
  await expect(page.getByLabel('Customer match').locator('option:checked')).toHaveText('Hide weak matches');
  await expect(page.getByText('Leaving out TikTok returns the customer-match workbook rated Low')).toBeVisible();
  await expect(stat('Units returned')).toHaveText('4'); // TT-E2E-1 was rated Low

  await page.getByLabel('Customer match').selectOption('all');
  await expect(stat('Units returned')).toHaveText('5');
  await expect(page).toHaveURL(/match=all/);
});
