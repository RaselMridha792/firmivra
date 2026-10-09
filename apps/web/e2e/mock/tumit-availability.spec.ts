import { expect, test } from '@playwright/test';

// Settings > Availability in mock mode, as an owner. Mock User works Mon-Fri 9-12 and 1-5; Sam
// Staff has "Training" blocked next Thursday; Mock User sees Riley Example next Monday at 2 PM.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

// The mock puts its week after today and treats New York as a fixed UTC-4, while the screens
// use the real zone. Run on a summer Wednesday: EDT is UTC-4, and next week is past the cutoffs.
test.beforeEach(({ page }) => page.clock.setFixedTime(new Date('2026-07-08T12:00:00-04:00')));

/** A day of the mock's week ('YYYY-MM-DD'): 0 is next Monday, July 13. */
const nextWeek = (offset: number) =>
  new Date(Date.UTC(2026, 6, 13 + offset)).toISOString().slice(0, 10);

test('working hours are checked, then saved', async ({ page }) => {
  await page.goto(app('/settings/availability'));
  await expect(page.getByTestId('page-title')).toHaveText('Availability');
  const mockUser = page.getByTestId('member-hours').filter({ hasText: 'Mock User' });
  await expect(mockUser.getByLabel('Monday from')).toHaveCount(2);

  await mockUser.getByRole('button', { name: 'Add hours on Monday' }).click();
  await mockUser.getByLabel('Monday from').last().fill('11:00');
  await mockUser.getByLabel('Monday to').last().fill('14:00');
  await mockUser.getByRole('button', { name: 'Save working hours' }).click();
  await expect(mockUser.getByRole('alert')).toHaveText('Ranges on the same day cannot overlap');

  await mockUser.getByRole('button', { name: 'Remove' }).nth(2).click();
  await mockUser.getByRole('button', { name: 'Add hours on Saturday' }).click();
  await mockUser.getByLabel('Saturday to').fill('12:00');
  await mockUser.getByRole('button', { name: 'Save working hours' }).click();
  await expect(mockUser.getByText('Working hours saved.')).toBeVisible();
  await mockUser.getByLabel('Saturday to').fill('13:00');
  await expect(mockUser.getByText('Working hours saved.')).toHaveCount(0);

  // One person at a time: yours first, then anyone else's.
  await page.getByLabel('Whose hours').selectOption({ label: 'Sam Staff' });
  await expect(page.getByTestId('member-hours')).toHaveCount(1);
  await expect(page.getByTestId('member-hours')).toContainText('Sam Staff');
});

test('time is blocked, refused over an appointment, and removed', async ({ page }) => {
  await page.goto(app('/settings/availability'));
  const blocks = page.getByTestId('blocked-time');
  await expect(blocks.filter({ hasText: 'Sam Staff · Training' })).toHaveCount(1);

  await page.getByLabel('Who', { exact: true }).selectOption({ label: 'Mock User' });
  await page.getByLabel('Starts on').fill(nextWeek(0));
  await page.getByLabel('Starts at').fill('13:00');
  await page.getByLabel('Ends on').fill(nextWeek(0));
  await page.getByLabel('Ends at').fill('15:00');
  await page.getByRole('button', { name: 'Block this time' }).click();
  await expect(
    page.getByText('An appointment is booked in that time. Move or cancel it first.'),
  ).toBeVisible();

  await page.getByLabel('Reason (optional)').fill('Dentist');
  await page.getByLabel('Starts on').fill(nextWeek(5));
  await page.getByLabel('Ends on').fill(nextWeek(5));
  await page.getByRole('button', { name: 'Block this time' }).click();
  const dentist = blocks.filter({ hasText: 'Mock User · Dentist' });
  await expect(dentist).toHaveCount(1);
  await dentist.getByRole('button', { name: 'Remove' }).click();
  await expect(dentist).toHaveCount(0);
});
