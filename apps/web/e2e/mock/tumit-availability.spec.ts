import { expect, test } from '@playwright/test';

// Settings > Availability in mock mode, as an owner. Mock User works Mon-Fri 9-12 and 1-5; Sam
// Staff has "Training" blocked next Thursday; Mock User sees Riley Example next Monday at 2 PM.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

/** A day of next week (0 Monday) in the firm's time zone, where the mock puts its week. */
function nextWeek(offset: number) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(),
  );
  const day = new Date(`${today}T00:00:00Z`);
  const ahead = ((8 - day.getUTCDay()) % 7 || 7) + offset;
  return new Date(day.getTime() + ahead * 86_400_000).toISOString().slice(0, 10);
}

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
});

test('time is blocked, refused over an appointment, and removed', async ({ page }) => {
  await page.goto(app('/settings/availability'));
  const blocks = page.getByTestId('blocked-time');
  await expect(blocks.filter({ hasText: 'Sam Staff · Training' })).toHaveCount(1);

  await page.getByLabel('Who').selectOption({ label: 'Mock User' });
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
