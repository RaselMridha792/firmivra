import { expect, test } from '@playwright/test';

// R55, Appointments A1: a group appointment. Schedule Appointment's Other Attendees adds the
// firm's other clients (never the appointment's own client); the record lists them for staff and
// Edit changes them. Mock mode (mocks/appointments-scheduling.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Other Attendees are booked with the client, listed on the record and changed in Edit', async ({
  page,
}) => {
  // The mock's bookings are at a fixed -04:00 offset: "tomorrow" stays in daylight time.
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00-04:00'));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Client / Lead *').fill('Nina');
  await page
    .getByTestId('contact-results')
    .getByRole('button', { name: /Nina Fairbanks/ })
    .click();

  const attendees = page.getByTestId('attendees');
  const search = attendees.getByRole('textbox', { name: 'Other Attendees' });
  const results = attendees.getByTestId('attendee-results');
  // The appointment's own client is never offered.
  await search.fill('Nina');
  await expect(results).toContainText('No other client matches.');
  for (const [typed, name] of [
    ['Avery', 'Avery Lawson'],
    ['Selma', 'Selma Shields'],
  ] as const) {
    await search.fill(typed);
    await results.getByRole('button', { name: new RegExp(name) }).click();
  }
  const chosen = attendees.getByRole('list', { name: 'Other attendees' });
  await expect(chosen).toContainText('Avery Lawson');
  await expect(chosen).toContainText('Selma Shields');
  await chosen.getByRole('button', { name: 'Remove Selma Shields' }).click();
  await expect(chosen).not.toContainText('Selma Shields');
  await page.screenshot({ path: test.info().outputPath('other-attendees.png') });

  await page.getByLabel('Appointment Type *').selectOption({ label: 'Follow-Up' });
  await page.getByLabel('Date *').fill('2026-10-15');
  await page.getByLabel('Start Time *').selectOption('08:00');
  await page.getByLabel('End Time *').selectOption('08:30');
  await page.getByRole('button', { name: 'Schedule Appointment' }).click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByText('Other attendees')).toBeVisible();
  await expect(page.getByText('Avery Lawson', { exact: true })).toBeVisible();

  // Edit shows them again; one more is added.
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page.getByTestId('attendees')).toContainText('Avery Lawson', { timeout: 60_000 });
  await page
    .getByTestId('attendees')
    .getByRole('textbox', { name: 'Other Attendees' })
    .fill('Selma');
  await page
    .getByTestId('attendee-results')
    .getByRole('button', { name: /Selma Shields/ })
    .click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByText('Avery Lawson, Selma Shields')).toBeVisible();
});
