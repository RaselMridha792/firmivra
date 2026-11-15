import { expect, test } from '@playwright/test';

// R56, Bookkeeping Review Two D01/D02: the Income, Expense and Net cards and the monthly chart
// total the same clients the list shows (its tab and filters), and say so; Clear brings the
// firm's totals back. Mock mode. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
/** The card's dollar figure alone. */
const amount = (text: string) => /-?\$[\d,]+/.exec(text)?.[0] ?? null;

test('P1-19: the money cards and the monthly chart follow the list’s filters', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1200 });
  await page.goto(`${app}/bookkeeping?period=THIS_YEAR`);
  const income = page.getByRole('listitem').filter({ hasText: 'Total Income (' });
  await expect(income).toContainText('Total Income (All Clients)', { timeout: 60_000 });
  await expect(income).toContainText('$');
  const all = amount(await income.innerText());
  expect(all).not.toBeNull();
  const firstClient = (await page.getByTestId('bk-link').first().innerText()).trim();

  // One client: its own figures, named as the clients shown.
  const search = page.getByPlaceholder('Search clients, business name, or EIN...');
  await search.fill(firstClient);
  await expect(page.getByTestId('bk-link')).toHaveCount(1);
  await expect(income).toContainText('Total Income (Clients Shown)');
  await expect.poll(async () => amount(await income.innerText())).not.toBe(all);
  expect(amount(await income.innerText())).not.toBeNull();

  // Nobody: no figures, and the cards and the chart say it is the filter.
  await search.fill('zz-no-such-client');
  await expect(page.getByTestId('bk-link')).toHaveCount(0);
  await expect(income).toContainText('No figures for these clients');
  await expect(page.getByRole('listitem').filter({ hasText: 'Net Profit (' })).toContainText(
    'No figures for these clients',
  );
  await expect(page.getByTestId('monthly-chart')).toContainText(
    'No monthly figures for the clients shown.',
  );

  await search.fill('');
  await expect(income).toContainText('Total Income (All Clients)');
  await expect.poll(async () => amount(await income.innerText())).toBe(all);
});
