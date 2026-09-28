import { expect, field, login, nav, slackMessages, test } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const pdf = { name: 'fcc-grant.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% e2e grant\n') };

test('a certification is recorded with a lab, number, expiry and an uploaded grant', async ({ page, request }) => {
  await login(page, 'editor');
  await nav(page, 'Certifications');
  await page.getByRole('button', { name: 'Add certification' }).click();
  await field(page, 'Product', 'select').selectOption({ label: 'Sample Window Cam (V2) (SW-200)' });
  await field(page, 'Market', 'select').selectOption({ label: 'US · United States' });
  await expect(field(page, 'Mark')).toHaveValue('FCC');
  await field(page, 'State', 'select').selectOption('certified');
  await field(page, 'Certificate number').fill('2AE2E-SW200');
  const soon = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  await field(page, 'Expires').fill(soon);
  const before = (await slackMessages(request)).length;
  await page.getByRole('button', { name: 'Add certification' }).click();

  await expect(page.getByRole('heading', { name: /FCC/ })).toBeVisible();
  await expect(page.getByText('Expires soon')).toBeVisible();
  await page.locator('.attachments input[type=file]').setInputFiles(pdf);
  const link = page.getByRole('link', { name: 'fcc-grant.pdf' });
  await expect(link).toBeVisible();

  // The download is served inline, only to signed-in users.
  const href = await link.getAttribute('href');
  const res = await page.request.get(href);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect((await res.body()).toString()).toContain('e2e grant');

  await page.getByRole('button', { name: 'Add link' }).click();
  await page.getByLabel('Link', { exact: true }).fill('https://drive.example/test-report');
  await page.getByLabel('Link name').fill('Lab test report');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Lab test report' })).toHaveAttribute('href', 'https://drive.example/test-report');
  expect((await slackMessages(request)).length).toBe(before); // created as certified: no state change to announce

  await page.getByRole('button', { name: 'Edit' }).click();
  await field(page, 'State', 'select').selectOption('rejected');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await slackMessages(request)).at(-1)).toMatch(/❌ .*FCC for Sample Window Cam \(V2\) \(US\).* is \*rejected\*/);
  await page.getByRole('button', { name: 'Edit' }).click();
  await field(page, 'State', 'select').selectOption('certified');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.details')).toContainText('Expires soon');
});

test('a manual moves through versions, with approval recorded and Slack told', async ({ page, request }) => {
  await login(page, 'editor');
  await nav(page, 'Manuals & packaging');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await field(page, 'Product', 'select').selectOption({ label: 'Sample Window Cam (V2) (SW-200)' });
  await field(page, 'Title').fill('User manual');
  await field(page, 'Languages').fill('English');
  await field(page, 'First version is', 'select').selectOption('in_design');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'User manual' })).toBeVisible();

  await page.getByRole('button', { name: 'New version' }).click();
  await expect(page.locator('.version.latest')).toContainText('v2');
  await page.locator('.version.latest input[type=file]').setInputFiles({ name: 'manual-v2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 v2') });
  await expect(page.locator('.version.latest').getByRole('link', { name: 'manual-v2.pdf' })).toBeVisible();
  await page.getByLabel('Notes for v2').fill('Added FCC statement');
  await page.getByLabel('Notes for v2').blur();

  await page.getByLabel('State of v2').selectOption('in_review');
  await expect.poll(async () => (await slackMessages(request)).at(-1)).toMatch(/User manual v2.* is ready for review/);

  await page.getByRole('link', { name: 'Request design work' }).click();
  await field(page, "What's needed").fill('Wall-mount diagram');
  await field(page, 'Type', 'select').selectOption('graphic');
  await field(page, 'Assigned to', 'select').selectOption({ label: 'Dana Design' });
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('heading', { name: 'Wall-mount diagram' })).toBeVisible();
  await expect.poll(async () => (await slackMessages(request)).at(-1)).toMatch(/New design request: .*Wall-mount diagram.* for Dana Design/);
});

test('design work is delivered with a file and approved', async ({ page, request }) => {
  await login(page, 'editor');
  await nav(page, 'Design requests');
  await page.getByRole('link', { name: 'Wall-mount diagram' }).click();
  await page.locator('.attachments input[type=file]').setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: Buffer.from('89504e47', 'hex') });
  await expect(page.getByRole('link', { name: 'diagram.png' })).toBeVisible();
  await page.getByLabel('Request state').selectOption('delivered');
  await expect.poll(async () => (await slackMessages(request)).at(-1)).toMatch(/Wall-mount diagram.* was delivered/);

  await login(page, 'admin');
  const review = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Waiting for review', exact: true }) });
  await expect(review).toContainText('User manual v2');
  await expect(review).toContainText('Wall-mount diagram');

  await page.goto('/manuals');
  await page.getByRole('link', { name: 'User manual' }).click();
  await page.getByLabel('State of v2').selectOption('approved');
  await expect(page.locator('.version.latest')).toContainText('approved by Alex Admin');
});

test('packaging is added and the readiness grid reflects everything', async ({ page }) => {
  await login(page, 'editor');
  await page.goto('/manuals?new');
  await field(page, 'Product', 'select').selectOption({ label: 'Sample Window Cam (V2) (SW-200)' });
  await field(page, 'Type', 'select').selectOption('packaging');
  await field(page, 'Title').fill('Retail box');
  await field(page, 'First version is', 'select').selectOption('sent');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Retail box' })).toBeVisible();

  await nav(page, 'Readiness');
  const row = page.locator('tr', { has: page.getByRole('link', { name: 'Sample Window Cam (V2)', exact: true }) });
  await expect(row).toContainText('Ready'); // FCC certified (expiring, not expired), manual approved, packaging sent
  // Certified but expiring within 90 days: the chip warns, the cell is still ready.
  await expect(row.locator('.cert-chip')).toHaveText('FCC !');
  await expect(row.locator('.cert-chip')).toHaveAttribute('title', 'FCC: Expires soon');
  const old = page.locator('tr', { hasText: 'Sample Doorbell' }).first();
  await expect(old).toContainText('Not tracked yet');
  await expect(page.getByRole('link', { name: 'Sample Old Cam' })).toHaveCount(0);
  await page.getByLabel('Include discontinued products').check();
  await expect(page.getByRole('link', { name: 'Sample Old Cam' })).toHaveCount(1);
});

test('regional variants are added on the product page', async ({ page }) => {
  await login(page, 'editor');
  await page.goto('/products');
  await page.getByRole('link', { name: 'Sample Doorbell', exact: true }).click();
  await page.getByRole('button', { name: 'Add variant' }).click();
  await field(page, 'Name').last().fill('UK variant');
  await page.locator('form').filter({ hasText: "What's different" }).locator('select').selectOption({ label: 'UK · United Kingdom' });
  await page.getByLabel("What's different").fill('Type G plug, UKCA label');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Type G plug, UKCA label')).toBeVisible();
  // US and CA from the import, UK from the launch project started earlier.
  await expect(page.locator('.readiness-card h3')).toHaveText([/^CA/, /^UK/, /^US/]);
});
