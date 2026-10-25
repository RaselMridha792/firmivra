import { expect, test } from '@playwright/test';

// Octavia's SM8 (review of Oct 23): company-defined work schedules. Staff Settings > Offices & Job
// Titles has a Work Schedules card (add, rename, archive, restore), and Create Staff offers the
// standard schedules, then the saved ones. Mock mode (playwright.mock.config.ts) as the Owner; the
// mock keeps its data in the page. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test('adds, renames, archives and restores work schedules', async ({ page }) => {
  await page.goto(app('/team/settings/offices-titles'));
  const card = page.getByTestId('work-schedules');
  const row = (name: string) =>
    card.getByTestId('work-schedule-row').filter({
      has: page.getByTestId('work-schedule-name').getByText(name, { exact: true }),
    });
  // The schedule the records carry, with how many records have it.
  await expect(row('Full-Time')).toContainText('staff records', { timeout: 60_000 });

  await page.getByTestId('new-work-schedule').fill('Four-day week');
  await page.getByRole('button', { name: 'Add Work Schedule' }).click();
  await expect(row('Four-day week')).toContainText('No staff records');
  await page.getByTestId('new-work-schedule').fill('FOUR-DAY WEEK');
  await page.getByRole('button', { name: 'Add Work Schedule' }).click();
  await expect(card.getByRole('alert')).toContainText('already has a work schedule');

  await row('Four-day week').getByRole('button', { name: 'Rename Four-day week' }).click();
  await page.getByLabel('New name for Four-day week').fill('Mon-Thu, 10-hour days');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(row('Mon-Thu, 10-hour days')).toBeVisible();

  await row('Full-Time').getByRole('button', { name: 'Archive Full-Time' }).click();
  await expect(row('Full-Time')).toHaveCount(0);
  await card.getByLabel('Show archived schedules (1)').check();
  await expect(row('Full-Time')).toContainText('Archived');
  await row('Full-Time').getByRole('button', { name: 'Restore Full-Time' }).click();
  await expect(row('Full-Time')).not.toContainText('Archived');
  // The job titles keep their own card.
  await expect(page.getByTestId('job-titles').getByTestId('job-title-row').first()).toBeVisible();
});

test('Create Staff offers the standard schedules, then the saved ones', async ({ page }) => {
  await page.goto(app('/team/new/details'));
  const schedule = page.getByRole('combobox', { name: 'Work Schedule' });
  await expect(schedule).toBeVisible({ timeout: 60_000 });
  await expect(schedule.locator('option')).toHaveText([
    'Select schedule',
    'Full-time (Mon-Fri, 9-5)',
    'Part-time (mornings)',
    'Part-time (afternoons)',
    'Seasonal (tax season)',
    'Flexible',
    'Full-Time',
    'Custom schedule…',
  ]);
  await schedule.selectOption({ label: 'Custom schedule…' });
  await expect(page.getByText('A custom schedule stays on this staff record.')).toBeVisible();
});
