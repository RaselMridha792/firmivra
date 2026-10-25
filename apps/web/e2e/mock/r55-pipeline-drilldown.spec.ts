import { expect, test } from '@playwright/test';

// R55, Octavia's dashboard review of Oct 25, C5: each Client Pipeline stage opens its list filtered
// to what it counts, with the widget's days, and Back to Dashboard. In mock mode as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const home = `http://app.localhost:${port}/`;

test('each pipeline stage opens its filtered list; Consultation holds none and opens nothing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(home);
  const pipeline = page.getByRole('region', { name: 'Client Pipeline' });
  await expect(pipeline.getByTestId('pipeline-stage').nth(1).getByRole('link')).toHaveCount(0);
  await expect(pipeline).toContainText(
    'Leads and Accepted follow this period; Intake and In Progress are open now.',
  );
  const leads = pipeline.getByRole('link', { name: /^Leads: / });
  await expect(leads).toHaveAttribute(
    'href',
    /^\/leads\?stage=SUBMITTED&from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}&back=dashboard$/,
  );
  await expect(pipeline.getByRole('link', { name: /^In Progress: / })).toHaveAttribute(
    'href',
    '/tax-returns?status=IN_PROGRESS&back=dashboard',
  );
  await expect(pipeline.getByRole('link', { name: /^Accepted: / })).toHaveAttribute(
    'href',
    /^\/tax-returns\?status=ACCEPTED&acceptedFrom=\d{4}-\d{2}-01&acceptedTo=/,
  );

  await pipeline.getByRole('link', { name: /^Intake: / }).click();
  await expect(page).toHaveURL(/\/intake-forms\?tab=open&back=dashboard$/);
  await expect(page.getByTestId('not-finished-filter')).toContainText('Not finished');
  await expect(page.getByTestId('back-to-dashboard')).toBeVisible();
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/dashboard/intake-not-finished.png' });
  await page.getByTestId('not-finished-filter').getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByTestId('not-finished-filter')).toHaveCount(0);
});
