import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

// The client list isn't mocked yet: these are the mock's own synthetic clients, served here.
const client = (n: number, displayName: string) => ({
  id: `0199b6a1-0000-7000-8000-${String(n).padStart(12, '0')}`,
  accountType: 'INDIVIDUAL',
  displayName,
  email: null,
  phone: null,
  assignedTo: null,
  portalStatus: n === 1 ? 'ACTIVE' : null,
  archivedAt: null,
  createdAt: '2026-10-01T09:00:00.000Z',
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/business/clients?*', (route) =>
    route.fulfill({
      json: {
        items: [client(1, 'Jamie Sample'), client(3, 'Riley Example')],
        nextCursor: null,
      },
    }),
  );
});

test('bulk send a template to two clients; one has no login and is not sent', async ({ page }) => {
  await page.goto(app('/firm-sign/bulk'));
  await expect(page.getByTestId('page-title')).toHaveText('Bulk send');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByLabel('Template', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );

  await page
    .getByLabel('Template', { exact: true })
    .selectOption({ label: 'Section 7216 Consent' });
  await expect(page.getByText('Preparer: you')).toBeVisible();
  await page.getByLabel('Jamie Sample').check();
  await page.getByLabel('Riley Example').check();
  await expect(page.getByTestId('chosen-count')).toHaveText('2 clients chosen');
  // Jamie has two open services: one must be picked before sending.
  await page.getByLabel('Send 2 separate requests now').check();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Choose the service for Jamie Sample')).toBeVisible();
  await page.getByLabel('Jamie Sample: service').selectOption({ label: '2025 Personal Tax' });
  // Any change asks for the confirmation again.
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Tick the box to confirm')).toBeVisible();
  await page.getByLabel('Send 2 separate requests now').check();
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page).toHaveURL(/\/firm-sign\/bulk\?batch=[0-9a-f-]{36}$/);
  await expect(page.getByTestId('page-title')).toHaveText('Bulk send: Section 7216 Consent');
  const rows = page.getByRole('table', { name: 'Bulk send results' }).getByRole('row');
  await expect(rows.filter({ hasText: 'Jamie Sample' })).toContainText('Sent');
  await expect(rows.filter({ hasText: 'Riley Example' })).toContainText('Not sent');
  await expect(rows.filter({ hasText: 'Riley Example' })).toContainText('no portal login');
  await expect(page.getByTestId('batch-summary')).toContainText('Finished: 1 sent, 1 not sent');
});

test('a batch link that is not one shows Not found', async ({ page }) => {
  await page.goto(app('/firm-sign/bulk?batch=nope'));
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
