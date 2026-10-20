import { expect, test } from '@playwright/test';

// R1: the Business Advisory client-detail tabs Financials, Recommendations and Meetings in mock mode
// (mocks/business-advisory.ts, as an Owner). Marcus Taylor has figures, recommendations and
// meetings; Grace Kim (archived) has none, for the empty states.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const client = (n: number, tab: string) =>
  `http://app.localhost:${port}/business-advisory/clients/0199c0f1-a200-7000-8000-${String(n).padStart(12, '0')}/${tab}`;
const MARCUS = 1;
const GRACE = 8;

test('Financials: trend, health score and every period with its source', async ({ page }) => {
  await page.goto(client(MARCUS, 'financials'));
  await expect(page.getByRole('tab', { name: 'Financials' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('trend-bars').getByRole('listitem').first()).toBeVisible();
  await expect(page.getByTestId('tab-health')).toBeVisible();
  const figures = page.getByRole('table', { name: 'Financial figures' });
  await expect(figures.getByRole('row').nth(1)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Figures' })).toBeEnabled();
});

test('Recommendations: the client list with Add Recommendation', async ({ page }) => {
  await page.goto(client(MARCUS, 'recommendations'));
  const recs = page.getByTestId('ba-recommendations');
  await expect(
    recs.getByRole('table', { name: 'Recommendations' }).getByRole('row').nth(1),
  ).toBeVisible();
  await expect(recs).toContainText('Implement Job Costing System');
  await expect(recs.getByRole('button', { name: 'Add Recommendation' })).toBeVisible();
});

test('Meetings: upcoming with Join and Reschedule, past in a table, Schedule Meeting', async ({
  page,
}) => {
  await page.goto(client(MARCUS, 'meetings'));
  const upcoming = page.getByTestId('tab-upcoming-meetings');
  await expect(upcoming.getByRole('listitem')).toHaveCount(1);
  await expect(upcoming).toContainText('Strategy Review');
  await expect(upcoming.getByRole('link', { name: /^Reschedule: / })).toHaveAttribute(
    'href',
    /\/calendar\/.+\/edit$/,
  );
  await expect(upcoming.getByRole('link', { name: 'Schedule Meeting' })).toHaveAttribute(
    'href',
    '/calendar/new',
  );
  const past = page.getByRole('table', { name: 'Past meetings' });
  await expect(past.getByRole('row')).toHaveCount(3);
  await expect(past).toContainText('Quarterly Review');
});

test('A client without data shows each tab empty', async ({ page }) => {
  await page.goto(client(GRACE, 'financials'));
  await expect(page.getByTestId('tab-trend')).toContainText('No figures yet.');
  await page.goto(client(GRACE, 'recommendations'));
  await expect(page.getByTestId('ba-recommendations')).toContainText('No recommendations');
  await page.goto(client(GRACE, 'meetings'));
  await expect(page.getByTestId('tab-upcoming-meetings')).toContainText('No upcoming meetings.');
  await expect(page.getByTestId('tab-past-meetings')).toContainText('No past meetings');
});
