import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
// The first mock request (mocks/esign.ts): "Tax Engagement Letter 2026", signed by email only.
const emailOnly = '0199b6e0-0000-7000-8000-000000000001';

test('a locked session lands on the kiosk; with none open, on Firm Sign', async ({ page }) => {
  await page.goto(app('/firm-sign/in-person'));
  await expect(page).toHaveURL(/\/firm-sign$/);
});

test('a request with no in-person signer cannot start a kiosk', async ({ page }) => {
  await page.goto(app(`/firm-sign/in-person/${emailOnly}`));
  await expect(page.getByTestId('page-title')).toHaveText('In-person signing');
  await expect(page.getByText('No one on this request signs in person.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to the request' }).click();
  await expect(page).toHaveURL(new RegExp(`/firm-sign/requests/${emailOnly}$`));
});
