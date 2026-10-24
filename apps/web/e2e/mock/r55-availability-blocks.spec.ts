import { expect, test } from '@playwright/test';

// R55, Octavia's Availability guide (Settings review, Oct 20), items 5, 8 and 10: a block over a
// booked appointment lists it and offers "Block available slots only", which keeps it as it is.
// In mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/settings/availability`;
const shots = 'e2e/mock/r55-screenshots/availability';

/** Next Monday in New York, as the mock's first appointment (10:00 to 10:30, the Staff member). */
function nextMonday(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(),
  );
  const d = new Date(`${today}T00:00:00Z`);
  const ahead = (8 - d.getUTCDay()) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + ahead);
  return d.toISOString().slice(0, 10);
}

test('a whole-firm block over a booking lists it, then blocks only the free time', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(url);
  await page.getByLabel('Starts on').fill(nextMonday());
  await page.getByLabel('Starts at').fill('09:00');
  await page.getByLabel('Ends on').fill(nextMonday());
  await page.getByLabel('Ends at').fill('12:00');
  await page.getByLabel('Reason (optional)').fill('Fake office training');
  await page.getByRole('button', { name: 'Block this time' }).click();

  const clashes = page.getByRole('region', { name: 'Booked appointments in this time' });
  await expect(clashes).toContainText(
    'An appointment is booked in this time. Nothing is cancelled.',
  );
  await expect(clashes.getByRole('link')).toHaveCount(1);
  await expect(clashes.getByRole('link')).toHaveAttribute('href', /^\/calendar\//);
  await page.screenshot({ path: `${shots}/block-clash.png`, fullPage: true });

  await clashes.getByRole('button', { name: 'Block available slots only' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Blocked the free time' })).toHaveText(
    'Blocked the free time around 1 appointment, which stay as they are.',
  );
  await expect(clashes).toHaveCount(0);
  // The firm's blocks around the booking, and the Owner's own block inside its window.
  const rows = page.getByTestId('blocked-time').filter({ hasText: 'Fake office training' });
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Whole firm' })).toHaveCount(2);
  await expect(rows.first()).toContainText('Added by');
  await page.screenshot({ path: `${shots}/block-free-slots.png`, fullPage: true });
});

test('the list filters by person and dates', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(url);
  await expect(page.getByLabel('Show', { exact: true })).toHaveValue('');
  await page.getByLabel('From', { exact: true }).fill('2026-01-10');
  await page.getByLabel('To', { exact: true }).fill('2026-06-10');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Show at most three months at a time.' }),
  ).toHaveCount(1);
  await page.getByLabel('To', { exact: true }).fill('2026-01-01');
  await expect(
    page.getByRole('alert').filter({ hasText: 'The end date must be on or after the start date.' }),
  ).toHaveCount(1);
});
