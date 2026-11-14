import { expect, test } from '@playwright/test';

// Octavia's Review 2, Bookkeeping: the screen-only corrections (N02, N05, N08, E01b, I01, the
// desktop tabs), checked in mock mode as an Owner on Green Leaf Café's workspace.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-b100-7000-8000-000000000001';

test('View All keeps the client and service, Categorize opens Transactions, and the tab survives a reload', async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}`);
  // N02 and the Tasks tab scope: the canonical pages open on this client (and its service).
  await expect(
    page.getByTestId('shared-documents').getByRole('link', { name: 'View All' }),
  ).toHaveAttribute('href', /^\/documents\?clientId=[0-9a-f-]{36}&serviceId=[0-9a-f-]{36}/);
  await expect(
    page.getByTestId('shared-tasks').getByRole('link', { name: 'View All' }),
  ).toHaveAttribute('href', /^\/tasks\?clientId=[0-9a-f-]{36}/);
  // N08: Categorize Transactions opens Transactions, and the address keeps it.
  await page
    .getByTestId('quick-actions')
    .getByRole('button', { name: 'Categorize Transactions' })
    .click();
  await expect(page.getByTestId('transactions-tab')).toBeVisible();
  await expect(page).toHaveURL(/[?&]tab=transactions/);
  await page.reload();
  await expect(page.getByTestId('transactions-tab')).toBeVisible();
});

test("View All opens Documents on the current period's uploads, in a chip that clears (N02)", async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}`);
  await page.getByTestId('shared-documents').getByRole('link', { name: 'View All' }).click();
  await expect(page).toHaveURL(
    /\/documents\?.*uploadedFrom=\d{4}-\d{2}-\d{2}&uploadedTo=\d{4}-\d{2}-\d{2}&period=/,
  );
  const chip = page.getByTestId('documents-period');
  await expect(chip).toContainText(/Period: \S+/);
  await expect(chip).toContainText(/Documents uploaded from .+ to .+/);
  await chip.getByRole('button', { name: /^Clear the period / }).click();
  await expect(chip).toHaveCount(0);
  await expect(page.getByTestId('documents-scope')).toBeVisible();
});

test("a recent document opens in a quick view on the workspace, with Documents' own viewer (N03)", async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}`);
  const url = page.url();
  const card = page.getByTestId('shared-documents');
  await card.getByRole('button', { name: 'Upload Document' }).click();
  await page
    .getByTestId('upload-document')
    .locator('input[type=file]')
    .setInputFiles({
      name: 'Fake_N03_statement.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% synthetic test file\n'),
    });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await card.getByRole('button', { name: 'View Fake_N03_statement.pdf' }).click();
  const quick = page.getByRole('dialog', { name: 'Fake_N03_statement.pdf' });
  await expect(quick.getByTestId('document-preview')).toBeVisible();
  expect(page.url()).toBe(url);
});

test('every workspace tab, Settings too, shows at desktop width with no sideways scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${app}/bookkeeping/clients/${GREEN}`);
  await expect(page.getByRole('tab', { name: 'Settings' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('the software card says linked and authorized apart from synced (I01)', async ({ page }) => {
  await page.goto(`${app}/bookkeeping`);
  const card = page.getByTestId('software');
  await expect(card.getByTestId('provider-states')).toContainText(
    'figures arrive only after the first successful sync',
  );
  await expect(card).toContainText(/client(s)? linked/);
  await expect(card).toContainText(/Authorized|Not authorized/);
});

test("Terms' Payment Schedule View All opens this client's invoices (E01b)", async ({ page }) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}/terms`);
  await expect(
    page.getByTestId('terms-schedule').getByRole('link', { name: 'View All' }),
  ).toHaveAttribute('href', /^\/invoices\?client=[0-9a-f-]{36}/);
});
