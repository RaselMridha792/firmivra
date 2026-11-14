import { expect, test } from '@playwright/test';

// R55, Intake Forms Review Two (ACCESS-01): the client opens the exact form the firm sent, from
// the Intake Forms page's "Forms from your firm", fills it step by step and saves; a completed one
// shows its answers without editing. In mock mode (playwright.mock.config.ts) as the portal
// client. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('opens a sent form by its own address, saves a step, and shows a completed one read-only', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/intake'));
  const sent = page.getByTestId('sent-intakes');
  await expect(sent).toContainText('Forms from your firm');
  const row = sent.getByRole('listitem').filter({ hasText: 'Q3 2026 Quarterly Taxes' });
  await expect(row).toContainText('Not Started');
  await row.getByRole('link', { name: /Open form/ }).click();

  await expect(page).toHaveURL(/\/lvp\/intake\/[0-9a-f-]{36}$/);
  const form = page.getByTestId('assigned-intake');
  await expect(form.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(form.getByTestId('intake-next')).toHaveText(/Continue/);
  await form.getByRole('button', { name: 'Save and Continue Later' }).click();
  await expect(form.getByRole('status')).toContainText('Your answers are saved');

  // A completed form: its answers, no editing.
  await page.goto(portal('/lvp/intake'));
  const done = sent.getByRole('listitem').filter({ hasText: 'Completed' }).first();
  await done.getByRole('link', { name: /View/ }).click();
  await expect(page.getByTestId('intake-read-only')).toBeVisible();
  await expect(page.getByTestId('intake-next')).toHaveCount(0);
});
