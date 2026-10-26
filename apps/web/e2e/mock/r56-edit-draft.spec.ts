import { expect, test, type Page } from '@playwright/test';

// R56: Edit Draft (the Documents guide: "Edit Draft returns to Frame 4 with the same draft") in
// mock mode: a saved draft opens in Create Document Request, its checklist and message change,
// and it is saved or sent as the same request. Synthetic data only.
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const app = (path: string) => `http://app.localhost:${port}${path}`;
const draft = '0199d2b0-7b00-7000-8000-000000000017';

async function openDraft(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/documents/requests/${draft}`));
  await expect(page.getByRole('heading', { name: 'Advisory Intake Documents' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit Draft' }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/requests/new\\?draft=${draft}$`));
  await expect(page.getByRole('heading', { name: 'Edit Document Request' })).toBeVisible();
}

test('a draft opens as saved, its checklist changes, and it is sent as the same request', async ({
  page,
}) => {
  await openDraft(page);
  // What a draft cannot change stays as saved.
  await expect(page.getByRole('button', { name: /^Client/ })).toBeDisabled();
  await expect(page.getByLabel('Request Type *')).toBeDisabled();
  await expect(page.getByLabel('Request Title *')).toHaveValue('Advisory Intake Documents');
  const rows = page.getByTestId('request-item');
  await expect(rows).toHaveCount(3);

  const third = await rows.nth(2).locator('td').nth(1).innerText();
  await page.getByRole('checkbox', { name: `Request ${third.trim()}` }).uncheck();
  await page.getByRole('button', { name: 'Add Custom Document' }).click();
  await page.getByLabel('Document Name *').fill('Fake Business Plan');
  await page.getByRole('button', { name: 'Add Document' }).click();
  await expect(rows).toHaveCount(4);

  await page.getByRole('button', { name: 'Next: Review & Send' }).click();
  await expect(page.getByTestId('review')).toContainText('Documents (3)');
  await page.getByRole('button', { name: 'Send Request' }).click();
  await expect(page.getByTestId('request-saved')).toContainText('DR-0017 was sent');

  await page.getByRole('button', { name: 'View Request' }).click();
  const items = page.getByTestId('checklist-item');
  await expect(items).toHaveCount(3);
  await expect(items.last()).toContainText('Fake Business Plan');
  await expect(page.getByTestId('request-cards')).toContainText('Outstanding');
});

test('Save as Draft keeps it a draft, with the new title', async ({ page }) => {
  await openDraft(page);
  await page.getByLabel('Request Title *').fill('Fake Advisory Documents');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByTestId('request-saved')).toContainText('DR-0017 was saved as a draft.');
  await page.getByRole('button', { name: 'View Request' }).click();
  await expect(page.getByRole('heading', { name: 'Fake Advisory Documents' })).toBeVisible();
});

test('a request that was sent cannot be edited as a draft', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/documents/requests/new?draft=0199d2b0-7b00-7000-8000-000000000024'));
  await expect(page.getByText('This request was sent, so it is no longer a draft.')).toBeVisible({
    timeout: 60_000,
  });
});
