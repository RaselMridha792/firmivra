import { expect, type Page, test } from '@playwright/test';

// R60, Appointments Review 2 row 9 / P9 and D2: Send Intake Form Before Appointment is a real
// choice on a new appointment. Its form follows the Related Service (that service's default
// form), the member can pick another or none, and the record shows the form sent. The four links
// that were never built (Task, Bookkeeping Client, Invoice, Documents) are not shown. Mock mode
// (mocks/appointments-scheduling.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function newAppointment(page: Page) {
  // The mock's bookings are at a fixed -04:00 offset: "tomorrow" stays in daylight time.
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00-04:00'));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
}

async function chooseClientAndTime(page: Page) {
  await page.getByLabel('Client / Lead *').fill('Nina');
  await page
    .getByTestId('contact-results')
    .getByRole('button', { name: /Nina Fairbanks/ })
    .click();
  await page.getByLabel('Appointment Type *').selectOption({ label: 'Follow-Up' });
  await page.getByLabel('Date *').fill('2026-10-15');
  await page.getByLabel('Start Time *').selectOption('08:00');
  await page.getByLabel('End Time *').selectOption('08:30');
}

test('the Related Service picks its default intake form, which is sent and shown on the record', async ({
  page,
}) => {
  await newAppointment(page);
  const intake = page.getByTestId('send-intake');
  const box = intake.getByRole('checkbox', { name: 'Send Intake Form Before Appointment' });
  // No client yet: nothing to send to.
  await expect(box).toBeDisabled();
  await expect(intake).toContainText('Choose a client first: the form goes to their portal.');
  // The links that were never built are gone.
  for (const label of [
    'Link to Task',
    'Link to Bookkeeping Client',
    'Link to Invoice',
    'Require Documents Before Appointment',
  ]) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }

  await chooseClientAndTime(page);
  // Follow-Up asks for no form and no service is chosen: off.
  await expect(box).toBeEnabled();
  await expect(box).not.toBeChecked();
  await page.getByLabel('Related Service').selectOption({ label: 'Bookkeeping' });
  await expect(box).toBeChecked();
  await expect(intake.getByLabel('Intake form', { exact: true })).toHaveValue(/.+/);
  await expect(
    intake.getByLabel('Intake form', { exact: true }).locator('option:checked'),
  ).toHaveText('Bookkeeping Onboarding (Bookkeeping)');
  await expect(intake).toContainText(
    "Sent to the client's portal when you schedule. The Related Service's default form comes first, then the appointment type's.",
  );
  // Another service, another default form.
  await page.getByLabel('Related Service').selectOption({ label: 'Payroll Setup' });
  await expect(
    intake.getByLabel('Intake form', { exact: true }).locator('option:checked'),
  ).toHaveText('Payroll Setup Questionnaire (Payroll Setup)');
  await page.getByLabel('Related Service').selectOption({ label: 'Bookkeeping' });
  await page.screenshot({ path: test.info().outputPath('send-intake.png') });

  await page.getByRole('button', { name: 'Schedule Appointment' }).click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const related = page.getByTestId('detail-related');
  await expect(related).toContainText('Bookkeeping Onboarding (waiting)');
  for (const gone of ['Bookkeeping', 'Invoice', 'Task', 'Documents']) {
    await expect(related.getByText(gone, { exact: true })).toHaveCount(0);
  }

  // Edit shows the form sent; it sends no other.
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page.getByTestId('intake-sent')).toHaveText(
    'Intake form: Bookkeeping Onboarding (Sent)',
    { timeout: 60_000 },
  );
  await expect(page.getByTestId('send-intake')).toHaveCount(0);
});

test('unchecked, no form is sent, even with a Related Service', async ({ page }) => {
  await newAppointment(page);
  await chooseClientAndTime(page);
  await page.getByLabel('Related Service').selectOption({ label: 'Bookkeeping' });
  const box = page
    .getByTestId('send-intake')
    .getByRole('checkbox', { name: 'Send Intake Form Before Appointment' });
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(
    page.getByTestId('send-intake').getByLabel('Intake form', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Schedule Appointment' }).click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId('detail-related')).toContainText('Intake form');
  await expect(page.getByTestId('detail-related')).not.toContainText('(waiting)');
});
