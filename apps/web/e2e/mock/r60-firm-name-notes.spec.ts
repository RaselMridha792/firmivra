// Batch 2 (R61's sweep): the Permission Notes on Create Staff's Role & Permissions and on Roles &
// Permissions name the signed-in firm, never a fixed one. Mock mode: the mock firm is "LVP
// Accounting & Taxes", so the full name shows and the old fixed "in LVP." never does.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const FIRM = 'LVP Accounting & Taxes';

test('Roles & Permissions names the signed-in firm in its Permission Notes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/roles'));
  const notes = page.getByText(/^Permissions control what people with this role can see and do in/);
  await expect(notes).toContainText(`do in ${FIRM}.`, { timeout: 60_000 });
  await expect(page.getByText('do in LVP.')).toHaveCount(0);
});

test('Create Staff’s Role & Permissions names the signed-in firm in its Permission Notes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/new/permissions'));
  await expect(
    page.getByText(/^Permissions control what this staff member can see and do in/),
  ).toContainText(`do in ${FIRM}.`, { timeout: 60_000 });
  await expect(page.getByText('do in LVP.')).toHaveCount(0);
});

test('the portal’s own page names no firm', async ({ page }) => {
  await page.goto(`http://portal.localhost:${port}/`);
  await expect(page.getByText('Open the portal link your firm sent you.')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('main')).not.toContainText('lvp');
});
