import { expect, field, login, nav, test } from './helpers.js';
import { E2E_PASSWORD, USERS } from './users.js';

test.describe.configure({ mode: 'serial' });

test('sign-in page rejects a wrong password and signs in with the right one', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Luna's product-readiness hub")).toBeVisible();
  await page.getByLabel('Email').fill(USERS.admin.email);
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page.locator('.alert.error')).toHaveText('Invalid email or password');
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('staging shows a banner, and every built module is in the sidebar', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('note')).toContainText('Staging');
  for (const name of ['Readiness', 'Projects', 'Products', 'Markets', 'Certifications', 'Manuals & packaging', 'Design requests', 'Vendors', 'Returns', 'Comparisons', 'Users', 'Import', 'Integrations']) {
    await expect(page.locator('.sidebar').getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(page.locator('.nav-phase')).toHaveCount(0); // no "coming in phase N" placeholders left
});

test('admin invites a teammate and changes their team', async ({ page }) => {
  await login(page);
  await nav(page, 'Users');
  await field(page, 'Email').fill('dana@e2e.test');
  await field(page, 'Name').fill('Dana Design');
  await field(page, 'Team', 'select').selectOption('design');
  await page.getByRole('button', { name: 'Invite' }).click();
  const row = page.locator('tr', { hasText: 'dana@e2e.test' });
  await expect(row).toContainText('Invited');
  await row.locator('select').nth(1).selectOption('product_development');
  await expect(row.locator('select').nth(1)).toHaveValue('product_development');
  await nav(page, 'Dashboard');
  await expect(page.getByText('Alex Admin invited dana@e2e.test as editor')).toBeVisible();
});

test('a viewer can read but not reach admin pages', async ({ page }) => {
  await login(page, 'viewer');
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Users' })).toHaveCount(0);
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New project' })).toHaveCount(0);
});

test('account page changes the password', async ({ page }) => {
  await login(page, 'editor');
  await page.locator('.user-chip').click();
  await field(page, 'Current password').fill(E2E_PASSWORD);
  await field(page, 'New password').fill(`${E2E_PASSWORD}!`);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByText('Password updated.')).toBeVisible();
  // Put it back for the rest of the suite.
  await field(page, 'Current password').fill(`${E2E_PASSWORD}!`);
  await field(page, 'New password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByText('Password updated.')).toBeVisible();
});
