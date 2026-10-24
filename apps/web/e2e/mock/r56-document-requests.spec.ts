import { expect, test, type Page } from '@playwright/test';

// R56: Document Requests (Documents design, Frame 3) in mock mode: `api.documentLibrary`'s
// request packets and templates, following the API's views, tabs and sorts. Synthetic data only.
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/documents/requests'));
  await expect(page.getByTestId('document-requests')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('table', { name: 'Document requests' })).toContainText(
    '2025 Tax Documents',
  );
}

test('the cards, tabs, filters and table read the requests', async ({ page }) => {
  await open(page);
  const cards = page.getByTestId('request-cards');
  await expect(cards).toContainText('9Total Requests');
  await expect(cards).toContainText('1Overdue');
  const table = page.getByRole('table', { name: 'Document requests' });
  await expect(table.locator('tbody tr')).toHaveCount(9);
  await expect(table).toContainText('3 of 5 received');

  await page.getByRole('tab', { name: /Overdue/ }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table).toContainText('Engagement Agreement');
  await expect(table).toContainText('Overdue');

  await page.getByRole('tab', { name: /All Requests/ }).click();
  await page.getByRole('searchbox', { name: 'Search requests' }).fill('Bakery');
  await expect(table.locator('tbody tr')).toHaveCount(2);

  // The right column: the firm's templates and what happened lately.
  await expect(page.getByTestId('request-templates')).toContainText('Personal Tax Documents');
  await expect(page.getByTestId('request-templates')).toContainText('5 documents');
  await expect(page.getByTestId('request-activity')).toContainText('Document request sent to');
});

test('row actions and bulk reminders act on open requests', async ({ page }) => {
  await open(page);
  const table = page.getByRole('table', { name: 'Document requests' });
  await page.getByRole('button', { name: 'Actions for 2025 Tax Documents' }).click();
  await page.getByRole('menuitem', { name: 'Mark Complete' }).click();
  await expect(page.getByText('DR-0024 marked complete.')).toBeVisible();
  await expect(page.getByTestId('request-cards')).toContainText('2Completed');
  await expect(table.locator('tr', { hasText: '2025 Tax Documents' })).toContainText('Completed');

  const rows = table.locator('tbody tr');
  await rows.filter({ hasText: 'Business Formation Docs' }).getByRole('checkbox').check();
  await rows.filter({ hasText: 'Entity Documents' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send Reminders' }).click();
  await expect(page.getByText('Reminders sent to the open requests.')).toBeVisible();
});

test('Create Document Request opens its own page', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('link', { name: 'Create Document Request' }).first()).toHaveAttribute(
    'href',
    '/documents/requests/new',
  );
});
