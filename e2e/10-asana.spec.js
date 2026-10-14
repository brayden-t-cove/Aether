import { expect, login, nav, test } from './helpers.js';

test.describe.configure({ mode: 'serial' });

// Builds on the E2E Floodlight project from 02. The fake Asana (test/fake-asana.js) has one project with three tasks.

test('a project is linked to Asana and an item picks a task; its comments show in Updates', async ({ page }) => {
  await login(page, 'editor');
  await nav(page, 'Projects');
  await page.getByRole('link', { name: 'E2E Floodlight — US launch', exact: true }).click();

  const bar = page.getByLabel('Asana', { exact: true });
  await expect(bar).toContainText('Not linked to Asana.');
  await bar.getByRole('button', { name: 'Link Asana project' }).click();
  await bar.getByLabel('Asana project link').fill('https://app.asana.com/0/9999/list');
  await bar.getByRole('button', { name: 'Link' }).click();
  await expect(bar).toContainText("Asana couldn't find that project");
  await bar.getByLabel('Asana project link').fill('https://app.asana.com/0/1001/list');
  await bar.getByRole('button', { name: 'Link' }).click();
  await expect(bar.getByRole('link', { name: 'Sample Cam · UK launch ↗' })).toBeVisible();

  await page.getByRole('button', { name: 'Mold design', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Details of Mold design' });
  const asana = panel.getByRole('region', { name: 'Asana task' });
  await asana.getByLabel('Asana task to link').selectOption({ label: 'Book UKCA testing' });
  await asana.getByRole('button', { name: 'Link' }).click();
  await expect(panel.getByRole('region', { name: 'Asana task' }).getByRole('link', { name: 'Book UKCA testing ↗' })).toBeVisible();

  // Comments only (not "changed the due date"), each marked as from Asana, and not editable here.
  const updates = panel.getByRole('region', { name: 'Updates on Mold design' });
  const fromAsana = updates.locator('.update', { has: page.locator('.asana-tag') });
  await expect(fromAsana).toHaveCount(2);
  await expect(fromAsana.first()).toContainText('Pat Expansion');
  await expect(fromAsana.first()).toContainText('Asked two labs for quotes.');
  await expect(fromAsana.first().getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(fromAsana.first().getByRole('button', { name: 'Delete' })).toHaveCount(0);

  // Pulling again adds nothing new; the history says what came in.
  await bar.getByRole('button', { name: 'Pull from Asana' }).click();
  await expect(bar).toContainText('0 new comments from 1 linked task');
  await expect(page.locator('.activity')).toContainText('2 new comments from Asana on "Mold design"');
});

test('admins see Asana on the Integrations page', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/admin/integrations');
  const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Asana', exact: true }) });
  await expect(card).toContainText('Connected');
  await expect(card).toContainText('1 project and 1 item linked');
  await card.getByRole('button', { name: 'Pull from Asana' }).click();
  await expect(card).toContainText('0 new comments from 1 linked task');
});
