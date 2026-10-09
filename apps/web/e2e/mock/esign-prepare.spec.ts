import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
/** The mock's first client, Jamie Sample. */
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test('start a request: it needs a name, then opens the wizard', async ({ page }) => {
  await page.goto(app('/firm-sign/new'));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Name the document')).toBeVisible();
  await page.getByLabel('Document name').fill('Synthetic Engagement Letter');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/firm-sign\/requests\/[0-9a-f-]+\/prepare$/);
  await expect(page.getByTestId('page-title')).toHaveText('Synthetic Engagement Letter');
  await expect(page.getByRole('list', { name: 'Steps' })).toBeVisible();
});

test('from a client record the client is chosen', async ({ page }) => {
  await page.goto(app(`/firm-sign/new?clientId=${JAMIE}`));
  await expect(page.getByLabel('Client')).toHaveValue(JAMIE);
  await page.getByLabel('Document name').fill('Synthetic W-2 sign-off');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('For Jamie Sample')).toBeVisible();
});

test('a sent request cannot be prepared', async ({ page }) => {
  await page.goto(app('/firm-sign/requests/0199b6e0-0000-7000-8000-000000000004/prepare'));
  await expect(page.getByText('This request has been sent')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the request' })).toBeVisible();
});
