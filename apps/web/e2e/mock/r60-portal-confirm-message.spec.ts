import { expect, test } from '@playwright/test';

// R60, Appointments Review 2 rows 8 / P8 (R61's live FAIL): after the client confirms, the
// reloaded list no longer asks, so the prompt goes away; "Your appointment is confirmed." must
// still show. The list reload is slowed (mock `myAppointments.list@slow`, 1.5 s), as on dev.
// Cancel removes its row the same way. On dev the message was lost when the reload unmounted
// the prompt before its `mutate` callback ran; that order depends on timing, so the mock does
// not always hit it: src/lib/query.test.ts shows the callback dropped and the fix's onSuccess
// kept. Mock mode, signed in as the portal's active client. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('Confirm Appointment shows "Your appointment is confirmed." when the list reloads slowly', async ({
  page,
}) => {
  await page.goto(portal('/lvp/appointments'));
  const prompts = page.getByTestId('my-appointment-confirm');
  await expect(prompts.first()).toBeVisible({ timeout: 60_000 });
  const before = await prompts.count();
  await page.evaluate(() => sessionStorage.setItem('fv-mock-fail', 'myAppointments.list@slow'));

  await prompts.first().getByRole('button', { name: 'Confirm Appointment' }).click();
  await expect(prompts).toHaveCount(before - 1, { timeout: 15_000 });
  await expect(page.getByText('Your appointment is confirmed.')).toBeVisible();
});

test('Cancel shows "Your appointment was cancelled." when its row leaves the reloaded list', async ({
  page,
}) => {
  await page.goto(portal('/lvp/appointments'));
  const rows = page.getByTestId('my-appointment');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const before = await rows.count();
  await page.evaluate(() => sessionStorage.setItem('fv-mock-fail', 'myAppointments.list@slow'));

  const row = rows.filter({ has: page.getByRole('button', { name: /^Actions for / }) }).first();
  await row.getByRole('button', { name: /^Actions for / }).click();
  await row.getByRole('menuitem', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel this appointment' }).click();
  await expect(rows).toHaveCount(before - 1, { timeout: 15_000 });
  await expect(page.getByText('Your appointment was cancelled.')).toBeVisible();
});
