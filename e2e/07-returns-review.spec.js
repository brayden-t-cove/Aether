import { expect, login, test } from './helpers.js';

test.describe.configure({ mode: 'serial' });

// Builds on the Amazon returns imported in 05: one of them has a note ("Stopped working").

test('an editor confirms a call the rules made', async ({ page }) => {
  await login(page, 'editor');
  await page.goto('/returns');
  await page.getByRole('link', { name: 'Review returns' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Review returns' })).toBeVisible();
  await expect(page.getByText('Every return with a note has a category.')).toBeVisible();

  await page.getByRole('tab', { name: 'Not yet reviewed (1)' }).click();
  const row = page.locator('tr', { hasText: 'Stopped working' });
  await expect(row).toContainText('Performance / Hardware');
  await expect(row).toContainText('note matched: "stopped working"');
  // Flags and other categories the note mentions ride alongside the call.
  const flag = row.getByRole('button', { name: 'Support contacted, unresolved' });
  await expect(flag).toHaveAttribute('aria-pressed', 'false');
  await flag.click();
  await expect(flag).toHaveAttribute('aria-pressed', 'true');
  await row.getByLabel('Add another mention').selectOption('connectivity/wont_connect');
  // Connectivity comes first in the priority order, so it becomes the main call and Performance rides alongside.
  await expect(row).toContainText("ConnectivityWon't connect");
  await expect(row).toContainText('Also mentions: Performance / Hardware');
  await page.getByLabel('Filter by flag').selectOption('looks_used');
  await expect(page.getByText('Every call the rules made has been reviewed.')).toBeVisible();
  await page.getByLabel('Filter by flag').selectOption('support_unresolved');
  await expect(row).toBeVisible();
  await page.getByLabel('Filter by flag').selectOption('');

  await row.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Every call the rules made has been reviewed.')).toBeVisible();
  await expect(page.getByLabel('Review progress')).toContainText('1 of 1 returns with a note reviewed (100%)');

  // On the Returns page, Confirm checked both mentions; a call can also be re-filed from there.
  await page.goto('/returns?month=2026-07');
  await page.getByRole('button', { name: /^Performance \/ Hardware/ }).click();
  const subs = page.getByRole('list', { name: 'Performance / Hardware by sub-reason' });
  await expect(subs).toContainText('1 of 1 checked');
  await subs.getByRole('button', { name: /Works briefly then dies/ }).click();
  await expect(subs.locator('.filed-return')).toContainText('Checked');
  await expect(subs.getByRole('button', { name: 'Looks right' })).toHaveCount(0);
  await expect(subs.getByLabel('Re-file as')).toBeVisible();
  // The connectivity problem added on the Review page counts too.
  await expect(page.getByRole('button', { name: /^Connectivity/ })).toContainText('1 mention');
});

test('a note the rules don’t recognise lands on the Other page and is filed by hand', async ({ page }) => {
  await login(page, 'editor');
  await page.goto('/returns/import');
  await page.getByLabel('Channel').selectOption('tiktok');
  await page.getByLabel('Returns report file').setInputFiles('e2e/fixtures/tiktok-returns.csv');
  // The preview shows the Buyer Note was read.
  await expect(page.getByText('1 of 1 rows have a note from the buyer (the Buyer Note column).')).toBeVisible();
  await expect(page.locator('td.import-note')).toHaveText('Thanks anyway');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible();

  await page.goto('/returns/review');
  await expect(page.getByRole('tab', { name: 'Other (1)' })).toBeVisible();
  const row = page.locator('tr', { hasText: 'Thanks anyway' });
  await expect(row).toContainText('Platform reason: No longer needed');
  await expect(row.getByRole('button', { name: 'Save' })).toBeDisabled();
  // It says nothing specific: Generic.
  await row.getByLabel(/^Category for/).selectOption('generic/vague');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Every return with a note has a category.')).toBeVisible();
  await expect(page.getByLabel('Review progress')).toContainText('2 of 2');
});

test('a viewer sees the review lists but can’t change them', async ({ page }) => {
  await login(page, 'viewer');
  await page.goto('/returns/review?view=unreviewed');
  await expect(page.getByRole('heading', { level: 1, name: 'Review returns' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /Category for/ })).toHaveCount(0);
  const res = await page.request.patch('/api/returns/00000000-0000-0000-0000-000000000000/category', { data: { category: 'fit', subreason: 'window' } });
  expect(res.status()).toBe(403);
});
