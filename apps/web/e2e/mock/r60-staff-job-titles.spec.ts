import { expect, test } from '@playwright/test';

// Octavia's SM3 and SM11 (review of Oct 21 to 22): Staff Settings > Offices & Job Titles opened
// Add Staff; it now opens the list editor, and Create Staff offers the saved titles. Mock mode
// (playwright.mock.config.ts) as the Owner; the mock keeps its data in the page, so the test moves
// between pages by their links. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('adds, renames, archives and restores job titles, and lists the offices', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/settings'));
  await page.getByRole('link', { name: 'Manage Offices & Job Titles' }).click();
  await expect(page).toHaveURL(/\/team\/settings\/offices-titles$/, { timeout: 30_000 });
  await expect(page).toHaveTitle('Offices & job titles');

  const titles = page.getByTestId('job-titles');
  const row = (name: string) =>
    titles.getByTestId('job-title-row').filter({
      has: page.getByTestId('job-title-name').getByText(name, { exact: true }),
    });
  // The titles the records carry, each with how many records have it.
  await expect(row('Tax Preparer')).toContainText('2 staff records');
  await expect(row('Intern')).toContainText('1 staff record');

  await page.getByTestId('new-job-title').fill('Senior Tax Preparer');
  await page.getByRole('button', { name: 'Add Job Title' }).click();
  await expect(row('Senior Tax Preparer')).toContainText('No staff records');
  await page.getByTestId('new-job-title').fill('tax preparer');
  await page.getByRole('button', { name: 'Add Job Title' }).click();
  await expect(titles.getByRole('alert')).toContainText('already has a job title');

  await row('Intern').getByRole('button', { name: 'Rename Intern' }).click();
  await page.getByLabel('New name for Intern').fill('Seasonal Intern');
  await titles.getByRole('button', { name: 'Save' }).click();
  await expect(row('Seasonal Intern')).toBeVisible();

  await row('Bookkeeper').getByRole('button', { name: 'Archive Bookkeeper' }).click();
  await expect(row('Bookkeeper')).toHaveCount(0);
  await page.getByLabel('Show archived titles (1)').check();
  await expect(row('Bookkeeper')).toContainText('Archived');
  await row('Bookkeeper').getByRole('button', { name: 'Restore Bookkeeper' }).click();
  await expect(row('Bookkeeper')).not.toContainText('Archived');

  const offices = page.getByTestId('offices');
  await expect(offices.getByTestId('office-row')).toHaveText(['Main Office', 'Riverside Office']);

  // Create Staff offers the saved titles, the new one included.
  await page.getByRole('link', { name: 'Back to Staff Settings' }).click();
  await page.getByRole('link', { name: 'Back to Staff Management' }).click();
  await page.getByRole('link', { name: 'Add Staff' }).first().click();
  await expect(page.locator('datalist#job-titles option[value="Senior Tax Preparer"]')).toHaveCount(
    1,
  );
  await expect(page.locator('datalist#job-titles option[value="Intern"]')).toHaveCount(0);
});
