import { expect, test } from '@playwright/test';

// Staff Availability (/calendar/availability), in mock mode (playwright.mock.config.ts), signed
// in as the Owner. The scheduling mock blocks 2 PM for every staff member. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test("shows a staff member's day and saves availability", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`http://app.localhost:${port}/calendar/availability`);
  await expect(page).toHaveTitle('Staff availability');
  await expect(page.getByTestId('staff-day')).toContainText('Blocked (Admin)', { timeout: 60_000 });

  const rules = page.getByTestId('availability-rules');
  // The firm's booking rules are shown, not edited (the API keeps none per person).
  await expect(rules.getByTestId('booking-rules')).toContainText('24 hours');
  await rules.getByRole('button', { name: 'Add Time Off' }).click();
  await rules.getByRole('button', { name: 'Save Availability' }).click();
  await expect(rules.getByText('Enter a start.')).toBeVisible();

  await rules.getByRole('button', { name: 'Remove this time off' }).last().click();
  await rules.getByRole('button', { name: 'Save Availability' }).click();
  await expect(page.getByTestId('rules-saved')).toHaveText('Availability saved.');
  await expect(
    page.getByRole('link', { name: 'Blocked time, in Settings > Availability' }),
  ).toHaveAttribute('href', '/settings/availability');
});
