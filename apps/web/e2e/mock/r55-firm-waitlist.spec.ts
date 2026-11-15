import { expect, test } from '@playwright/test';

// R55, Appointments A3: staff decide waitlist requests (the firm's STAFF_APPROVAL mode). The
// Appointments screen shows a Waitlist Requests card only while one waits; the appointment's own
// page has the same Approve and Reject. Mock mode (mocks/appointment-waitlist.ts over the
// scheduling mock) as the Owner: one client asked for an earlier time for their next appointment.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.beforeEach(async ({ page }) => {
  // The mock's bookings are at a fixed -04:00 offset: a day in daylight time.
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00-04:00'));
  await page.setViewportSize({ width: 1440, height: 1100 });
});

test('a request opens its appointment, where Approve moves it to the earlier time', async ({
  page,
}) => {
  await page.goto(app('/calendar'));
  const card = page.getByTestId('waitlist-requests');
  await expect(card).toContainText('Waitlist Requests (1)', { timeout: 60_000 });
  const request = card.getByTestId('waitlist-request');
  await expect(request).toContainText('→');
  await expect(request).toContainText('The current time stands until you approve.');
  await page.screenshot({ path: test.info().outputPath('waitlist-requests.png') });

  // The client's name opens the appointment; its page has the same decision.
  await request.getByRole('link').click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/);
  const decision = page.getByTestId('waitlist-requests');
  await expect(decision).toContainText('Waitlist Request');
  const requested = (await decision.locator('span.font-semibold.text-heading').last().innerText())
    .split(', ')
    .slice(0, 2);
  await decision.getByRole('button', { name: 'Approve' }).click();
  await expect(decision).toContainText('moved to the earlier time');
  await expect(decision.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  // The record shows the new day and time.
  const summary = page.getByTestId('detail-summary');
  for (const part of requested) await expect(summary).toContainText(part);
});

test('Reject keeps the time, and the card goes once nothing waits', async ({ page }) => {
  await page.goto(app('/calendar'));
  const card = page.getByTestId('waitlist-requests');
  await expect(card).toContainText('Waitlist Requests (1)', { timeout: 60_000 });
  await card.getByRole('button', { name: 'Reject' }).click();
  await expect(card).toContainText('keeps the current time');
  await expect(card.getByTestId('waitlist-request')).toHaveCount(0);
});
