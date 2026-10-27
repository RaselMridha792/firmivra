import { expect, test } from '@playwright/test';

// SH3 (Octavia's Oct 25 review: PY-F02, F03; the Bookkeeping request and documents contract;
// TX-F08 to F10 for R60): Request Documents and Upload Document open in place, prefilled with the
// client, the service and its period, and leave the member on the same tab. A main page's Request
// Documents asks which client first. Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-9c00-7000-8000-000000000001';
const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n% synthetic test file\n'),
});

test('Payroll Overview: Request Documents opens here, for this client and Payroll', async ({
  page,
}) => {
  await page.goto(`${app}/payroll/clients/${GREEN}`);
  await page
    .getByTestId('quick-actions')
    .getByRole('button', { name: 'Request Documents' })
    .click();
  const dialog = page.getByTestId('request-documents');
  await expect(dialog.getByText('Green Leaf Café LLC').first()).toBeVisible();
  await expect(dialog.getByText('Payroll', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/portal login/)).toBeVisible();
  const send = page.getByRole('button', { name: 'Send Request' });
  await expect(send).toBeDisabled();
  await dialog.getByLabel('Document needed').fill('Fake Q3 941 filing');
  await send.click();
  await expect(
    page.getByText('Requested "Fake Q3 941 filing" from Green Leaf Café LLC.'),
  ).toBeVisible();
  await expect(page).toHaveURL(`${app}/payroll/clients/${GREEN}`);
});

test('Payroll Documents tab: Upload Document files to this client and stays on the tab', async ({
  page,
}) => {
  await page.goto(`${app}/payroll/clients/${GREEN}?tab=documents`);
  await page.getByTestId('tab-documents').getByRole('button', { name: 'Upload Document' }).click();
  const dialog = page.getByTestId('upload-document');
  await expect(dialog.getByText('Green Leaf Café LLC')).toBeVisible();
  await dialog.locator('input[type=file]').setInputFiles([pdf('Fake_payroll_register.pdf')]);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(
    page.getByText(
      "Uploaded Fake_payroll_register.pdf to Green Leaf Café LLC's Payroll documents.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId('tab-documents')).toContainText('Fake_payroll_register.pdf');
  await expect(page).toHaveURL(/\/payroll\/clients\/[^/]+\?tab=documents$/);
});

test('Payroll list row menu: Request Payroll Documents opens for that row, Cancel sends nothing', async ({
  page,
}) => {
  await page.goto(`${app}/payroll`);
  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Request Payroll Documents' }).click();
  const dialog = page.getByTestId('request-documents');
  await expect(dialog.getByText('Green Leaf Café LLC').first()).toBeVisible();
  await dialog.getByLabel('Document needed').fill('Fake W-4');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(`${app}/payroll`);
});

test('Bookkeeping: the workspace request carries the period; the main page asks for the client', async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping`);
  await page.getByRole('button', { name: 'Request Documents' }).first().click();
  let dialog = page.getByTestId('request-documents');
  await expect(dialog.getByLabel('Client', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send Request' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page
    .getByRole('link', { name: /Green Leaf/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/bookkeeping\/clients\//);
  await page.getByRole('button', { name: 'Request Documents' }).first().click();
  dialog = page.getByTestId('request-documents');
  await expect(dialog.getByText('Bookkeeping', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Period')).toBeVisible();
  await expect(dialog.getByLabel('Instructions for the client')).toHaveValue(/^For .+\.$/);
  await dialog.getByLabel('Document needed').fill('Fake October bank statement');
  await page.getByRole('button', { name: 'Send Request' }).click();
  await expect(page.getByText(/^Requested "Fake October bank statement" from /)).toBeVisible();
  await expect(page).toHaveURL(/\/bookkeeping\/clients\//);
});
