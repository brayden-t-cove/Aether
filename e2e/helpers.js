import { test as base, expect } from '@playwright/test';
import { E2E_PASSWORD, USERS } from './users.js';

/**
 * Every test fails if the page throws or logs an unexpected error. Expected
 * failures (e.g. a deliberate 409) are allowed by status code.
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const problems = [];
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (/status of (400|401|403|404|409|413|502|503)/.test(text)) return; // API refusals the tests trigger on purpose
      problems.push(`console: ${text}`);
    });
    page.on('dialog', (d) => d.accept());
    await use(page);
    if (problems.length) testInfo.annotations.push({ type: 'browser errors', description: problems.join('\n') });
    expect(problems, 'browser errors').toEqual([]);
  },
});
export { expect };

export async function login(page, who = 'admin') {
  const user = USERS[who];
  await page.context().clearCookies(); // switch users mid-test
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  return user;
}

/** A form control by the start of its label text (labels here wrap their input). */
export const field = (page, label, tag = 'input') =>
  page.locator(`xpath=//label[starts-with(normalize-space(.), "${label}")]//${tag}`).first();

/** Click a sidebar link and wait until that page's heading is showing. */
export async function nav(page, name) {
  await page.locator('.sidebar').getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}

export async function slackMessages(request) {
  const res = await request.get('http://127.0.0.1:4102/messages');
  return res.json();
}

/** The page must not scroll sideways (phone layouts). */
export async function expectNoHorizontalScroll(page) {
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(width + 1);
}
