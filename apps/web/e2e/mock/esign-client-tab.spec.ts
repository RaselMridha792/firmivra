import { expect, test } from '@playwright/test';
import { record, routeClientRecord } from './r23-fixtures';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
/** The mock's first client, Jamie Sample. */
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test("a client's Signatures tab lists only their requests", async ({ page }) => {
  // The client record's layout reads the client (no clients mock yet: R23's fixture answers it).
  await routeClientRecord(page, record(1, { id: JAMIE, displayName: 'Jamie Sample' }));
  await page.goto(app(`/clients/${JAMIE}/signatures`));
  await expect(page.getByTestId('page-title')).toHaveText('Jamie Sample');
  await expect(page).toHaveTitle('Client signatures');
  await expect(page.getByRole('heading', { level: 2, name: 'Signatures' })).toBeVisible();
  const table = page.getByRole('table', { name: "This client's signature requests" });
  await expect(table).toContainText('Engagement Letter (in person)');
  // Other clients' requests stay off it (John Smith's letter is in the mock's first rows).
  await expect(table).not.toContainText('Tax Engagement Letter 2026');
  // There is no client filter on a client's own tab.
  await expect(page.getByRole('combobox', { name: 'Client', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Send for signature' })).toHaveAttribute(
    'href',
    `/firm-sign/new?clientId=${JAMIE}`,
  );
});

test('a client id that is not one is not found', async ({ page }) => {
  await page.goto(app('/clients/not-a-client/signatures'));
  // The client record's layout answers it, and the tab's list never shows.
  await expect(page.getByTestId('page-not-found')).toBeVisible();
  await expect(page.getByRole('table', { name: "This client's signature requests" })).toHaveCount(
    0,
  );
});
