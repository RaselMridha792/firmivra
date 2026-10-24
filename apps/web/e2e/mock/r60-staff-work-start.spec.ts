import { expect, test } from '@playwright/test';

// Octavia's Staff Management review of Oct 23, SM11: a Work Start Date apart from the Hire Date and
// the Access Start Date. Mock mode (playwright.mock.config.ts) as the Owner; the mock's sixth
// member is Hana Kim. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const HANA = '0199c0a0-0a00-7000-8000-000000000006';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test('Create Staff step 4 asks for the Work Start Date apart from the Hire Date', async ({
  page,
}) => {
  await page.goto(app('/team/new/details'));
  const hire = page.getByLabel('Hire Date');
  const start = page.getByLabel('Work Start Date');
  await expect(start).toBeVisible({ timeout: 60_000 });
  await hire.fill('2026-11-02');
  await start.fill('2026-11-16');
  await expect(hire).toHaveValue('2026-11-02');
  await expect(start).toHaveValue('2026-11-16');
});

test('Edit Staff saves the Start Date without changing the Hire Date', async ({ page }) => {
  await page.goto(app(`/team/${HANA}`));
  await expect(page.getByLabel('First Name *')).toHaveValue('Hana', { timeout: 60_000 });
  const start = page.getByLabel('Start Date', { exact: true });
  const hire = page.getByLabel('Hire Date');
  const hired = await hire.inputValue();
  expect(hired).not.toBe('');
  await start.fill('2026-12-01');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('edit-saved')).toHaveText('Changes saved for Hana Kim.');
  await expect(start).toHaveValue('2026-12-01');
  await expect(hire).toHaveValue(hired);

  await start.fill('');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('edit-saved')).toHaveText('Changes saved for Hana Kim.');
  await expect(start).toHaveValue('');
});
