// R60, the Client Portal module's Pending Client Actions (instructions 17): a signature item
// is listed with its record. Mock mode, as an Owner.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test('Pending Client Actions: a signature waiting for the client is listed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(app(`/client-portal/${JAMIE}`));
  const pending = page.getByTestId('pending-actions');
  await expect(pending).toContainText('Form 8879 (e-File Authorization)', { timeout: 60_000 });
  await expect(pending).toContainText(/Signature/);
});
