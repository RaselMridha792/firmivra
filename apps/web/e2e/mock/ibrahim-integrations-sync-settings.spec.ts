import { expect, test, type Page } from '@playwright/test';
import { IntegrationConnectionDetail, UpdateIntegrationSettingsRequest } from '@firmivra/types';
import { SYNC_SETTINGS_ID, syncSettingsFixture } from '../../src/mocks/integrations-sync-settings';

test.use({ viewport: { width: 1440, height: 1100 } });
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const url = `http://app.localhost:${port}/integrations/${SYNC_SETTINGS_ID}/sync-settings`;
type State = 'data' | 'empty' | 'offline' | 'forbidden' | 'readonly' | 'limited';

async function fixture(page: Page, state: State = 'data', failFirstSave = false) {
  let detail = syncSettingsFixture(state === 'empty');
  const changes: UpdateIntegrationSettingsRequest[] = [];
  if (state === 'readonly') detail.canManage = false;
  if (state === 'limited') {
    detail.provider.directions = ['EXPORT', 'TWO_WAY'];
    detail.entities = detail.entities.filter((key) => key !== 'employees');
    const employee = detail.provider.entities.find((entity) => entity.key === 'employees');
    if (employee) employee.directions = ['EXPORT'];
  }
  await page.route(
    `**/api/v1/business/integrations/connections/${SYNC_SETTINGS_ID}**`,
    async (route) => {
      if (state === 'offline') return route.abort('connectionfailed');
      if (state === 'forbidden')
        return route.fulfill({
          status: 403,
          json: { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
        });
      if (route.request().method() === 'GET') return route.fulfill({ json: detail });
      if (route.request().method() === 'PATCH') {
        const change = UpdateIntegrationSettingsRequest.parse(route.request().postDataJSON());
        changes.push(change);
        if (failFirstSave && changes.length === 1)
          return route.fulfill({
            status: 409,
            json: { error: { code: 'NOT_SUPPORTED', message: 'Unsupported settings' } },
          });
        detail = IntegrationConnectionDetail.parse({ ...detail, ...change });
        return route.fulfill({ json: detail });
      }
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/pause') || path.endsWith('/resume')) {
        detail = { ...detail, paused: path.endsWith('/pause') };
        return route.fulfill({ json: { ...detail, provider: detail.provider.provider } });
      }
      return route.fulfill({
        status: 409,
        json: { error: { code: 'SYNC_IN_PROGRESS', message: 'Sync already running' } },
      });
    },
  );
  return changes;
}

async function frames(page: Page) {
  for (const id of ['integration-header', 'sync-settings-controls', 'sync-settings-data'])
    await expect(page.getByTestId(id)).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Integration management' }).getByRole('link'),
  ).toHaveCount(6);
}

