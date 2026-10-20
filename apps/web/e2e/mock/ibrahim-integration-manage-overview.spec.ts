import { expect, test, type Page } from '@playwright/test';
import {
  integrationManageFixture,
  MANAGE_INTEGRATION_ID,
} from '../../src/mocks/integrations-manage';

test.use({ viewport: { width: 1440, height: 1100 } });

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/integrations/${MANAGE_INTEGRATION_ID}`;

async function mockConnection(page: Page, state: 'data' | 'empty' | 'offline' = 'data') {
  await page.route(
    `**/api/v1/business/integrations/connections/${MANAGE_INTEGRATION_ID}**`,
    async (route) => {
      if (state === 'offline') return route.abort('connectionfailed');
      if (route.request().method() === 'GET')
        return route.fulfill({ json: integrationManageFixture(state === 'empty') });
      if (route.request().url().endsWith('/test'))
        return route.fulfill({
          json: {
            ...integrationManageFixture().health,
            runId: '44444444-4444-4444-8444-444444444444',
          },
        });
      if (route.request().url().endsWith('/sync'))
        return route.fulfill({ json: integrationManageFixture().recentRuns[0] });
      return route.fulfill({ json: integrationManageFixture(state === 'empty') });
    },
  );
}

test('matches the overview frame and supports contract actions', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await mockConnection(page);
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'QuickBooks Online' })).toBeVisible();
  for (const id of [
    'integration-header',
    'connection-details',
    'sync-controls',
    'sync-data',
    'recent-sync-activity',
    'data-mapping-preview',
    'connection-health',
  ])
    await expect(page.getByTestId(id)).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Integration management' }).getByRole('link'),
  ).toHaveCount(6);
  await page.screenshot({
    path: info.outputPath('manage-overview-data-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Run Connection Test' }).click();
  await expect(page.getByTestId('manage-integration-overview').getByRole('status')).toContainText(
    'active and working',
  );
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Records already imported');
  await page.getByRole('button', { name: 'Cancel' }).click();
});

test('keeps every widget frame in the empty state', async ({ page }, info) => {
  await mockConnection(page, 'empty');
  await page.goto(url);
  await expect(page.getByText('No sync activity yet.')).toBeVisible();
  await expect(page.getByText('No fields have been mapped.')).toBeVisible();
  await expect(page.getByText('No health checks are available.')).toBeVisible();
  await expect(page.getByTestId('sync-data')).toBeVisible();
  await page.screenshot({
    path: info.outputPath('manage-overview-empty-desktop.png'),
    fullPage: true,
  });
});

test('keeps every widget frame when the API is unavailable', async ({ page }, info) => {
  await mockConnection(page, 'offline');
  await page.goto(url);
  await expect(page.getByTestId('manage-overview-offline')).toBeVisible();
  for (const id of [
    'connection-details',
    'sync-controls',
    'sync-data',
    'recent-sync-activity',
    'data-mapping-preview',
    'connection-health',
  ])
    await expect(page.getByTestId(id)).toBeVisible();
  await page.screenshot({
    path: info.outputPath('manage-overview-offline-desktop.png'),
    fullPage: true,
  });
});

test('stacks without horizontal overflow at 375px', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockConnection(page);
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'QuickBooks Online' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: info.outputPath('manage-overview-data-mobile.png'),
    fullPage: true,
  });
});

test('overview settings controls send contract values and respect read-only access', async ({
  page,
}) => {
  await mockConnection(page);
  const changes: unknown[] = [];
  await page.route(`**/connections/${MANAGE_INTEGRATION_ID}/settings`, async (route) => {
    changes.push(route.request().postDataJSON());
    return route.fulfill({
      status: 409,
      json: { error: { code: 'NOT_SUPPORTED', message: 'Settings could not be saved.' } },
    });
  });
  await page.goto(url);
  const controls = page.getByTestId('sync-controls');
  await controls.getByLabel('Sync Frequency', { exact: true }).selectOption('30');
  await expect(controls.getByRole('alert')).toContainText(
    'These sync settings are not supported by this provider.',
  );
  expect(changes).toContainEqual({ syncMode: 'AUTO', syncEveryMinutes: 30 });
  await controls.getByLabel('Sync Direction', { exact: true }).selectOption('IMPORT');
  await expect.poll(() => changes.length).toBe(2);
  expect(changes).toContainEqual({ direction: 'IMPORT' });
  await expect(controls.getByLabel('Auto sync status')).toBeEnabled();
  await controls.getByLabel('Auto sync status').click();
  await expect.poll(() => changes.length).toBe(3);
  expect(changes).toContainEqual({ syncMode: 'MANUAL', syncEveryMinutes: null });
  await page.route(`**/connections/${MANAGE_INTEGRATION_ID}`, async (route) => {
    const detail = integrationManageFixture();
    detail.canManage = false;
    return route.fulfill({ json: detail });
  });
  await page.reload();
  await expect(controls.getByLabel('Sync Frequency', { exact: true })).toBeDisabled();
  await expect(controls.getByLabel('Sync Direction', { exact: true })).toBeDisabled();
  await expect(controls.getByLabel('Auto sync status')).toBeDisabled();
});
