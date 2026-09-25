import { expect, login, nav, slackMessages, test } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('Integrations shows what is connected, and the Slack buttons work', async ({ page, request }) => {
  await login(page);
  await nav(page, 'Integrations');
  const card = (title) => page.locator('.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(card('Odyssey')).toContainText('Connected');
  await expect(card('Odyssey')).toContainText('http://127.0.0.1:4101');
  await expect(card('Odyssey').locator('tbody tr')).toHaveCount(1); // the one sync from the products page
  await expect(card('Slack')).toContainText('Connected');
  await expect(card('File uploads')).toContainText('On');
  await expect(card('About this server')).toContainText('staging');
  await expect(page.locator('body')).not.toContainText('e2e-key');

  const before = (await slackMessages(request)).length;
  await card('Slack').getByRole('button', { name: 'Send a test message' }).click();
  await expect(card('Slack')).toContainText('Done');
  await card('Slack').getByRole('button', { name: "Send today's digest now" }).click();
  await expect(card('Slack')).toContainText('Digest sent');
  const msgs = await slackMessages(request);
  expect(msgs.slice(before)).toEqual([expect.stringContaining('Test message from Aether'), expect.stringContaining('Aether daily digest')]);
  expect(msgs.at(-1)).toMatch(/\*Blocked \(1\)\*/);
  expect(msgs.at(-1)).toMatch(/\*Overdue \(1\)\*/);

  await card('Odyssey').getByRole('button', { name: 'Sync now' }).click();
  await expect(card('Odyssey').locator('tbody tr')).toHaveCount(2);
});

test('a viewer sees everything but no editing controls', async ({ page }) => {
  await login(page, 'viewer');
  const checks = [
    ['/projects', 'Projects', 'New project'],
    ['/products', 'Products', 'Add product'],
    ['/certifications', 'Certifications', 'Add certification'],
    ['/manuals', 'Manuals & packaging', 'Add'],
    ['/design-requests', 'Design requests', 'New request'],
    ['/vendors', 'Vendors', 'Add vendor'],
    ['/comparisons', 'Comparisons', 'New comparison'],
  ];
  for (const [path, heading, button] of checks) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole('button', { name: button, exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: button, exact: true })).toHaveCount(0);
  }
  await page.goto('/projects');
  await page.getByRole('link', { name: 'E2E Floodlight — US launch', exact: true }).click();
  await expect(page.locator('.items select')).toHaveCount(0);
  await expect(page.locator('.add-item')).toHaveCount(0);
  await expect(page.locator('.items .state').first()).toBeVisible();
  await page.goto('/returns');
  await expect(page.getByRole('link', { name: 'Import returns' })).toHaveCount(0);
  await page.goto('/admin/integrations');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  // The API refuses too, not just the UI.
  const res = await page.request.post('/api/products', { data: { name: 'Sneaky' } });
  expect(res.status()).toBe(403);
});

test('every main page fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const paths = ['/', '/readiness', '/projects', '/products', '/markets', '/certifications', '/manuals', '/design-requests', '/vendors', '/returns?period=all', '/comparisons', '/admin/users', '/admin/import', '/admin/integrations'];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(scroll, `${path} scrolls sideways (${scroll}px on a ${width}px screen)`).toBeLessThanOrEqual(width + 1);
  }
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.locator('.sidebar')).toBeInViewport();
  await page.locator('.sidebar').getByRole('link', { name: 'Readiness' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Readiness' })).toBeVisible();
});

test('theme toggle switches to dark and is remembered', async ({ page }) => {
  await login(page);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await bg();
  await page.getByRole('button', { name: /Theme/ }).click(); // Auto → Light
  await page.getByRole('button', { name: /Theme/ }).click(); // Light → Dark
  await expect(page.getByRole('button', { name: /Theme/ })).toHaveText('Theme: Dark');
  expect(await bg()).not.toBe(light);
  await page.reload();
  await expect(page.getByRole('button', { name: /Theme/ })).toHaveText('Theme: Dark');
  await page.goto('/returns?period=all');
  await expect(page.getByRole('img', { name: 'Units returned per month by channel' })).toBeVisible();
});

test('signing out ends the session', async ({ page }) => {
  await login(page, 'editor');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login$/);
  const res = await page.request.get('/api/projects');
  expect(res.status()).toBe(401);
});
