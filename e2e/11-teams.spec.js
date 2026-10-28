import { expect, login, nav, test } from './helpers.js';

test.describe.configure({ mode: 'serial' });

// Builds on the E2E Floodlight project from 02. People wear several hats: Ella (International) also does Design.

test('an admin puts someone on several teams', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/admin/users');
  const teams = page.getByRole('group', { name: 'Teams of Ella Editor' });
  await expect(teams.getByRole('button', { name: 'International Expansion' })).toHaveAttribute('aria-pressed', 'true');
  await teams.getByRole('button', { name: 'Design' }).click();
  await expect(teams.getByRole('button', { name: 'Design' })).toHaveAttribute('aria-pressed', 'true');
  await expect(teams.getByRole('button', { name: 'International Expansion' })).toHaveAttribute('aria-pressed', 'true');
});

test('a project lists its people, and items go to their team until someone takes them', async ({ page }) => {
  await login(page, 'editor');
  await nav(page, 'Projects');
  await page.getByRole('link', { name: 'E2E Floodlight — US launch', exact: true }).click();
  const projectId = page.url().split('/projects/')[1].split('?')[0];

  const people = page.getByRole('region', { name: 'People on this project' });
  await people.getByRole('button', { name: 'Edit people' }).click();
  await people.getByLabel(/Vic Viewer/).check();
  await people.getByRole('button', { name: 'Save people' }).click();
  await expect(people).toContainText('Vic Viewer');
  await expect(page.locator('.activity')).toContainText('Vic Viewer');

  // A design item nobody has: it shows as the Design team's.
  const res = await page.request.post(`/api/projects/${projectId}/items`, { data: { title: 'Hero render', category: 'design' } });
  expect(res.ok()).toBe(true);
  await page.reload();
  await expect(page.locator('li.item', { hasText: 'Hero render' })).toContainText('Design team');

  // Ella is on Design, so it's up for grabs on her My work; taking it makes it hers.
  await nav(page, 'My work');
  await expect(page.getByRole('heading', { level: 1, name: 'My work' })).toBeVisible();
  const grabs = page.locator('.card', { has: page.getByRole('heading', { name: /^Up for grabs/ }) });
  const row = grabs.locator('li', { hasText: 'Hero render' });
  await row.getByRole('button', { name: 'Take it' }).click();
  const yours = page.locator('.card', { has: page.getByRole('heading', { name: /^Yours/ }) });
  await expect(yours).toContainText('Hero render');
  await expect(grabs).not.toContainText('Hero render');
  await expect(page.locator('.card', { has: page.getByRole('heading', { name: /^Projects you're on/ }) })).toContainText('E2E Floodlight — US launch');

  // Anyone can look at someone else's work.
  await page.getByLabel('Whose work').selectOption({ label: 'Vic Viewer' });
  await expect(page.getByRole('heading', { level: 1, name: "Vic Viewer's work" })).toBeVisible();
});
