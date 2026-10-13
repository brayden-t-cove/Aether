import { expect, login, test } from './helpers.js';

test.describe.configure({ mode: 'serial' });

// Builds on the returns imported in 05 (Amazon) and 07 (TikTok TT-E2E-1, filed as Generic; here it gets a Connectivity mention).
// end= pins the weeks so the specs don't depend on today's date.

test('week over week compares the last two finished weeks by bucket', async ({ page }) => {
  await login(page, 'editor');
  // An editor finds the TikTok note does say what went wrong after all.
  const { returns } = await (await page.request.get('/api/returns?channel=tiktok')).json();
  const add = await page.request.post(`/api/returns/${returns[0].id}/mentions`, { data: { action: 'add', to: { category: 'connectivity', subreason: 'wont_connect' } } });
  expect(add.ok()).toBe(true);
  await page.goto('/returns?view=weekly&end=2026-09-20&weeks=8'); // Jul 27 to Sep 20
  await expect(page.getByRole('tab', { name: 'Week over week' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Comparing the week of Sep 14–20 with Sep 7–13.')).toBeVisible();
  const table = page.getByRole('table', { name: 'Units by bucket per week' });
  await expect(table.locator('tr', { hasText: /^Connectivity/ })).toContainText('01+1');
  await expect(page.getByRole('tab', { name: 'Causes' })).toHaveCount(0);
  await expect(page.getByLabel('Customer match')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all 8 weeks' }).click();
  await expect(table.locator('th')).toHaveCount(4 + 8);
  await expect(page.getByRole('img', { name: 'Units returned per week by channel' })).toBeVisible();
});

test('Amazon vs TikTok puts the channels side by side', async ({ page }) => {
  await login(page);
  await page.goto('/returns?view=weekly&end=2026-09-20&weeks=8');
  await page.getByRole('tab', { name: 'Amazon vs TikTok' }).click();
  await expect(page).toHaveURL(/view=channels/);
  await expect(page.getByLabel('Channel', { exact: true })).toHaveCount(0); // the view compares channels, so there's no channel filter
  const glance = page.getByRole('table', { name: 'Amazon and TikTok compared' });
  await expect(glance.locator('tr', { hasText: 'Units returned' })).toContainText('31'); // 3 Amazon, 1 TikTok
  await expect(glance.locator('tr', { hasText: 'Reviews with no note' })).toContainText('100%0%');
  await expect(page.getByRole('table', { name: 'Categories by channel' })).toContainText('Connectivity');
});

test('blank notes counts returns with no note per week and lists the latest', async ({ page }) => {
  await login(page);
  await page.goto('/returns?view=blank&end=2026-09-20&weeks=8');
  const stat = (label) => page.locator('.stat', { hasText: label }).locator('.stat-value');
  await expect(stat('No note')).toHaveText('2');
  // Every return counts: the TikTok one (with a note) is no longer hidden by a customer-match rating.
  await expect(page.locator('.stat', { hasText: 'No note' })).toContainText('of 3 returns (67%)');
  const latest = page.getByRole('table', { name: 'Latest returns with no note' });
  await expect(latest.locator('tbody tr')).toHaveCount(2);
  await expect(latest).toContainText('Not as described');
  await page.getByRole('button', { name: 'Show table' }).click();
  await expect(page.getByRole('table', { name: 'Returns with no note per week' }).locator('tr', { hasText: 'Aug 10–16' })).toContainText('1');
});