test('data frame, current tab and mobile layout', async ({ page }, info) => {
  await fixture(page);
  await page.goto(url);
  await frames(page);
  await expect(page.getByRole('heading', { name: 'QuickBooks Online', exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Integration management' })
      .getByRole('link', { name: 'Sync Settings' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Sync Frequency', { exact: true })).toHaveValue('60');
  await expect(page.getByRole('checkbox')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Save Sync Settings' })).toBeDisabled();
  await page.screenshot({
    path: info.outputPath('sync-settings-data-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 900 });
  await frames(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('sync-settings-data-mobile.png'), fullPage: true });
});

test('save failure preserves changes and retry persists only contract fields', async ({ page }) => {
  const changes = await fixture(page, 'data', true);
  await page.goto(url);
  await page.getByLabel('Sync Frequency', { exact: true }).selectOption('30');
  await page.getByLabel('Sync Direction', { exact: true }).selectOption('IMPORT');
  await page.getByRole('checkbox', { name: 'Employees (if applicable)', exact: true }).uncheck();
  const save = page.getByRole('button', { name: 'Save Sync Settings' });
  await save.click();
  await expect(page.getByTestId('integration-sync-settings').getByRole('alert')).toContainText(
    'These settings are not supported',
  );
  await expect(page.getByLabel('Sync Frequency', { exact: true })).toHaveValue('30');
  await save.click();
  await expect(page.getByText('Sync settings saved.')).toBeVisible();
  await expect(save).toBeDisabled();
  expect(changes).toHaveLength(2);
  expect(changes[1]).toMatchObject({ syncEveryMinutes: 30, direction: 'IMPORT', syncMode: 'AUTO' });
  expect(changes[1]?.entities).not.toContain('employees');
  expect(changes[1]).not.toHaveProperty('businessId');
  await page.reload();
  await expect(page.getByLabel('Sync Frequency', { exact: true })).toHaveValue('30');
});

test('manual mode clears frequency and automatic mode restores a supported frequency', async ({
  page,
}) => {
  const changes = await fixture(page);
  await page.goto(url);
  const toggle = page.getByRole('switch', { name: 'Auto sync', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await page.getByRole('button', { name: 'Save Sync Settings' }).click();
  await expect(page.getByText('Sync settings saved.')).toBeVisible();
  expect(changes[0]).toMatchObject({ syncMode: 'MANUAL', syncEveryMinutes: null });
  await expect(page.getByLabel('Sync Frequency', { exact: true })).toBeDisabled();
  await toggle.click();
  await expect(page.getByLabel('Sync Frequency', { exact: true })).toHaveValue('15');
  await page.getByRole('button', { name: 'Save Sync Settings' }).click();
  await expect.poll(() => changes.length).toBe(2);
  expect(changes[1]).toMatchObject({ syncMode: 'AUTO', syncEveryMinutes: 15 });
});

test('pause/resume refresh preserves unsaved settings and sync failures remain visible', async ({
  page,
}) => {
  await fixture(page);
  await page.goto(url);
  await page.getByLabel('Sync Frequency', { exact: true }).selectOption('30');
  await page.getByRole('button', { name: 'Pause Auto Sync', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume Auto Sync' })).toBeVisible();
  await expect(page.getByText('Automatic sync is paused.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Sync Frequency', { exact: true })).toHaveValue('30');
  await page.getByRole('button', { name: 'Resume Auto Sync' }).click();
  await expect(page.getByRole('button', { name: 'Pause Auto Sync' })).toBeVisible();
  await expect(page.getByLabel('Sync Frequency', { exact: true })).toHaveValue('30');
  await page
    .getByTestId('sync-settings-controls')
    .getByRole('button', { name: 'Sync Now', exact: true })
    .click();
  await expect(page.getByTestId('integration-sync-settings').getByRole('alert')).toBeVisible();
});

test('enabling an object chooses a supported direction rather than assuming IMPORT', async ({
  page,
}) => {
  const changes = await fixture(page, 'limited');
  await page.goto(url);
  await expect(page.getByLabel('Sync Direction', { exact: true })).toHaveValue('TWO_WAY');
  await page.getByRole('checkbox', { name: 'Employees (if applicable)', exact: true }).check();
  await expect(page.getByLabel('Sync Direction', { exact: true })).toHaveValue('EXPORT');
  await expect(
    page.getByLabel('Sync Direction', { exact: true }).locator('option[value="IMPORT"]'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Save Sync Settings' }).click();
  await expect.poll(() => changes.length).toBe(1);
  expect(changes[0]?.direction).toBe('EXPORT');
});

for (const state of ['empty', 'offline', 'forbidden', 'readonly'] as const) {
  test(`${state} preserves widget frames and safe actions`, async ({ page }, info) => {
    await fixture(page, state);
    await page.goto(url);
    await frames(page);
    if (state === 'empty' || state === 'offline' || state === 'forbidden')
      await expect(page.getByText('No sync objects are available.')).toBeVisible();
    if (state === 'offline' || state === 'forbidden')
      await expect(page.getByTestId('sync-settings-error')).toBeVisible();
    if (state !== 'empty') {
      await expect(page.getByRole('button', { name: 'Save Sync Settings' })).toBeDisabled();
      await expect(page.getByLabel('Auto sync', { exact: true })).toBeDisabled();
    }
    if (state === 'readonly')
      await expect(page.getByText('You have read-only access')).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`sync-settings-${state}-desktop.png`),
      fullPage: true,
    });
  });
}
