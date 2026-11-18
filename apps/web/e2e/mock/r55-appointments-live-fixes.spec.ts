import { expect, type Page, test } from '@playwright/test';

// R55, Appointments live check (Nov 17) B5 and W10, on Schedule Appointment. B5: the End Time
// follows a changed Start Time and keeps the length, so the summary and Duration agree and a
// recurring booking saves. W10: booking a client at a time it already has says so in plain words
// and offers no Book Anyway (that conflict can't be overridden). Mock mode
// (mocks/appointments-scheduling.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function newFor(page: Page, client: string) {
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Client / Lead *').fill(client.split(' ')[0]!);
  await page
    .getByTestId('contact-results')
    .getByRole('button', { name: new RegExp(client) })
    .click();
  await page.getByLabel('Appointment Type *').selectOption({ label: 'Follow-Up' });
}

test.beforeEach(async ({ page }) => {
  // The mock's bookings are at a fixed -04:00 offset: "tomorrow" stays in daylight time.
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00-04:00'));
  await page.setViewportSize({ width: 1440, height: 1100 });
});

test('B5: a new Start Time moves the End Time with it and keeps the length; recurring still saves', async ({
  page,
}) => {
  await newFor(page, 'Nina Fairbanks');
  await page.getByLabel('Date *').fill('2026-10-15');
  const start = page.getByLabel('Start Time *');
  const end = page.getByLabel('End Time *');
  await start.selectOption('15:00');
  await expect(end).toHaveValue('15:30');
  await start.selectOption('16:00');
  await expect(end).toHaveValue('16:30');
  await expect(page.getByLabel('Duration')).toHaveValue('30 min');
  await expect(page.getByText('4:00 PM – 4:30 PM')).toBeVisible();
  await expect(page.getByText('4:00 PM – 3:30 PM')).toHaveCount(0);
  // A recurring booking after the change saves (no "End time must be after the start").
  await page.getByLabel('Repeat').selectOption('WEEKLY');
  await page.getByRole('button', { name: 'Schedule Appointment' }).click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/, { timeout: 30_000 });
});

test('W10: a client already booked then is told so, with no Book Anyway', async ({ page }) => {
  // The mock's Kendra Gill already has Thursday Oct 15, 11:00 AM to noon (a page load resets the
  // mock, so the existing booking is the seeded one).
  await newFor(page, 'Kendra Gill');
  await page.getByLabel('Date *').fill('2026-10-15');
  await page.getByLabel('Start Time *').selectOption('11:00');
  await page.getByRole('button', { name: 'Schedule Appointment' }).click();
  const error = page.getByTestId('schedule-error');
  await expect(error).toContainText('This client already has an appointment at this time', {
    timeout: 30_000,
  });
  await expect(error).not.toContainText('book anyway');
  await expect(page.getByRole('button', { name: 'Book Anyway' })).toHaveCount(0);
  await expect(page.getByLabel('Reason to book anyway (Owner or Admin)')).toHaveCount(0);
});
