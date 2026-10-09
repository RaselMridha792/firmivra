import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
/** The mock's first client, Jamie Sample. */
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test("a client's Signatures tab lists only their requests", async ({ page }) => {
  await page.goto(app(`/clients/${JAMIE}/signatures`));
  await expect(page.getByTestId('page-title')).toHaveText('Client signatures');
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
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
