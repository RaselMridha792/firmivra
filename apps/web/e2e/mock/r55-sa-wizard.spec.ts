import { expect, test } from '@playwright/test';

// R55, Octavia's Super Admin review of Oct 31 (SA-INT-R1, R2): each step saves with "Save and
// continue" and says "Draft saved" with the time; Cancel on a saved draft keeps it or discards it,
// and the list shows a kept draft at once. Mock mode; 1440 px.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

test('the wizard saves with Save and continue, says Draft saved, and Cancel keeps or discards (SA-INT-R1, R2)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin('/integrations/platform/new'));
  await expect(page.getByLabel('Provider', { exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  await page.getByLabel(/^Integration Name/).fill('Sample Status Pager');
  await page.getByLabel(/^Category/).selectOption('OTHER');
  await page.getByLabel(/^Short Description/).fill('Status page alerts for the Firmivra team.');
  await page.getByLabel(/^Provider Website/).fill('https://status.example.test');
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();

  // Saved: the step says so, with the time.
  await expect(page.getByRole('heading', { name: '2. Connection Details' })).toBeVisible();
  await expect(page.getByTestId('draft-saved')).toContainText('Draft saved');
  // Cancel on a saved draft: keep it or discard it.
  await page.getByRole('button', { name: 'Cancel' }).first().click();
  const ask = page.getByRole('dialog', { name: 'Keep your saved draft?' });
  await expect(ask.getByRole('button', { name: 'Discard draft' })).toBeVisible();
  await page.screenshot({
    path: 'e2e/mock/r55-screenshots/super-admin/wizard-keep-or-discard.png',
  });
  await ask.getByRole('button', { name: 'Keep draft' }).click();
  // Kept: back on the list. (Every wizard save refreshes the 'admin-integrations' queries, the
  // list's included, SA-INT-R2; the mock API keeps no new drafts, so the row itself is checked on
  // the API, not here.)
  await expect(page).toHaveURL(/\/integrations$/);
});
