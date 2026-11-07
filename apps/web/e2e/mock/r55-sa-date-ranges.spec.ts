import { expect, test } from '@playwright/test';

// R55, Octavia's Super Admin review of Oct 31: the shared date range (SA-SUP-R1, SA-PIP-PL01,
// SA-INT-R4): named fields, a reversed range refused inline with the dates kept, and a valid range
// kept after Apply as a chip, in the Filters count and in the address. Mock mode; 1440 px.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

test('Support: a Created Date range stays after Apply, as a chip, in the count and the address (SA-SUP-R1)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin('/support'));
  await page.getByRole('button', { name: /^Filters/ }).click();
  const from = page.getByRole('textbox', { name: 'Created Date: From, start date' });
  const to = page.getByRole('textbox', { name: 'Created Date: To, end date' });
  await from.fill('2026-10-31');
  await to.fill('2026-10-01');
  // Reversed: said inline, and the entered dates stay.
  await expect(
    page.getByRole('alert').filter({ hasText: 'End date is before start date' }),
  ).toBeVisible();
  await expect(to).toHaveValue('2026-10-01');
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/super-admin/date-range-reversed.png' });
  await from.fill('2026-10-01');
  await to.fill('2026-10-31');
  await expect(page.getByText('End date is before start date')).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply Filters' }).click();
  const chips = page.getByTestId('active-filters');
  await expect(chips).toContainText('Created');
  await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('1');
  await expect(page).toHaveURL(/createdFrom=2026-10-01/);
  await expect(page).toHaveURL(/createdTo=2026-10-31/);
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/super-admin/support-date-chip.png' });
  // A reload keeps it.
  await page.reload();
  await expect(page.getByTestId('active-filters')).toContainText('Created');
});
