import { expect, test } from '@playwright/test';
import { json, record, routeClientRecord } from './r23-fixtures';

// The client record (R23): header, tabs and Overview in mock mode, as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const maria = record(1);

test('the overview shows the record with the SSN masked', async ({ page }) => {
  await routeClientRecord(page);
  await page.goto(app(`/clients/${maria.id}`));
  await expect(page.getByTestId('page-title')).toHaveText('Maria Lopez');
  const overview = page.getByTestId('client-overview');
  await expect(overview).toContainText('Maria Elena Lopez');
  await expect(overview).toContainText('•••-••-4821');
  await expect(overview).toContainText('April 12, 1986');
  await expect(overview).toContainText('245 Peachtree Ave');
  await expect(overview).toContainText('Primary login');
  await expect(page.getByRole('link', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('link', { name: 'Signatures' })).toHaveAttribute(
    'href',
    `/clients/${maria.id}/signatures`,
  );
});

test('a business shows the EIN masked', async ({ page }) => {
  const bakery = record(2, {
    displayName: 'Brightline Bakery LLC',
    accountType: 'BUSINESS',
    portalLogins: [],
    profile: {
      ...maria.profile,
      businessName: 'Brightline Bakery LLC',
      entityType: 'LLC',
      einLast4: '7310',
      ssnLast4: null,
    },
  });
  await routeClientRecord(page, bakery);
  await page.goto(app(`/clients/${bakery.id}`));
  const overview = page.getByTestId('client-overview');
  await expect(overview).toContainText('••-•••7310');
  await expect(overview).toContainText('No portal login yet');
  await expect(overview).not.toContainText('4821');
});

test('the owner archives and restores a client', async ({ page }) => {
  await routeClientRecord(page);
  await page.goto(app(`/clients/${maria.id}`));
  await page.getByRole('button', { name: 'Archive client' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Restore client' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore client' }).click();
  await expect(page.getByRole('button', { name: 'Archive client' })).toBeVisible();
});

test('the owner edits contact details and replaces the SSN', async ({ page }) => {
  await routeClientRecord(page);
  await page.goto(app(`/clients/${maria.id}`));
  await page.getByRole('button', { name: 'Edit details' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Phone').fill('404 555 0199');
  await dialog.getByLabel('City').fill('Atlanta');
  await dialog.getByLabel(/New SSN/).fill('123');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByText('Enter the 9-digit SSN')).toBeVisible();
  await dialog.getByLabel(/New SSN/).fill('123-45-6789');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  const overview = page.getByTestId('client-overview');
  await expect(overview).toContainText('(404) 555-0199');
  await expect(overview).toContainText('Atlanta, GA 30011');
  await expect(overview).toContainText('•••-••-6789');
});

test('a client this person cannot see is not found', async ({ page }) => {
  await page.route('**/api/v1/business/clients/*', (route) =>
    json(route, { error: { code: 'NOT_FOUND', message: 'x' } }, 404),
  );
  await page.goto(app(`/clients/${maria.id}`));
  await expect(page.getByTestId('page-not-found')).toBeVisible();
  await page.goto(app('/clients/not-a-client'));
  await expect(page.getByTestId('page-not-found')).toBeVisible();
});
