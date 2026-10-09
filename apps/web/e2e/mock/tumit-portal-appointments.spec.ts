import { expect, test } from '@playwright/test';

// Portal appointments in mock mode, signed in as the client Jamie Sample. Next week Jamie has
// Monday 10 AM (with Sam Staff) and Tuesday 2 PM. The browser runs in the firm's time zone so
// the shown times match the mock's.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test.use({ timezoneId: 'America/New_York' });
// The mock puts its week after today and treats New York as a fixed UTC-4, while the screens
// use the real zone. Run on a summer Wednesday: EDT is UTC-4, and next week is past the cutoffs.
test.beforeEach(({ page }) => page.clock.setFixedTime(new Date('2026-07-08T12:00:00-04:00')));

/** A day of the mock's week ('YYYY-MM-DD'): 0 is next Monday, July 13. */
const nextWeek = (offset: number) =>
  new Date(Date.UTC(2026, 6, 13 + offset)).toISOString().slice(0, 10);

test('a client books after a taken time, then reschedules and cancels', async ({ page }) => {
  await page.goto(portal('/lvp/appointments'));
  await expect(page.getByTestId('page-title')).toHaveText('Appointments');
  const mine = page.getByTestId('my-appointment');
  await expect(mine).toHaveCount(2);

  // Book in the "Schedule an Appointment" modal: a kind, a day, a free time. The mock offers 10 AM though Jamie is busy then, and
  // answers SLOT_TAKEN as the API does when someone took a time meanwhile (the API itself leaves
  // the client's own busy times out).
  await page.getByRole('button', { name: 'Schedule an Appointment' }).first().click();
  await page.getByRole('button', { name: /Tax consultation/ }).click();
  await page.getByLabel('Day').fill(nextWeek(0));
  await page.getByRole('button', { name: '10:00 AM', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(
    page.getByText('Someone just booked that time. Please pick another one.'),
  ).toBeVisible();
  await page.getByRole('button', { name: '11:00 AM', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByText(/^Booked: Tax consultation/)).toBeVisible();
  await expect(mine).toHaveCount(3);

  // Reschedule Tuesday's appointment to 3 PM the same day, from its row menu.
  const tuesday = mine.filter({ hasText: 'Tue' });
  await tuesday.getByRole('button', { name: /^Actions for / }).click();
  await tuesday.getByRole('menuitem', { name: 'Reschedule' }).click();
  await expect(tuesday.getByRole('button', { name: '2:00 PM (current)' })).toBeDisabled();
  await tuesday.getByRole('button', { name: '3:00 PM' }).click();
  await tuesday.getByRole('button', { name: /^Move to/ }).click();
  await expect(page.getByText('Your appointment was moved.')).toBeVisible();
  await expect(mine.filter({ hasText: '3:00 PM' })).toHaveCount(1);

  // Cancel the new one.
  const booked = mine.filter({ hasText: '11:00 AM' });
  await booked.getByRole('button', { name: /^Actions for / }).click();
  await booked.getByRole('menuitem', { name: 'Cancel' }).click();
  await booked.getByLabel('Reason (optional)').fill('Plans changed.');
  await booked.getByRole('button', { name: 'Cancel this appointment' }).click();
  await expect(page.getByText('Your appointment was cancelled.')).toBeVisible();
  await expect(mine).toHaveCount(2);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});

test('shows the counts and opens booking from a calendar day and history from View All', async ({
  page,
}) => {
  await page.goto(portal('/lvp/appointments'));
  // Two upcoming (Mon, Tue), none pending or completed, one cancelled (Wed).
  await expect(page.getByTestId('appointment-stat')).toHaveText([
    /^2Upcoming Appointments/,
    /^0Appointment Request Pending/,
    /^0Completed This Year/,
    /^1Cancelled/,
  ]);
  // The cancelled row shows no join link; upcoming rows do.
  await expect(page.getByTestId('past-appointment').getByRole('link')).toHaveCount(0);
  await expect(
    page.getByTestId('my-appointment').getByRole('link', { name: 'Join link' }),
  ).toHaveCount(2);

  await page.getByRole('button', { name: 'July 13, 2026, appointment scheduled' }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule an Appointment' });
  await dialog.getByRole('button', { name: /Tax consultation/ }).click();
  await expect(dialog.getByLabel('Day')).toHaveValue(nextWeek(0));
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'View All' }).click();
  const history = page.getByRole('dialog', { name: 'Appointment History' });
  await expect(history.getByText('Cancelled')).toBeVisible();
});

test('Quick Actions cancel opens only the soonest appointment, once', async ({ page }) => {
  await page.goto(portal('/lvp/appointments'));
  const mine = page.getByTestId('my-appointment');
  await expect(mine).toHaveCount(2);
  await page.getByRole('button', { name: 'Cancel an Appointment' }).click();
  const monday = mine.filter({ hasText: '10:00 AM' });
  await monday.getByRole('button', { name: 'Cancel this appointment' }).click();
  await expect(page.getByText('Your appointment was cancelled.')).toBeVisible();
  await expect(mine).toHaveCount(1);
  // Nothing else opens on its own after the cancel.
  await expect(page.getByLabel('Reason (optional)')).toHaveCount(0);
});

test('the row menu keeps focus, and Quick Actions reschedule opens the soonest appointment', async ({
  page,
}) => {
  await page.goto(portal('/lvp/appointments'));
  const mine = page.getByTestId('my-appointment');
  const tuesday = mine.filter({ hasText: 'Tue' });
  const trigger = tuesday.getByRole('button', { name: /^Actions for / });
  await trigger.click();
  await expect(tuesday.getByRole('menuitem', { name: 'Reschedule' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(tuesday.getByRole('menuitem', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(tuesday.getByRole('menu')).toHaveCount(0);

  await page.getByRole('button', { name: 'Reschedule an Appointment' }).click();
  await expect(page.getByRole('button', { name: '10:00 AM (current)' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Pick a new time' })).toHaveCount(1);
});

test('an ended appointment staff have not closed shows as Past', async ({ page }) => {
  await page.goto(portal('/lvp/appointments'));
  await expect(page.getByTestId('my-appointment')).toHaveCount(2);
  // Monday's 10:00 AM appointment ends at 10:30; staff have not marked it completed.
  await page.clock.setFixedTime(new Date('2026-07-13T10:31:00-04:00'));
  await page.getByRole('link', { name: 'My Profile' }).click();
  await page.getByRole('link', { name: 'Appointments' }).click();
  // Whether the row is still in the cached upcoming list or already in the past one, it reads Past.
  const ended = page.getByTestId(/^(my|past)-appointment$/).filter({ hasText: '10:00 AM' });
  await expect(ended).toHaveCount(1);
  await expect(ended).toContainText('Past');
  await expect(ended.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'July 13, 2026, past appointment' })).toBeVisible();
});

test.describe('a client in another time zone', () => {
  test.use({ timezoneId: 'Asia/Dhaka' });

  test('sees which of their days a free time falls on', async ({ page }) => {
    await page.goto(portal('/lvp/appointments'));
    await page.getByRole('button', { name: 'Schedule an Appointment' }).first().click();
    await page.getByRole('button', { name: /Tax consultation/ }).click();
    await page.getByLabel('Day').fill(nextWeek(0));
    // The firm's Monday 1 PM and 3 PM (EDT) are Monday 11 PM and Tuesday 1 AM in Dhaka.
    await expect(page.getByRole('button', { name: '11:00 PM', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tue 1:00 AM', exact: true })).toBeVisible();
  });
});
