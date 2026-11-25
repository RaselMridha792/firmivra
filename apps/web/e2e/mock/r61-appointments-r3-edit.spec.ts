import { expect, test } from '@playwright/test';

// R3 (Review 2): Save Changes on Edit must land on the appointment's detail page.
// Saving bumps the record version, and the edit page remounts this form (key=version);
// with mutate(..., { onSuccess }) TanStack Query drops the callback of the unmounted form,
// so router.push() never runs and the user stays on /edit (live trace appointments-153949).
// Synthetic data only, mock mode (playwright.mock.config.ts), signed in as the Owner.
// Nina Fairbanks (daniel) is 11:00-12:00 on the 1st; 09:00-10:00 and 10:00-11:00 are free for
// her, so these edits conflict with nothing.
// Note: the mock blocks 2-3 PM every day, so a mock appointment cannot be made all-day at all;
// the all-day direction is covered by the live spec and by trace appointments-153949.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const NINA = '0199c0b0-0a10-7000-8000-000000000002';

test('R3: Save Changes from Edit lands on the detail (timed to an earlier hour)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/calendar/${NINA}/edit`));
  await expect(page).toHaveTitle('Edit appointment');
  await page.getByLabel('Start Time *').selectOption('09:00');
  await page.getByLabel('End Time *').selectOption('10:00');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar/${NINA}$`), { timeout: 30_000 });
  await expect(page.getByTestId('detail-summary')).toContainText('9:00 AM');
});

test('R3: Save Changes from Edit lands on the detail after a second edit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/calendar/${NINA}/edit`));
  await page.getByLabel('Start Time *').selectOption('10:00');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar/${NINA}$`), { timeout: 30_000 });

  // A second save from the detail's Edit link: the form remounts again (key=version).
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Start Time *').selectOption('11:00');
  await page.getByLabel('End Time *').selectOption('12:00');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar/${NINA}$`), { timeout: 30_000 });
  await expect(page.getByTestId('detail-summary')).toContainText('11:00 AM');
});
