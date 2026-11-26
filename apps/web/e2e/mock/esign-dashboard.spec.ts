import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('the dashboard: counters, recent documents and their filters', async ({ page }) => {
  // The mock requests are dated early October 2026 (expiry and the 30-day window follow them).
  await page.clock.setFixedTime(new Date('2026-10-08T18:00:00Z'));
  await page.goto(app('/firm-sign'));
  await expect(page.getByTestId('page-title')).toHaveText('Firm Sign');
  // The mock's counters are the mockup's.
  for (const [key, count] of [
    ['DRAFT', 12],
    ['NEEDS_APPROVAL', 3],
    ['SENT', 18],
    ['COMPLETED', 42],
    ['VOIDED', 0],
  ] as const) {
    await expect(page.getByTestId(`counter-${key}`)).toContainText(String(count));
  }
  const table = page.getByRole('table', { name: 'Recent documents' });
  await expect(table.getByRole('row')).toHaveCount(6);
  await expect(
    table.getByRole('link', { name: 'Payroll Authorization', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search documents').fill('Bookkeeping');
  await expect(
    table.getByRole('link', { name: 'Bookkeeping Services Agreement', exact: true }),
  ).toBeVisible();
  await expect(table.getByRole('link', { name: 'Payroll Authorization', exact: true })).toHaveCount(
    0,
  );
  // Every way to start links to its screen.
  const start = page.getByRole('group', { name: 'Start a request' });
  await expect(start.getByRole('link', { name: /Use Template/ })).toHaveAttribute(
    'href',
    '/firm-sign/templates',
  );
  await expect(start.getByRole('link', { name: /New Signature Request/ })).toHaveAttribute(
    'href',
    '/firm-sign/new',
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('the dashboard fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(app('/firm-sign'));
  await expect(page.getByTestId('counter-DRAFT')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('a counter opens All requests with its status', async ({ page }) => {
  await page.goto(app('/firm-sign'));
  await page.getByTestId('counter-COMPLETED').click();
  await expect(page).toHaveURL(/\/firm-sign\/requests\?status=COMPLETED$/);
  await expect(page.getByLabel('Status')).toHaveValue('COMPLETED');
});

test('tiles for screens not built yet say Soon and keep their subtitles', async ({ page }) => {
  await page.goto(app('/firm-sign'));
  const start = page.getByRole('group', { name: 'Start a request' });
  await expect(start.getByText('PDF, Word, and more')).toBeVisible();
  await expect(start.getByRole('link', { name: /Send from Client Record/ })).toHaveCount(0);
  await expect(start.getByText('Send from Client Record')).toBeVisible();
  await expect(page.getByRole('link', { name: 'In-Person Signing' })).toHaveCount(0);
});

test('FS-005: Dashboard recent documents show sender, next action, and expiry', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-08T18:00:00Z'));
  await page.goto(app('/firm-sign'));

  const table = page.getByRole('table', { name: 'Recent documents' });
  await expect(table.locator('th', { hasText: 'Sender' })).toBeVisible();
  await expect(table.locator('th', { hasText: 'Waiting On' })).toBeVisible();
  await expect(table.locator('th', { hasText: 'Expires' })).toBeVisible();

  // Verify rows contain sender and waiting on details
  const firstRow = table.getByRole('row').nth(1);
  await expect(firstRow).toBeVisible();
  await expect(firstRow).toContainText('Mock User');
});

test('FS-002: Created and Edited audit events persist with actor, timestamp, and version across reload', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-08T18:00:00Z'));

  // 1. Create a fresh draft
  await page.goto(app('/firm-sign/new'));
  await page.getByLabel('Document name').fill('Draft Audit Test');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/firm-sign\/requests\/[0-9a-f-]+\/prepare$/);

  const requestId = page.url().match(/requests\/([0-9a-f-]+)\/prepare/)?.[1];
  expect(requestId).toBeTruthy();

  // 2. Perform two edits in the prepare settings step (internal note)
  await page.goto(app(`/firm-sign/requests/${requestId}/prepare?step=settings`));
  await page.getByLabel('Only your team sees this note').fill('First edit note');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeDisabled();

  // Edit 2: update note again
  await page.getByLabel('Only your team sees this note').fill('Second edit note');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeDisabled();

  // 3. View request detail timeline
  await page.goto(app(`/firm-sign/requests/${requestId}`));
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toBeVisible();
  await expect(timeline).toContainText('Created (v1)');
  await expect(timeline).toContainText('Edited (v2)');
  await expect(timeline).toContainText('Edited (v3)');
  await expect(timeline).toContainText('Mock User');

  // 4. Reload page and verify all audit records persist
  await page.reload();
  await expect(timeline).toBeVisible();
  await expect(timeline.locator('li')).toHaveCount(3);
  await expect(timeline).toContainText('Created (v1)');
  await expect(timeline).toContainText('Edited (v2)');
  await expect(timeline).toContainText('Edited (v3)');
  await expect(timeline).toContainText('Mock User');
});
