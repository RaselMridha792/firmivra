import { expect, test } from '@playwright/test';

// Settings > Availability in mock mode, as an owner. Mock User works Mon-Fri 9-12 and 1-5.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

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
