import { expect, test, type Page } from '@playwright/test';

// R56: one document request's page for staff (the Documents guide's staff detail state) in mock
// mode: `api.documentLibrary`'s request and its actions, and the documents API's accept and
// reject for one item. Synthetic data only.
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const app = (path: string) => `http://app.localhost:${port}${path}`;
const packet = (n: number) => `0199d2b0-7b00-7000-8000-${String(n).padStart(12, '0')}`;

async function open(page: Page, path: string) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(path));
  await expect(page.getByTestId('request-detail')).toBeVisible({ timeout: 60_000 });
}

test('an open request: its checklist, review of what came in, reminders and dates', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/documents/requests'));
  await page.getByRole('link', { name: '2025 Tax Documents' }).click({ timeout: 60_000 });
  await expect(page).toHaveURL(new RegExp(`/documents/requests/${packet(24)}$`));
  await expect(page.getByRole('heading', { name: '2025 Tax Documents' })).toBeVisible();
  await expect(page.getByTestId('request-cards')).toContainText('3 of 5');
  const items = page.getByTestId('checklist-item');
  await expect(items).toHaveCount(5);
  await expect(items.nth(0)).toContainText('Accepted');
  await expect(items.nth(1)).toContainText('Received');
  await expect(items.nth(3)).toContainText('Waiting');
  await expect(page.getByRole('button', { name: 'Download 1099-forms.pdf' })).toBeVisible();

  await items.nth(1).getByRole('button', { name: 'Accept' }).click();
  await expect(items.nth(1)).toContainText('Accepted');

  await items.nth(2).getByRole('button', { name: 'Request Replacement' }).click();
  await page.getByRole('button', { name: 'Ask Again' }).click();
  await expect(page.getByText('Tell the client what is missing.')).toBeVisible();
  await page.getByLabel('What is missing or wrong *').fill('Fake: the December page is missing.');
  await page.getByRole('button', { name: 'Ask Again' }).click();
  await expect(items.nth(2)).toContainText('Replacement Requested');
  await expect(items.nth(2)).toContainText('Asked again: Fake: the December page is missing.');

  await page.getByRole('button', { name: 'Send Reminder' }).click();
  await expect(page.getByTestId('request-activity')).toContainText('Reminder sent to Jamie Sample');

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Change Due Date' }).click();
  await page.getByLabel('Due Date *').fill('2099-01-15');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('request-info')).toContainText('Jan 15, 2099');
});

test('a draft: fix what is missing, change the checklist, then send it', async ({ page }) => {
  await open(page, `/documents/requests/${packet(17)}`);
  await expect(page.getByRole('heading', { name: 'Advisory Intake Documents' })).toBeVisible();
  await page.getByRole('button', { name: 'Send Request' }).click();
  await expect(
    page.getByText('Add a due date, a subject, a message and at least one document'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit Details' }).click();
  await page.getByLabel('Subject Line').fill('Action Needed: Advisory Intake Documents');
  await page
    .getByLabel('Message', { exact: true })
    .fill('Fake message: please upload these documents.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('request-message')).toContainText('Fake message');

  const items = page.getByTestId('checklist-item');
  await expect(items).toHaveCount(3);
  await page
    .getByRole('button', {
      name: `Actions for ${await items.nth(2).locator('p').first().innerText()}`,
    })
    .click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(items).toHaveCount(2);
  await page.getByRole('button', { name: 'Add Document' }).click();
  await page.getByLabel('Document Name *').fill('Fake Business Plan');
  await page.getByRole('button', { name: 'Add Document' }).last().click();
  await expect(items).toHaveCount(3);

  await page.getByRole('button', { name: 'Send Request' }).click();
  await expect(page.getByTestId('request-cards')).toContainText('Outstanding');
  await expect(page.getByRole('button', { name: 'Send Reminder' })).toBeVisible();
});

test('a request that is not there says so', async ({ page }) => {
  await open(page, '/documents/requests/not-a-request');
  await expect(page.getByText('This request was not found')).toBeVisible();
});
