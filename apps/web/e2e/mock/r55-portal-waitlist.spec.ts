import { expect, test } from '@playwright/test';

// R55, Appointments A3: the waitlist for an earlier time in the portal, in mock mode
// (mocks/appointment-waitlist.ts over mocks/appointments.ts) as Jamie Sample. The waitlist is on
// in AUTO_CONFIRM, and Jamie's soonest appointment (next Monday 10 AM) is offered its first earlier
// free start. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test.use({ timezoneId: 'America/New_York' });
// As tumit-portal-appointments: a summer Wednesday, so the mock's next week is past the cutoffs.
test.beforeEach(({ page }) => page.clock.setFixedTime(new Date('2026-07-08T12:00:00-04:00')));

test('an earlier time is offered and taken; another appointment joins the waitlist and leaves it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/appointments'));
  await expect(page.getByTestId('page-title')).toHaveText('Appointments');
  const offer = page.getByTestId('waitlist-offer');
  await expect(offer).toContainText('An earlier time is available', { timeout: 60_000 });
  await expect(offer).toContainText('It is held for you until');
  await expect(offer).toContainText('Taking it moves your appointment at once.');
  await page.screenshot({ path: test.info().outputPath('waitlist-offer.png') });

  await offer.getByRole('button', { name: 'Take This Time' }).click();
  await expect(page.getByText('Your appointment was moved to the earlier time.')).toBeVisible();
  await expect(offer).toHaveCount(0);

  // The last upcoming appointment waits for an earlier time, then leaves the waitlist.
  const row = page.getByTestId('my-appointment').last();
  await row.getByRole('button', { name: 'Join Waitlist for an Earlier Time' }).click();
  await expect(page.getByText('You are on the waitlist. We will let you know')).toBeVisible();
  await expect(row.getByTestId('waitlist-waiting')).toContainText(
    'You are on the waitlist for an earlier time.',
  );
  await row.getByRole('button', { name: 'Leave Waitlist' }).click();
  await expect(page.getByText('You left the waitlist.')).toBeVisible();
  await expect(
    row.getByRole('button', { name: 'Join Waitlist for an Earlier Time' }),
  ).toBeVisible();
});
