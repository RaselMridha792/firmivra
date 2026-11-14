import { expect, test } from '@playwright/test';

// Octavia's Review 2, Payroll: the screen-only corrections (UX01, UX02, UX03, F02, F05), checked
// in mock mode as an Owner on Green Leaf Café's payroll workspace.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-9c00-7000-8000-000000000001';

test('every tab shows at desktop width with no sideways scroll, and the tab survives a reload (UX01, UX03)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${app}/payroll/clients/${GREEN}`);
  const tabs = page.getByRole('tablist', { name: 'Payroll client tabs' });
  await expect(tabs.getByRole('tab', { name: 'Settings' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await tabs.getByRole('tab', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/[?&]tab=reports/);
  await page.reload();
  await expect(page.getByTestId('tab-reports')).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'Reports' })).toHaveAttribute('aria-selected', 'true');
});

test('a document shows its service and source, with View and Download (UX02)', async ({ page }) => {
  await page.goto(`${app}/payroll/clients/${GREEN}?tab=documents`);
  await page.getByTestId('tab-documents').getByRole('button', { name: 'Upload Document' }).click();
  await page
    .getByTestId('upload-document')
    .locator('input[type=file]')
    .setInputFiles({
      name: 'Fake_UX02_register.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% synthetic test file\n'),
    });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const doc = page.getByTestId('payroll-document').filter({ hasText: 'Fake_UX02_register.pdf' });
  await expect(doc).toContainText(/Payroll.* · /);
  await expect(doc.getByRole('link', { name: 'View Fake_UX02_register.pdf' })).toHaveAttribute(
    'href',
    /^\/documents\/[0-9a-f-]{36}/,
  );
  await expect(doc.getByRole('button', { name: 'Download Fake_UX02_register.pdf' })).toBeVisible();
});

test('the tabs and the Status filter keep one status, and the list says which (F06)', async ({
  page,
}) => {
  await page.goto(`${app}/payroll`);
  const status = page.getByLabel('Status', { exact: true });
  await status.selectOption('ON_HOLD');
  await expect(page.getByRole('table', { name: 'On Hold clients' })).toBeVisible();
  // A status tab replaces the filter's status: no stale On Hold behind Processing.
  await page.getByRole('tab', { name: /^Processing/ }).click();
  await expect(status).toHaveValue('');
  await expect(page.getByRole('table', { name: /^Processing/ })).toBeVisible();
});

test('Open Messages from Communications comes back to Communications (F05)', async ({ page }) => {
  await page.goto(`${app}/payroll/clients/${GREEN}?tab=communications`);
  const open = page.getByTestId('tab-communications').getByRole('link', { name: 'Open Messages' });
  // The link names the client once the workspace has loaded.
  await expect(open).toHaveAttribute('href', /clientId=/);
  await open.click();
  await expect(page).toHaveURL(/\/messages\?clientId=[0-9a-f-]{36}&service=Payroll&from=/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(/\/payroll\/clients\/[0-9a-f-]{36}\?tab=communications/);
  await expect(page.getByTestId('tab-communications')).toBeVisible();
});
