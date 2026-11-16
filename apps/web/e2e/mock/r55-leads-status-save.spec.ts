import { expect, type Page, test } from '@playwright/test';

// R55, Leads Review Two R2 7: a status saved on the lead's page shows the new status and "Changes
// saved." at once; an error shows only when the save really failed. A save whose answer is lost
// after it went through (sessionStorage `fv-mock-fail` "leadPipeline.update@after", lib/mock.ts)
// is checked against the lead and told as saved. Mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
// Bruno Sandoval, In Follow-Up.
const url = `http://app.localhost:${port}/leads/0199c0c0-0a00-7000-8000-000000000003`;

async function saveStatus(page: Page, label: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await expect(page.getByTestId('card-lead-details')).toContainText('In Follow-Up');
  await page.getByRole('button', { name: 'Edit lead', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Lead' });
  await dialog.getByLabel('Status', { exact: true }).selectOption({ label });
  await dialog.getByRole('button', { name: 'Save Changes' }).click();
  return dialog;
}

test('R2 7: a saved status shows at once with "Changes saved."', async ({ page }) => {
  const dialog = await saveStatus(page, 'Qualified');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('lead-saved')).toHaveText('Changes saved.');
  await expect(page.getByTestId('card-lead-details')).toContainText('Qualified');
});

test('R2 7: a save that went through though its answer was lost is told as saved', async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.sessionStorage.setItem('fv-mock-fail', 'leadPipeline.update@after'),
  );
  const dialog = await saveStatus(page, 'Qualified');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('lead-saved')).toHaveText('Changes saved.');
  await expect(page.getByTestId('card-lead-details')).toContainText('Qualified');
});

test('R2 7: a save that failed says so and keeps the old status', async ({ page }) => {
  await page.addInitScript(() =>
    window.sessionStorage.setItem('fv-mock-fail', 'leadPipeline.update'),
  );
  const dialog = await saveStatus(page, 'Qualified');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('lead-saved')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('card-lead-details')).toContainText('In Follow-Up');
});
