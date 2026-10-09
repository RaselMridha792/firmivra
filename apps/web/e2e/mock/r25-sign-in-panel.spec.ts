import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('the firm sign-in shows firm features, the Super Admin one platform features', async ({
  page,
}) => {
  await page.goto(app('/sign-in'));
  await expect(page.getByRole('heading', { name: 'Firm workspace' })).toBeAttached();
  await expect(page.getByText('Serve Clients', { exact: true })).toBeVisible();
  await expect(page.getByText('Manage Firms', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Serve. Organize. Grow.' })).toBeVisible();
  await page.goto(admin('/sign-in'));
  await expect(page.getByRole('heading', { name: 'Super Admin console' })).toBeAttached();
  await expect(page.getByText('Manage Firms', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Manage. Approve. Grow.' })).toBeVisible();
});
