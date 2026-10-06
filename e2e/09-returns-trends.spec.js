import { expect, login, test } from './helpers.js';

test.describe.configure({ mode: 'serial' });

// Builds on the returns imported in 05 (Amazon) and 07 (TikTok TT-E2E-1, filed as Other and rated Low in 08).
// end= pins the weeks so the specs don't depend on today's date.

test('week over week compares the last two finished weeks by category or cause', async ({ page }) => {
  await login(page);
  await page.goto('/returns?view=weekly&end=2026-09-20&weeks=8&match=all'); // Jul 27 to Sep 20
  await expect(page.getByRole('tab', { name: 'Week over week' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Comparing the week of Sep 14–20 with Sep 7–13.')).toBeVisible();
  const table = page.getByRole('table', { name: 'Units by category per week' });
  await expect(table.locator('tr', { hasText: /^Other/ })).toContainText('01+1');

  await page.getByRole('tab', { name: 'Causes' }).click();
  await expect(page.getByRole('table', { name: 'Units by cause per week' }).locator('tr', { hasText: 'Other reasons' })).toContainText('+1');
  await page.getByRole('button', { name: 'Show all 8 weeks' }).click();
  await expect(page.getByRole('table', { name: 'Units by cause per week' }).locator('th')).toHaveCount(4 + 8);
  await expect(page.getByRole('img', { name: 'Units returned per week by channel' })).toBeVisible();

  // The TikTok return was rated Low, so the default filter leaves it out.
  await page.getByLabel('Customer match').selectOption('strong');
  await expect(page.getByText('No returns with a reason in these weeks.')).toBeVisible();
});

test('Amazon vs TikTok puts the channels side by side', async ({ page }) => {
  await login(page);
  await page.goto('/returns?view=weekly&end=2026-09-20&weeks=8&match=all');
  await page.getByRole('tab', { name: 'Amazon vs TikTok' }).click();
  await expect(page).toHaveURL(/view=channels/);
  await expect(page.getByLabel('Channel', { exact: true })).toHaveCount(0); // the view compares channels, so there's no channel filter
  const glance = page.getByRole('table', { name: 'Amazon and TikTok compared' });
  await expect(glance.locator('tr', { hasText: 'Units returned' })).toContainText('31'); // 3 Amazon, 1 TikTok
  await expect(glance.locator('tr', { hasText: 'Returns with no note' })).toContainText('100%0%');
  await expect(page.getByRole('table', { name: 'Categories by channel' })).toContainText('Other');
});

test('blank notes counts returns with no note per week and lists the latest', async ({ page }) => {
  await login(page);
  await page.goto('/returns?view=blank&end=2026-09-20&weeks=8');
  const stat = (label) => page.locator('.stat', { hasText: label }).locator('.stat-value');
  await expect(stat('No note')).toHaveText('2');
  await expect(page.locator('.stat', { hasText: 'No note' })).toContainText('of 2 returns (100%)');
  const latest = page.getByRole('table', { name: 'Latest returns with no note' });
  await expect(latest.locator('tbody tr')).toHaveCount(2);
  await expect(latest).toContainText('Not as described');
  await page.getByRole('button', { name: 'Show table' }).click();
  await expect(page.getByRole('table', { name: 'Returns with no note per week' }).locator('tr', { hasText: 'Aug 10–16' })).toContainText('1');
});
