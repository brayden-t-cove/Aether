import { readFileSync } from 'node:fs';
import { expect, field, login, nav, slackMessages, test } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('bulk import shows a preview, then loads products and a project', async ({ page }) => {
  await login(page);
  await nav(page, 'Import');
  await page.locator('input[type=file]').setInputFiles('e2e/fixtures/sample-import.json');
  await expect(page.getByText('This will: 4 new products, 0 product updates, 1 new projects.')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible();

  // Paste path: a spreadsheet copy with the header row, re-run is an update, not a duplicate.
  await page.getByRole('button', { name: 'Import more' }).click();
  await page.getByLabel('Pasted table').fill('Name\tModel\tNotes\nSample Doorbell\tSD-100\tUpdated from a paste');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('This will: 0 new products, 1 product updates')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible();
});

test('products list filters by lifecycle and shows replacements', async ({ page }) => {
  await login(page);
  await nav(page, 'Products');
  await expect(page.locator('tbody tr')).toHaveCount(4);
  await page.getByRole('tab', { name: 'In development' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Replaces W4');
  await page.getByRole('link', { name: 'Sample Window Cam (V2)' }).click();
  await expect(page.getByText('Planned markets')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sample Window Cam (W4)' })).toBeVisible();
});

test('an editor adds a product and starts a US launch from the checklist template', async ({ page }) => {
  await login(page, 'editor');
  await nav(page, 'Products');
  await page.getByRole('button', { name: 'Add product' }).click();
  await field(page, 'Name').fill('E2E Floodlight');
  await field(page, 'Model').fill('FL-1');
  await field(page, 'Category').fill('Outdoor');
  await field(page, 'Lifecycle', 'select').selectOption('upcoming');
  await page.getByRole('button', { name: 'Add product' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Floodlight' })).toBeVisible();

  await page.getByRole('link', { name: 'Start a project' }).click();
  await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible();
  await expect(field(page, 'Project name')).toHaveValue('E2E Floodlight — US launch');
  await expect(field(page, 'Market', 'select')).toHaveValue(/.+/); // US filled in by the template
  await field(page, 'Target date').fill('2026-12-15');
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page.getByRole('heading', { name: 'E2E Floodlight — US launch' })).toBeVisible();
  const stages = page.locator('.group-title');
  await expect(stages).toHaveCount(7);
  await expect(stages.first()).toContainText('Validate the product');
  await expect(stages.last()).toContainText('Post launch');
  await expect(page.getByRole('button', { name: 'FCC certification complete', exact: true })).toBeVisible();
});

test("an item can't be done while it waits on something open; blocking one posts to Slack", async ({ page, request }) => {
  await login(page, 'editor');
  await nav(page, 'Projects');
  await page.getByRole('link', { name: 'E2E Floodlight — US launch', exact: true }).click();

  const state = (title) => page.locator(`select[aria-label^="State of ${title}"]`);
  const row = (title) => page.locator('li.item').filter({ has: state(title) });
  // Picking a state asks why; the note is optional.
  const setState = async (title, value, label, note) => {
    await state(title).selectOption(value);
    const form = row(title).locator('form.state-note');
    if (note) await form.getByLabel('Why the state changed').fill(note);
    await form.getByRole('button', { name: `Mark ${label}` }).click();
  };

  await setState('Full technical specs defined', 'done', 'Done');
  await expect(row('Full technical specs defined').locator('.alert.error')).toContainText("Can't mark as done while waiting on: Discussion on specs and pricing");
  await row('Full technical specs defined').getByRole('button', { name: 'Cancel' }).click();
  await expect(state('Full technical specs defined')).toHaveValue('not_started');

  await setState('Comparative analysis', 'done', 'Done');
  await expect(state('Comparative analysis')).toHaveValue('done');
  await setState('Functionality testing', 'done', 'Done');
  await setState('Discussion on specs and pricing', 'done', 'Done');
  await setState('Full technical specs defined', 'done', 'Done');
  await expect(state('Full technical specs defined')).toHaveValue('done');

  // Open an item into its side panel and edit it: owner, due date in the past (overdue). Notes are dated updates, not a field.
  const title = row('Mold design').getByRole('button', { name: 'Mold design', exact: true });
  await expect(title).toHaveAttribute('aria-expanded', 'false');
  await title.click();
  await expect(title).toHaveAttribute('aria-expanded', 'true');
  await expect(page).toHaveURL(/\?item=/);
  const open = page.getByRole('complementary', { name: 'Details of Mold design' });
  await expect(field(open, 'Notes', 'textarea')).toHaveCount(0);
  await open.getByLabel('New update on Mold design').fill('Waiting on factory drawings');
  await open.getByRole('button', { name: 'Post update' }).click();
  await expect(open.locator('.update')).toContainText('Waiting on factory drawings');
  await field(open, 'Owner', 'select').selectOption({ label: 'Ella Editor' });
  await field(open, 'Due date').fill('2026-01-15');
  await open.getByRole('button', { name: 'Save' }).click();
  await expect(row('Mold design')).toContainText('Overdue');
  await expect(row('Mold design').locator('.item-latest')).toContainText('“Waiting on factory drawings” — Ella Editor');
  // Escape closes the panel.
  await open.press('Escape');
  await expect(open).toHaveCount(0);
  await expect(page).not.toHaveURL(/\?item=/);

  // The tick is the quick way to finish an item, and to reopen it.
  await row('Comparative analysis').getByRole('button', { name: 'Reopen: Comparative analysis' }).click();
  await expect(state('Comparative analysis')).toHaveValue('in_progress');
  await row('Comparative analysis').getByRole('button', { name: 'Tick off: Comparative analysis' }).click();
  await expect(state('Comparative analysis')).toHaveValue('done');

  const before = (await slackMessages(request)).length;
  await state('Integration discussion').selectOption('blocked');
  await expect(row('Integration discussion').getByLabel('Why the state changed')).toHaveAttribute('placeholder', /What's blocking it/);
  await setState('Integration discussion', 'blocked', 'Blocked', 'Waiting on the app team for the API spec');
  await expect(state('Integration discussion')).toHaveValue('blocked');
  await expect.poll(async () => (await slackMessages(request)).length).toBe(before + 1);
  const msg = (await slackMessages(request)).at(-1);
  expect(msg).toMatch(/^\[staging\] 🚧 <http:\/\/localhost:4100\/projects\/.+\|Integration discussion> was marked \*Blocked\*.*\n> Waiting on the app team for the API spec/s);
  // The reason shows under the item, and opens into the thread of updates.
  await expect(row('Integration discussion').locator('.item-latest')).toContainText('“Waiting on the app team for the API spec” — Ella Editor, just now');
  await row('Integration discussion').locator('.item-latest').click();
  const updates = page.getByRole('region', { name: 'Updates on Integration discussion' });
  await expect(updates.locator('.update')).toHaveCount(1);
  await expect(updates.locator('.update-change')).toContainText('Not started');
  await expect(updates.locator('.update-change')).toContainText('Blocked');
  await updates.getByLabel('New update on Integration discussion').fill('Chased them again today; promised by Friday.');
  await updates.getByRole('button', { name: 'Post update' }).click();
  await expect(updates.locator('.update')).toHaveCount(2);
  await expect(updates.locator('.update').last()).toContainText('promised by Friday');
  await updates.locator('.update').last().getByRole('button', { name: 'Edit' }).click();
  await updates.getByLabel('Edit update').fill('Chased them again today; promised by Thursday.');
  await updates.getByRole('button', { name: 'Save' }).click();
  await expect(updates.locator('.update').last()).toContainText('promised by Thursday');
  await expect(updates.locator('.update').last()).toContainText('edited');
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(updates).toHaveCount(0);
  await expect(row('Integration discussion').locator('.item-latest')).toContainText('2 updates');

  // Add a custom item into a stage.
  await page.getByLabel('New item title').fill('Confirm IR cut filter supplier');
  await page.getByLabel('New item stage').selectOption('Arrangements for making the product');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.item-group', { hasText: 'Arrangements for making the product' })).toContainText('Confirm IR cut filter supplier');

  await expect(page.locator('.summary')).toContainText('Blocked');
  await expect(page.locator('.summary .flag-blocked')).toHaveText('1');
  await expect(page.locator('.summary .flag-overdue')).toHaveText('1');
});

test('dashboard shows the blocked and overdue items and the activity', async ({ page }) => {
  await login(page);
  const stat = (label) => page.locator('.stat', { hasText: label }).locator('.stat-value');
  await expect(stat('Blocked items')).toHaveText('1');
  await expect(stat('Overdue items')).toHaveText('1');
  const card = (title) => page.locator('.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(card('Blocked')).toContainText('Integration discussion');
  await expect(card('Overdue')).toContainText('Mold design');
  await expect(page.getByText('Ella Editor moved "Integration discussion" to Blocked')).toBeVisible();
  const row = card('Open projects').locator('tr', { hasText: 'E2E Floodlight — US launch' });
  await expect(row).toContainText('New product');
  await expect(row).toContainText('Ella Editor');

  // The latest update says why it's blocked; the link opens that item on the project page.
  await expect(card('Blocked')).toContainText('“Chased them again today; promised by Thursday.” — Ella Editor');
  await expect(page.getByText('Ella Editor on "Integration discussion": “Waiting on the app team for the API spec”')).toBeVisible();
  await card('Blocked').getByRole('link', { name: 'Integration discussion' }).click();
  await expect(page.getByRole('region', { name: 'Updates on Integration discussion' }).locator('.update')).toHaveCount(2);
});

test('international launch template fills in the market details', async ({ page }) => {
  await login(page, 'editor');
  await page.goto('/projects/new');
  await page.locator('label.choice', { hasText: 'International launch' }).click();
  await field(page, 'Product', 'select').selectOption({ label: 'Sample Doorbell (SD-100)' });
  await field(page, 'Market', 'select').selectOption({ label: 'UK · United Kingdom' });
  await expect(field(page, 'Project name')).toHaveValue('Sample Doorbell — UK launch');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('button', { name: 'Identify certification requirements for the camera and accessories (e.g. UKCA)', exact: true })).toBeVisible();
  await expect(page.locator('.item-title', { hasText: /type G plug, 230V/ })).toBeVisible();
});

test('markets page lists the seeded markets and editors can add one', async ({ page }) => {
  await login(page, 'editor');
  await nav(page, 'Markets');
  for (const code of ['US', 'CA', 'UK', 'EU', 'AU', 'MX', 'ZA']) await expect(page.getByRole('link', { name: code, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add market' }).click();
  await field(page, 'Code').fill('nz');
  await field(page, 'Name').fill('New Zealand');
  await field(page, 'Required marks').fill('RCM');
  await page.getByRole('button', { name: 'Add market' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /NZ/ })).toBeVisible();
  expect(readFileSync('e2e/fixtures/sample-import.json', 'utf8')).toContain('Sample'); // fixtures are fake data only
});
