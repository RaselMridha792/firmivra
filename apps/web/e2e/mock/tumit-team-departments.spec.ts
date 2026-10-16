import { expect, test } from '@playwright/test';

// Teams & Departments, Departments tab, in mock mode (playwright.mock.config.ts). The mock is
// R42's createDepartmentsMock: 7 departments (Human Resources inactive), 11 teams. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/team/departments`;

test('lists departments with their counts and shows the chosen one', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await expect(page).toHaveTitle('Teams & departments');
  await expect(page.getByRole('heading', { name: 'Teams & Departments', level: 1 })).toBeVisible();
  const kpis = page.getByTestId('groups-kpis');
  await expect(kpis).toContainText('Total Departments');
  await expect(kpis).toContainText('% active');
  await expect(page.getByRole('link', { name: 'Departments', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const rows = page.getByTestId('department-row');
  await expect(rows).toHaveCount(7);
  await expect(page.getByText('Showing 1 – 7 of 7 departments')).toBeVisible();
  // The first department is open; another opens on click.
  const details = page.getByTestId('department-details');
  await expect(details).toContainText('Tax');
  await rows.filter({ hasText: 'Bookkeeping' }).click();
  await expect(details).toContainText('Bookkeeping');
  await expect(page.getByTestId('department-teams')).toContainText('Monthly Books');

  // Search and status filter.
  await page.getByLabel('Search departments').fill('pay');
  await expect(rows).toHaveCount(1);
  await page.getByLabel('Search departments').fill('');
  await page.getByLabel('Status').selectOption('inactive');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Human Resources');
});

test('owner adds a department, changes its head and archives one with staff', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const rows = page.getByTestId('department-row');
  await expect(rows).toHaveCount(7);

  // Add: an empty name is caught first, a used name comes back from the API.
  await page.getByTestId('add-department').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Add Department' }).click();
  await expect(dialog.getByText('Enter a name.')).toBeVisible();
  await dialog.getByLabel('Name *').fill('Tax');
  await dialog.getByRole('button', { name: 'Add Department' }).click();
  await expect(dialog.getByRole('alert')).toContainText('already used');
  await dialog.getByLabel('Name *').fill('Advisory');
  await dialog.getByLabel('Description').fill('Synthetic advisory work.');
  await dialog.getByRole('button', { name: 'Add Department' }).click();
  await expect(rows).toHaveCount(8);
  await expect(page.getByTestId('department-details')).toContainText('Advisory');

  // Change Head from the row menu.
  await page.getByRole('button', { name: 'Actions for Advisory' }).click();
  await page.getByRole('menuitem', { name: 'Change Head' }).click();
  const head = page.getByRole('dialog');
  await head.getByLabel('Department Head').selectOption({ index: 1 });
  await head.getByRole('button', { name: 'Save' }).click();
  await expect(head).toBeHidden();
  await expect(page.getByTestId('department-details')).not.toContainText('No head yet');

  // Archive a department with staff: its people move to another active department first.
  await page.getByRole('button', { name: 'Actions for Payroll' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  const archive = page.getByRole('dialog');
  await archive.getByRole('button', { name: 'Archive' }).click();
  await expect(archive.getByText('Choose where its staff go.')).toBeVisible();
  await archive.getByLabel('Move its staff to *').selectOption({ label: 'Tax' });
  await archive.getByRole('button', { name: 'Archive' }).click();
  await expect(archive).toBeHidden();
  await expect(rows.filter({ hasText: 'Payroll' })).toContainText('Payroll');
  await expect(page.getByRole('row').filter({ hasText: 'Payroll' })).toContainText('Archived');
});
