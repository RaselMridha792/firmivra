import { expect, test } from '@playwright/test';

// R56, Client Portal module gaps from R60's cross-check of the developer instructions, in mock
// mode as the Owner (the clients, client portal, scheduling, tax returns and intake forms mocks):
// an activity row opens its record (24), an overdue pending action gets Send Reminder (17), and
// the Tax Returns tab shows each return's assigned staff (4). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test('instructions 24: an activity row opens its record; one with no record stays text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/client-portal/${JAMIE}/activity`));
  const rows = page.getByTestId('activity-row');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  // A sign-in has no record of its own.
  await expect(rows.filter({ hasText: 'Portal Login' }).getByTestId('activity-record')).toHaveCount(
    0,
  );
  const booked = rows
    .filter({ hasText: 'Appointment Scheduled' })
    .getByRole('link', { name: 'Appointment Scheduled' });
  await expect(booked).toHaveAttribute('href', '/calendar/0199c0b0-0a10-7000-8000-000000000001');
  await booked.click();
  await expect(page).toHaveURL(/\/calendar\/0199c0b0-0a10-7000-8000-000000000001$/);
});

test('instructions 17: an overdue pending action has Send Reminder; the others do not', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(app(`/client-portal/${JAMIE}`));
  const pending = page.getByTestId('pending-actions');
  await expect(pending).toContainText('Intake Form Incomplete', { timeout: 60_000 });
  const reminders = pending.getByRole('button', { name: /^Send Reminder/ });
  await expect(reminders).toHaveCount(1);
  await expect(page.getByTestId('pending-INTAKE_INCOMPLETE')).toContainText('Overdue');
  await pending.getByRole('button', { name: 'Send Reminder: Business Information Form' }).click();
  await expect(pending.getByRole('status')).toHaveText('Reminder sent.');

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test("instructions 4: the Tax Returns tab shows each return's assigned staff", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/client-portal?client=${JAMIE}&tab=tax-returns`));
  const returns = page.getByTestId('portal-tax-returns');
  await expect(returns.getByRole('columnheader', { name: 'Assigned Staff' })).toBeVisible({
    timeout: 60_000,
  });
  const staff = returns.getByTestId('return-staff');
  await expect(staff.first()).toBeVisible();
  // The 2025 return has its preparer and reviewer; an older one has nobody yet.
  await expect(returns.getByRole('row').filter({ hasText: 'Priya Ramos' })).toContainText(
    'Reviewer: Morgan Avery',
  );
  await expect(staff.filter({ hasText: 'Unassigned' }).first()).toBeVisible();
});
