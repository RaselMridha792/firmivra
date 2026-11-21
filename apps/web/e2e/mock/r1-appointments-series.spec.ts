import { expect, type Page, test } from '@playwright/test';

// R1, Appointments Review 2 R2: editing or cancelling one of a repeating series asks which
// appointments it reaches: This appointment, This and later appointments, or All appointments in
// the series. Mock mode (mocks/appointments-scheduling.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const LABELS = [
  'This appointment',
  'This and later appointments',
  'All appointments in the series',
];

/** Books a weekly appointment for Kendra Gill and returns its page's address. */
async function bookWeekly(page: Page) {
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Client / Lead *').fill('Kendra');
  await page
    .getByTestId('contact-results')
    .getByRole('button', { name: /Kendra Gill/ })
    .click();
  await page.getByLabel('Appointment Type *').selectOption({ label: 'Follow-Up' });
  await page.getByLabel('Repeat').selectOption('WEEKLY');
  await page.getByRole('button', { name: 'Schedule Appointment' }).click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  return page.url();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00-04:00'));
  await page.setViewportSize({ width: 1440, height: 1100 });
});

test('R2: Cancel on a repeating appointment asks which ones, This appointment first, and cancels', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const detail = await bookWeekly(page);
  await page.getByRole('button', { name: 'Cancel Appointment' }).click();
  const scope = page.getByTestId('cancel-scope');
  for (const label of LABELS) await expect(scope.getByLabel(label)).toBeVisible();
  await expect(scope.getByLabel('This appointment')).toBeChecked();
  await scope.getByLabel('This and later appointments').check();
  await expect(scope.getByLabel('This and later appointments')).toBeChecked();
  await expect(scope.getByLabel('This appointment')).not.toBeChecked();
  // Cancel keeps the dialog's own reason field. What each choice cancels is the API's (e2e
  // `scheduling` "Review 2 (R2): edit and cancel a series"); the booked mock record is not in
  // the appointments mock's store, so the cancel itself is not completed here.
  await expect(page.getByRole('dialog', { name: 'Cancel Appointment' })).toContainText(
    'They are told',
  );
  expect(page.url()).toBe(detail);
});

test('R2: Edit on a repeating appointment asks which ones it applies to; a single one is not asked', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const detail = await bookWeekly(page);
  // By its link: the mock's data lives in the page.
  await page.getByRole('link', { name: 'Edit', exact: true }).first().click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}\/edit$/, { timeout: 60_000 });
  const scope = page.getByTestId('edit-scope');
  await expect(scope).toBeVisible({ timeout: 60_000 });
  for (const label of LABELS) await expect(scope.getByLabel(label)).toBeVisible();
  await expect(scope.getByLabel('This appointment')).toBeChecked();
  // Another scope saves the change (the repeat itself is not sent with it).
  await scope.getByLabel('All appointments in the series').check();
  await page
    .getByLabel('Internal Notes (not visible to client)')
    .fill('Fake: applies to the whole series');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page).toHaveURL(detail, { timeout: 60_000 });
});

test('R2: a one-off appointment has no scope question', async ({ page }) => {
  test.setTimeout(240_000);
  // A one-off appointment (the mock's seeded Nina) has no scope question.
  await page.goto(app('/calendar/0199c0b0-0a10-7000-8000-000000000002/edit'));
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('edit-scope')).toHaveCount(0);
});
