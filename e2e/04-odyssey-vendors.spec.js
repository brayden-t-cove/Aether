import { expect, field, login, nav, test } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('Sync now links matching products and adds Odyssey-only ones as read-only', async ({ page }) => {
  await login(page, 'editor');
  await nav(page, 'Products');
  await expect(page.getByText('Not synced with Odyssey yet')).toBeVisible();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText(/Synced: 2 new, 1 linked/)).toBeVisible();
  await expect(page.getByText(/Odyssey data from/)).toBeVisible();

  // W4 in Odyssey matched the imported "Sample Window Cam" (model W4): linked, not duplicated.
  const w4 = page.locator('tr', { has: page.getByRole('link', { name: 'Sample Window Cam', exact: true }) });
  await expect(w4.locator('.odyssey-tag')).toHaveText('In Odyssey');
  const hub = page.locator('tr', { has: page.getByRole('link', { name: 'Sample Hub', exact: true }) });
  await expect(hub.locator('.odyssey-tag')).toHaveText('From Odyssey');

  await page.getByRole('link', { name: 'Sample Hub', exact: true }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(field(page, 'Name')).toBeDisabled();
  await field(page, 'Notes', 'textarea').fill('Aether-only notes still editable');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Aether-only notes still editable')).toBeVisible();
});

test('Odyssey test results show on the product and its projects', async ({ page }) => {
  await login(page);
  await page.goto('/products');
  await page.getByRole('link', { name: 'Sample Window Cam', exact: true }).click();
  const tests = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Test results from Odyssey' }) });
  await expect(tests).toContainText('production');
  await expect(tests).toContainText('37/40');
  await expect(tests).toContainText('2 failed');
});

test('an Aether product is sent to Odyssey once', async ({ page }) => {
  await login(page, 'editor');
  await page.goto('/products');
  await page.getByRole('link', { name: 'E2E Floodlight', exact: true }).click();
  await page.getByRole('button', { name: 'Send to Odyssey' }).click();
  await expect(page.locator('h1 .odyssey-tag')).toHaveText('In Odyssey');
  await expect(page.getByRole('button', { name: 'Send to Odyssey' })).toHaveCount(0);
});

test('a product added by hand and its Odyssey copy are suggested as duplicates and merged', async ({ page }) => {
  await login(page, 'editor');
  await nav(page, 'Products');
  // Odyssey's "Old Sensor" is model OS1; added here with a dash, so sync couldn't link them.
  await page.getByRole('button', { name: 'Add product' }).click();
  await field(page, 'Name').fill('Legacy Sensor');
  await field(page, 'Model').fill('OS-1');
  await field(page, 'Lifecycle', 'select').selectOption('sunset');
  await page.getByRole('button', { name: 'Add product' }).click();
  await expect(page.getByRole('heading', { name: 'Legacy Sensor' })).toBeVisible();

  await nav(page, 'Products');
  await page.getByRole('link', { name: 'Review possible duplicates' }).click();
  await expect(page.getByRole('heading', { name: 'Possible duplicates' })).toBeVisible();
  const pair = page.getByRole('listitem', { name: 'Legacy Sensor and Old Sensor' });
  await expect(pair.locator('.dup-score')).toContainText('Very likely the same');
  await expect(pair).toContainText('Same model number: OS-1 and OS1');
  await pair.getByRole('button', { name: 'Merge into Legacy Sensor' }).click();
  await expect(page.getByRole('status')).toContainText('Merged into Legacy Sensor.');
  await expect(pair).toHaveCount(0);

  await page.getByRole('status').getByRole('link', { name: 'Open it' }).click();
  await expect(page.locator('h1 .odyssey-tag')).toHaveText('In Odyssey');
  const details = page.locator('dl.details');
  await expect(details).toContainText('OS1');
  // Odyssey's name becomes another name; "OS-1" isn't kept, being the same model number as OS1.
  await expect(details).toContainText('Also known asOld Sensor');

  // The copy is gone, and searching its old name finds the merged product.
  await page.goto('/products');
  await expect(page.getByRole('link', { name: 'Old Sensor', exact: true })).toHaveCount(0);
  await page.getByPlaceholder('Search name, model, SKU or category').fill('old sensor');
  await expect(page.getByRole('link', { name: 'Legacy Sensor', exact: true })).toBeVisible();
});

test('vendors: synced ones are read-only; the team adds a lab with a contact and product', async ({ page }) => {
  await login(page, 'editor');
  await nav(page, 'Vendors');
  await expect(page.getByRole('link', { name: 'Sample Factory' })).toBeVisible();
  await page.getByRole('link', { name: 'Sample Factory' }).click();
  await expect(page.getByText('Contacts come from Odyssey.')).toBeVisible();
  await expect(page.getByText('WeChat: alex_w')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add contact' })).toHaveCount(0);

  await nav(page, 'Vendors');
  await page.getByRole('button', { name: 'Add vendor' }).click();
  await field(page, 'Name').fill('E2E Test Lab');
  await field(page, 'Type', 'select').selectOption('cert_lab');
  await field(page, 'Country').fill('UK');
  await page.getByRole('button', { name: 'Add vendor' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Test Lab' })).toBeVisible();

  await page.getByRole('button', { name: 'Add contact' }).click();
  await field(page, 'Name').fill('Sam Tester');
  await field(page, 'Email').fill('sam@lab.example');
  await field(page, 'WeChat').fill('sam_lab');
  await page.getByRole('button', { name: 'Add contact' }).click();
  await expect(page.getByRole('link', { name: 'sam@lab.example' })).toBeVisible();

  await page.getByLabel('Product to link').selectOption({ label: 'Sample Doorbell (SD-100)' });
  await page.getByLabel('Role').selectOption('cert_lab');
  await page.getByRole('button', { name: 'Link product' }).click();
  await expect(page.locator('.card', { hasText: 'Products' }).getByRole('link', { name: 'Sample Doorbell' })).toBeVisible();

  // The lab is now offered on certifications.
  await page.goto('/certifications?new');
  await expect(field(page, 'Lab', 'select').locator('option', { hasText: 'E2E Test Lab' })).toHaveCount(1);
});
