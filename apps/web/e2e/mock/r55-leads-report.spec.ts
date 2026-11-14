import { expect, test } from '@playwright/test';

// R55, Leads Review Two (Octavia, Nov 8) R2 18: Reports > Leads, the funnel and aging report,
// linked from the Leads summary cards and the Reports overview's Leads card. Every number opens the
// leads behind it; the filters stay in the address. In mock mode (playwright.mock.config.ts) as
// the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('opens from Leads, counts the funnel and aging, and drills down to the leads', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  await page.getByTestId('leads-report-link').click();
  const report = page.getByTestId('leads-report');
  await expect(report.getByRole('heading', { name: 'Leads Funnel & Aging' })).toBeVisible();
  await expect(report.getByTestId('report-range')).toContainText('Leads that came in from');

  const funnel = report.getByTestId('report-funnel');
  const reachedNew = funnel
    .getByRole('list', { name: 'Reached each stage' })
    .getByRole('button', { name: /leads: New, 100% reached/ });
  await expect(reachedNew).toBeVisible();
  const total = Number(await reachedNew.textContent());
  expect(total).toBeGreaterThan(0);

  await reachedNew.click();
  const drawer = page.getByRole('dialog', { name: 'Reached New' });
  await expect(drawer.getByTestId('report-leads').getByRole('row')).toHaveCount(
    Math.min(total, 10) + 1,
  );
  await drawer.getByRole('button', { name: 'Close panel' }).click();
  await expect(drawer).toHaveCount(0);

  await expect(report.getByTestId('report-aging')).toContainText('Time in current stage');
  await expect(report.getByTestId('report-definitions')).toContainText('Conversion rate');

  // A filter narrows the count and stays in the address.
  await report.getByLabel('Source').selectOption({ label: 'Referral' });
  await expect(page).toHaveURL(/source=REFERRAL/);
  await expect(funnel).toBeVisible();

  // A reversed range says so instead of showing an empty report.
  await report.getByLabel('From', { exact: true }).fill('2026-06-10');
  await report.getByLabel('To', { exact: true }).fill('2026-06-01');
  await expect(report).toContainText('End date must be on or after the start date');
  await expect(report.getByTestId('report-funnel')).toHaveCount(0);
});

test('the Reports overview links its Leads card to the funnel and aging report', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/reports`);
  await page.getByTestId('leads-funnel-link').click();
  await expect(page.getByRole('heading', { name: 'Leads Funnel & Aging' })).toBeVisible();
});
