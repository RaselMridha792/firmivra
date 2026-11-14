import { expect, test } from '@playwright/test';

// The client record (R23): header, tabs and Overview in mock mode, as the Owner. The clients mock
// (`src/mocks/clients.ts`) answers in the browser, so the spec reads its fixtures: client 1, Jamie
// Sample (an individual with a portal login), and client 2, Acme Widgets LLC (a business). R60
// moved it onto the mock (Nov 10): it used to answer the API with its own routes, which the mock
// never calls. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const clientId = (n: number) => `0199b6a1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const jamie = clientId(1);
const acme = clientId(2);

test.describe.configure({ timeout: 120_000 });

test('the overview shows the record with the SSN masked', async ({ page }) => {
  await page.goto(app(`/clients/${jamie}`));
  await expect(page.getByTestId('page-title')).toHaveText('Jamie Sample', { timeout: 60_000 });
  const overview = page.getByTestId('client-overview');
  await expect(overview).toContainText('•••-••-0001');
  await expect(overview).toContainText('April 12, 1985');
  await expect(overview).toContainText('123 Main Street');
  // E10: Portal Access (Business Advisory B3's card) lists the login and its role.
  await expect(page.getByTestId('portal-access')).toContainText('jamie.sample@example.test');
  await expect(page.getByTestId('portal-access')).toContainText('primary');
  const tabs = page.getByRole('navigation', { name: 'Client' });
  await expect(tabs.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(tabs.getByRole('link', { name: 'Documents', exact: true })).toHaveAttribute(
    'href',
    `/clients/${jamie}/documents`,
  );
});

test('a business shows the EIN masked', async ({ page }) => {
  await page.goto(app(`/clients/${acme}`));
  await expect(page.getByTestId('page-title')).toHaveText('Acme Widgets LLC (fake)', {
    timeout: 60_000,
  });
  const overview = page.getByTestId('client-overview');
  await expect(overview).toContainText('••-•••0002');
  await expect(overview).toContainText('No portal login yet');
  // No other client's masked SSN or EIN (client 1's ends 0001); Linked Profiles shows client
  // 1's Client ID, CL-10001, which is not a secret.
  await expect(overview).not.toContainText(/•[•-]*0001/);
});

test('the owner archives and restores a client', async ({ page }) => {
  await page.goto(app(`/clients/${jamie}`));
  await page.getByRole('button', { name: 'Archive client' }).click({ timeout: 60_000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Restore client' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore client' }).click();
  await expect(page.getByRole('button', { name: 'Archive client' })).toBeVisible();
});

test('the owner edits contact details and replaces the SSN', async ({ page }) => {
  await page.goto(app(`/clients/${jamie}`));
  await page.getByRole('button', { name: 'Edit details' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Phone').fill('404 555 0199');
  await dialog.getByLabel('City').fill('Decatur');
  await dialog.getByLabel(/New SSN/).fill('123');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByText('Enter the 9-digit SSN')).toBeVisible();
  await dialog.getByLabel(/New SSN/).fill('123-45-6789');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  const overview = page.getByTestId('client-overview');
  await expect(overview).toContainText('(404) 555-0199');
  await expect(overview).toContainText('Decatur, GA 30301');
  await expect(overview).toContainText('•••-••-6789');
});

test('a client this person cannot see is not found', async ({ page }) => {
  await page.goto(app(`/clients/${clientId(999)}`));
  await expect(page.getByTestId('page-not-found')).toBeVisible({ timeout: 60_000 });
  await page.goto(app('/clients/not-a-client'));
  await expect(page.getByTestId('page-not-found')).toBeVisible();
});
