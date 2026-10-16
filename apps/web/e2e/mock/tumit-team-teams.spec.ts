import { expect, test } from '@playwright/test';

// Teams & Departments, Teams tab, in mock mode (playwright.mock.config.ts). The mock is R42's
// staff-management mock: 7 departments, 11 teams (Individual Tax first). Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/team`;

test('lists teams, filters them and shows the chosen one', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/teams`);
  await expect(page).toHaveTitle('Teams & departments: Teams');
  await expect(page.getByRole('link', { name: 'Teams', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const rows = page.getByTestId('team-row');
  await expect(rows).toHaveCount(10);
  await expect(page.getByText('Showing 1 – 10 of 11 teams')).toBeVisible();

  const details = page.getByTestId('team-details');
  await expect(details).toContainText('Individual Tax');
  await rows.filter({ hasText: 'Monthly Books' }).click();
  await expect(details).toContainText('Monthly Books');
  await expect(details).toContainText('Bookkeeping');

  await page.getByLabel('Department', { exact: true }).selectOption({ label: 'Payroll' });
  await expect(rows).toHaveCount(2);
  await page.getByLabel('Department', { exact: true }).selectOption({ label: 'All Departments' });
  await page.getByLabel('Search teams').fill('front');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Front Desk');
});

test('the Departments tab opens the teams of a department and one team', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/departments`);
  await page.getByTestId('department-row').filter({ hasText: 'Bookkeeping' }).click();
  await expect(page.getByTestId('department-teams')).toContainText('Cleanup Projects');

  await page.getByRole('link', { name: 'View All Teams' }).click();
  await expect(page).toHaveURL(/\/team\/teams\?departmentId=/);
  await expect(page.getByTestId('team-row')).toHaveCount(2);
  await expect(page.getByLabel('Department', { exact: true })).toHaveValue(/.+/);

  await page.goBack();
  await page.getByTestId('department-row').filter({ hasText: 'Bookkeeping' }).click();
  await page.getByRole('button', { name: 'Actions for Cleanup Projects' }).click();
  await page.getByRole('menuitem', { name: 'Open Team' }).click();
  await expect(page).toHaveURL(/\/team\/teams\?teamId=/);
  await expect(page.getByTestId('team-details')).toContainText('Cleanup Projects');
});

test('owner adds a team, sets its members, moves and archives it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/teams`);
  await expect(page.getByTestId('team-row')).toHaveCount(10);

  // Add: name and department are required; a used name comes back from the API.
  await page.getByTestId('add-team').click();
  const add = page.getByRole('dialog');
  await add.getByRole('button', { name: 'Add Team' }).click();
  await expect(add.getByText('Enter a name.')).toBeVisible();
  await expect(add.getByText('Choose a department.')).toBeVisible();
  await add.getByLabel('Name *').fill('Front Desk');
  await add.getByLabel('Department *').selectOption({ label: 'Tax' });
  await add.getByRole('button', { name: 'Add Team' }).click();
  await expect(add.getByRole('alert')).toContainText('already used');
  await add.getByLabel('Name *').fill('Quality Review');
  await add.getByRole('button', { name: 'Add Team' }).click();
  await expect(add).toBeHidden();
  await expect(page.getByTestId('team-details')).toContainText('Quality Review');

  // The new team is the twelfth, on page 2: find it by search.
  await page.getByLabel('Search teams').fill('quality');
  const row = page.getByRole('row').filter({ hasText: 'Quality Review' });
  await expect(row).toContainText('Tax');

  // Manage Members: one person as the team's backup.
  await page.getByRole('button', { name: 'Actions for Quality Review' }).click();
  await page.getByRole('menuitem', { name: 'Manage Members' }).click();
  const members = page.getByRole('dialog');
  await members.getByRole('checkbox').first().check();
  await members.getByLabel(/^Place of /).selectOption('BACKUP');
  await members.getByRole('button', { name: 'Save Members' }).click();
  await expect(members).toBeHidden();
  await expect(page.getByTestId('team-member')).toHaveCount(1);
  await expect(page.getByTestId('team-member')).toContainText('Backup');

  // Move Department.
  await page.getByRole('button', { name: 'Actions for Quality Review' }).click();
  await page.getByRole('menuitem', { name: 'Move Department' }).click();
  const move = page.getByRole('dialog');
  await move.getByLabel('Move to department *').selectOption({ label: 'Payroll' });
  await move.getByRole('button', { name: 'Move Team' }).click();
  await expect(move).toBeHidden();
  await expect(row).toContainText('Payroll');

  // Archive keeps the row and its history.
  await page.getByRole('button', { name: 'Actions for Quality Review' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(row).toContainText('Archived');
});
