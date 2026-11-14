import { expect, test } from '@playwright/test';

// R60, Open Client Portal (developer instructions 3, 14 and 26; the lead's decision of Nov 14): a
// read-only staff preview of the client's portal, never a client session. And TX-F04: the Client
// Portal opened from a tax return keeps Back to the return on every tab. Mock mode. Synthetic
// data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test('Open Client Portal shows the read-only preview of what the client sees', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/client-portal/${JAMIE}`));
  await expect(page.getByTestId('page-title')).toHaveText('Jamie Sample', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Open Client Portal' }).click();
  await expect(page).toHaveURL(app(`/client-portal/${JAMIE}/preview`));
  const preview = page.getByTestId('portal-preview');
  await expect(preview).toContainText('Staff preview, read only');
  await expect(preview).toContainText('Hi Jamie,');
  await expect(preview.getByTestId('preview-menu')).toContainText('Messages');
  await expect(preview.getByTestId('preview-next-steps')).toContainText('W-2 forms (fake)');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    'Portal Preview',
  );
});

test('opened from a tax return, every tab keeps the way back (TX-F04)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/client-portal/${JAMIE}?from=${encodeURIComponent('/tax-returns/x')}`));
  await expect(page.getByTestId('page-title')).toHaveText('Jamie Sample', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: /Back to Tax Returns/ })).toBeVisible();
  await page.getByRole('link', { name: 'Access & Security' }).click();
  await expect(page).toHaveURL(/\/access\?from=%2Ftax-returns%2Fx/);
  await expect(page.getByRole('button', { name: /Back to Tax Returns/ })).toBeVisible();
});
