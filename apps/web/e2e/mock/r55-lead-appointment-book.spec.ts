import { expect, test } from '@playwright/test';

// P4-1 (Leads Review Two 26): Schedule Appointment on a lead that is not a client yet books it as
// the lead's own appointment, and the lead's Appointments tab lists it. In mock mode
// (playwright.mock.config.ts) as the Owner; the first mock lead is open and has no appointments.
// The mocks book as the API does: a lead's own appointment refuses a text reminder (400), and the
// lead's tab reads what the scheduling mock booked. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const lead = `http://app.localhost:${port}/leads/0199c0c0-0a00-7000-8000-000000000001`;

/** A free morning well ahead, as the dialog's datetime-local field takes it. */
function ahead(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T08:00`;
}

test('Schedule Appointment books a lead that is not a client yet, and its tab lists it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${lead}/appointments`);
  const upcoming = page.getByTestId('card-upcoming-appointments');
  await expect(upcoming).toContainText('No appointments scheduled yet.');
  await upcoming.getByRole('button', { name: 'Schedule Appointment' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Schedule Appointment');
  const type = dialog.getByLabel('Appointment type');
  await type.selectOption({ index: 1 });
  const typeName = (await type.locator('option:checked').innerText()).replace(/ \(\d+ min\)$/, '');
  await dialog.getByLabel('Staff member').selectOption({ label: 'Morgan Avery' });
  await dialog.getByLabel(/^Start/).fill(ahead(40));
  await dialog.getByLabel('Meeting method').selectOption('PHONE');
  await dialog.getByRole('button', { name: 'Schedule Appointment' }).click();
  await expect(dialog).toBeHidden();

  // The lead's own appointment, on its Appointments tab: the type and the staff member.
  const row = upcoming.getByTestId('lead-appointment');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(typeName);
  await expect(row).toContainText('M. Avery');
  await expect(row).not.toContainText('Client:');
});
