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

test('A3 and A10: the window in days, notice in hours, both kept; the description is staff only', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/types'));
  const windowDays = page.getByLabel('Booking window');
  const notice = page.getByLabel('Minimum notice');
  await expect(windowDays).toBeVisible({ timeout: 60_000 });

  // Her 1, 3, 5 and 7 days and No limit stay in days; her 2, 6 and 12 hours are Minimum notice.
  expect(await windowDays.locator('option').allTextContents()).toEqual([
    '1 day ahead (24 hours)',
    '3 days ahead',
    '5 days ahead',
    '7 days ahead',
    '14 days ahead',
    '30 days ahead',
    '60 days ahead',
    '90 days ahead',
    '180 days ahead',
    '365 days ahead',
    'No limit',
  ]);
  expect(await notice.locator('option').allTextContents()).toEqual([
    'None',
    '2 hours',
    '6 hours',
    '12 hours',
    '24 hours',
    '48 hours',
    '72 hours',
  ]);
  await expect(page.getByLabel('Description (staff only)')).toBeVisible();
  await expect(page.getByTestId('type-description-note')).toHaveText(
    'For your team only: clients never see it, in the portal, booking or emails.',
  );

  await windowDays.selectOption('3');
  await notice.selectOption('6');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByTestId('type-settings-saved')).toHaveText('Settings saved.');

  // Another type and back: the settings are read again from the API, each value in its field.
  const types = page.locator('button[aria-pressed]');
  await types.nth(1).click();
  await expect(types.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await types.nth(0).click();
  await expect(types.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(windowDays).toHaveValue('3');
  await expect(notice).toHaveValue('6');
});

test('A6: the video link has its own full-width row, the toggle on its label line, and Copy', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
  await page
    .getByRole('radiogroup', { name: 'Location Type *' })
    .getByRole('radio', { name: 'Zoom / Video' })
    .click();

  const row = page.getByTestId('video-link');
  const link = row.getByRole('textbox', { name: 'Video Meeting Link' });
  const copy = row.getByRole('button', { name: 'Copy the video link' });
  await expect(link).toBeEnabled();
  await expect(copy).toBeDisabled();

  // The link and Copy span the row that Office / Branch and Room share above it.
  const office = await page.getByLabel('Office / Branch').boundingBox();
  const room = await page.getByLabel('Room (optional)').boundingBox();
  const field = await link.boundingBox();
  const button = await copy.boundingBox();
  expect(office && room && field && button).toBeTruthy();
  expect(Math.abs(field!.x - office!.x)).toBeLessThan(2);
  expect(Math.abs(button!.x + button!.width - (room!.x + room!.width))).toBeLessThan(2);

  // The toggle sits on the label's line, above the field.
  const label = await row.getByText('Video Meeting Link', { exact: true }).first().boundingBox();
  const toggle = await row.getByRole('switch', { name: 'Generate Zoom Link' }).boundingBox();
  expect(Math.abs(label!.y + label!.height / 2 - (toggle!.y + toggle!.height / 2))).toBeLessThan(6);
  expect(toggle!.y + toggle!.height).toBeLessThanOrEqual(field!.y);

  await link.fill('https://meet.example.test/abc-defg');
  await expect(copy).toBeEnabled();
});
