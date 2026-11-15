import { expect, test } from '@playwright/test';

// R55, Leads Review Two R2 13: on the Leads list's date filter, an end date before the start date
// says "End date must be on or after the start date" and is never applied (the list stays as it
// was, Done waits); the same day, or a later end, is taken. Mock mode as the Owner (12 leads, all
// made before 2030). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('R2 13: a reversed range is held back with her message; an equal or corrected range applies', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  const rows = page.getByRole('table', { name: 'Leads' }).locator('tbody tr');
  await expect(rows).toHaveCount(8);
  await page.getByLabel(/^Date range:/).click();
  const from = page.getByLabel('Date Range: From, start date');
  const to = page.getByLabel('Date Range: To, end date');
  const done = page.getByRole('button', { name: 'Done' });
  const alert = page.getByRole('group', { name: 'Date Range' }).getByRole('alert');

  await to.fill('2030-06-01');
  await expect(page.getByLabel('Date range: To 6/1/2030')).toBeVisible();
  await from.fill('2030-06-10');
  await expect(alert).toHaveText('End date must be on or after the start date');
  await expect(to).toHaveAttribute('aria-invalid', 'true');
  await expect(done).toBeDisabled();
  // Not applied: the range in force is still "to June 1", and the list is unchanged.
  await expect(page.getByLabel('Date range: To 6/1/2030')).toBeVisible();
  await expect(page).not.toHaveURL(/from=/);
  await expect(rows).toHaveCount(8);

  // The same day is a range: taken, the message gone (no lead was made that day).
  await from.fill('2030-06-01');
  await expect(alert).toHaveCount(0);
  await expect(page.getByLabel('Date range: 6/1/2030 – 6/1/2030')).toBeVisible();
  await expect(rows).toHaveCount(0);

  // A start before the end: taken, and the leads are back.
  await from.fill('2020-01-01');
  await expect(page.getByLabel('Date range: 1/1/2020 – 6/1/2030')).toBeVisible();
  await expect(done).toBeEnabled();
  await expect(rows).toHaveCount(8);
});
