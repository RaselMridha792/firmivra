import { expect, test } from '@playwright/test';

// R60, Octavia's Oct 28 Templates review, TP-F08 part 1 (playwright.mock.config.ts, as an Owner;
// the mock answers as the API): a Task template stands for one of the firm's task templates and
// shows its checklist; a Tax Workflow template keeps its checklist by section, saved and reloaded.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/templates`;

test('TP-F08: a Task template stands for a task template and shows its checklist', async ({
  page,
}) => {
  await page.goto(`${base}/new?kind=task`);
  const panel = page.getByTestId('structure-panel');
  await panel.getByLabel('Task template').selectOption({ label: 'New client onboarding' });
  await expect(panel.getByTestId('structure-steps')).toContainText('Send the engagement letter');
  await page.getByLabel('Template Name *').fill('Onboarding steps');
  await page
    .getByTestId('editor-main')
    .locator('[contenteditable="true"]')
    .fill('Follow the checklist.');
  // The first save opens the template's own address, where it is read back.
  await page.getByTestId('save-draft').click();
  await page.waitForURL(/\/templates\/[^/]+\/edit$/);
  await expect(panel.getByLabel('Task template')).toHaveValue(/.+/);
  await expect(panel.getByTestId('structure-steps')).toContainText('Open the file');
});

test('TP-F08: a Tax Workflow template keeps its checklist by section', async ({ page }) => {
  await page.goto(`${base}/new?kind=tax-workflow`);
  const panel = page.getByTestId('structure-panel');
  await panel.getByLabel('Section 1', { exact: true }).fill('Income');
  await panel.getByLabel('Steps of section 1').fill('W-2 forms\n1099 forms');
  await panel.getByRole('button', { name: 'Add Section' }).click();
  await panel.getByLabel('Section 2', { exact: true }).fill('Review');
  await panel.getByLabel('Steps of section 2').fill('Review with the client');
  await page.getByLabel('Template Name *').fill('Individual return workflow');
  await page.getByTestId('editor-main').locator('[contenteditable="true"]').fill('Our steps.');
  // The first save opens the template's own address, where it is read back.
  await page.getByTestId('save-draft').click();
  await page.waitForURL(/\/templates\/[^/]+\/edit$/);
  await expect(panel.getByTestId('tax-section')).toHaveCount(2);
  await expect(panel.getByLabel('Steps of section 1')).toHaveValue('W-2 forms\n1099 forms');
});
