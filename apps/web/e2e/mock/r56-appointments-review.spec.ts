import { expect, test } from '@playwright/test';

// R56: Octavia's Appointments review of Oct 20 (docs/specs/review-2026-10-21/CHANGE-LIST.md,
// section B), P1 items in mock mode. A2: Edit My Availability saves the weekly hours and time
// off together, marks a wrong field, and shows the firm's buffers, notice and window instead of
// sending values the API refuses per person. A1: a refused meeting-method choice is named on
// its field, and every entry stays. The scheduling mock refuses what the API refuses.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('A2: weekly hours and time off save together, and reload into the form', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/availability'));
  const rules = page.getByTestId('availability-rules');
  const week = rules.getByTestId('week-hours');
  await expect(week).toBeVisible({ timeout: 60_000 });
  await expect(rules.getByTestId('booking-rules')).toContainText('Booking window');
  await expect(rules.getByLabel('Minimum notice')).toHaveCount(0);

  await week.getByRole('button', { name: 'Add hours on Saturday' }).click();
  await week.getByLabel('Saturday to').fill('13:00');
  await rules.getByRole('button', { name: 'Add Time Off' }).click();
  await rules.getByLabel('From').last().fill('2026-12-21');
  await rules.getByLabel('To').last().fill('2026-12-24');
  await rules.getByRole('button', { name: 'Save Availability' }).click();
  await expect(page.getByTestId('rules-saved')).toHaveText('Availability saved.');

  // The form is drawn again from what the API returned.
  await expect(week.getByLabel('Saturday from')).toHaveValue('09:00');
  await expect(week.getByLabel('Saturday to')).toHaveValue('13:00');
  await expect(rules.getByLabel('To').last()).toHaveValue('2026-12-24');
});

test('A2: a wrong range is marked on its field and focused, and nothing is sent', async ({
  page,
}) => {
  await page.goto(app('/calendar/availability'));
  const rules = page.getByTestId('availability-rules');
  const week = rules.getByTestId('week-hours');
  await expect(week).toBeVisible({ timeout: 60_000 });
  await week.getByRole('button', { name: 'Add hours on Sunday' }).click();
  await week.getByLabel('Sunday to').fill('08:00');
  await rules.getByRole('button', { name: 'Save Availability' }).click();

  await expect(week.getByLabel('Sunday to')).toHaveAttribute('aria-invalid', 'true');
  await expect(week.getByText('The end must be after the start.')).toBeVisible();
  await expect(week.getByLabel('Sunday to')).toBeFocused();
  await expect(rules.getByTestId('rules-problems')).toHaveText(
    'Fix the highlighted field before saving.',
  );
  await expect(page.getByTestId('rules-saved')).toHaveCount(0);

  await week.getByLabel('Sunday to').fill('12:00');
  await rules.getByRole('button', { name: 'Save Availability' }).click();
  await expect(page.getByTestId('rules-saved')).toHaveText('Availability saved.');
});

test('A1: a meeting-method choice the API refuses is named on the field, entries kept', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/types'));
  // The first active type's settings open with the page.
  const methods = page.getByTestId('meeting-methods');
  await expect(methods).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Description').fill('Internal note for staff.');
  await methods.getByLabel('Phone').check();
  await page.getByRole('button', { name: 'Save Settings' }).click();

  await expect(methods).toContainText('For now a type keeps one meeting method');
  await expect(page.getByTestId('type-settings-error')).toContainText('Fix Meeting methods');
  await expect(page.getByLabel('Description')).toHaveValue('Internal note for staff.');
  await expect(methods.getByLabel('Phone')).toBeChecked();

  await methods.getByLabel('In-Person').uncheck();
  await expect(methods).not.toContainText('For now a type keeps one meeting method');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByTestId('type-settings-saved')).toHaveText('Settings saved.');
});
