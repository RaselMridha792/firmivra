import { expect, test } from '@playwright/test';

// SH8 (Octavia's Oct 25 review: PY-F06; BK-D01, D02): a status in the chart, and Bookkeeping's
// Active Clients and Upcoming Reports cards, filter the client list on the same page: the choice
// shows, Clear brings the whole list back, the period stays and the counts match. Mock mode.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

test('Payroll Status: a status filters the list, keeps the period, and Clear resets it', async ({
  page,
}) => {
  await page.goto(`${app}/payroll?period=LAST_MONTH`);
  const legend = page.getByRole('list', { name: 'Filter the client list by payroll status' });
  const pastDue = legend.getByRole('button', { name: /Past Due/ });
  const count = Number((await pastDue.locator('span.font-semibold').textContent()) ?? '0');
  await pastDue.click();
  await expect(pastDue).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tab', { name: 'Past Due' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page).toHaveURL(/period=LAST_MONTH/);
  await expect(page).toHaveURL(/tab=PAST_DUE/);
  await expect(page.getByTestId('client-link')).toHaveCount(count);
  await page.getByTestId('cohort-chosen').getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('tab', { name: 'All Clients' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(pastDue).toHaveAttribute('aria-pressed', 'false');
});

test('Bookkeeping: the cohort cards and the status chart filter the list', async ({ page }) => {
  await page.goto(`${app}/bookkeeping`);
  await page.getByRole('button', { name: /^Clients with Upcoming Reports/ }).click();
  await expect(page.getByRole('tab', { name: 'Upcoming Reports' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const legend = page.getByRole('list', { name: 'Filter the client list by bookkeeping status' });
  await legend.getByRole('button', { name: /Overdue/ }).click();
  await expect(page.getByRole('tab', { name: 'Overdue' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('cohort-chosen')).toContainText('The list shows Overdue.');
  await page.getByRole('button', { name: /^Active Bookkeeping Clients/ }).click();
  await expect(page.getByRole('tab', { name: 'All Clients' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('cohort-chosen')).toHaveCount(0);
});
