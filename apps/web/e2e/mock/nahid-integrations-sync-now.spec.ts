import { expect, test, type Page, type Route } from '@playwright/test';
import { integrationOverviewFixture } from '../../src/mocks/integrations';
import {
  integrationManageFixture,
  MANAGE_INTEGRATION_ID,
} from '../../src/mocks/integrations-manage';
import { historyFixture, manageTabsConnection } from '../../src/mocks/integrations-manage-tabs';

// #29 Integrations: Sync Now says what happened. A provider with nothing to sync (the built-in
// Firmivra Mail, for one) answers 409 NOT_SUPPORTED; the page said "The provider does not support
// that setting." (the header) or "Something went wrong" (the list card) although no setting was
// changed. A sync that starts on the Overview now says so too. Synthetic fixtures only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const manage = `${app}/integrations/${MANAGE_INTEGRATION_ID}`;
const NOTHING = 'QuickBooks Online has nothing to sync, so no sync was started.';

type Sync = 'nothing' | 'started';

const answerSync = (route: Route, sync: Sync) =>
  sync === 'nothing'
    ? route.fulfill({
        status: 409,
        json: {
          error: { code: 'NOT_SUPPORTED', message: 'QuickBooks Online has nothing to sync' },
        },
      })
    : route.fulfill({ json: integrationManageFixture().recentRuns[0] });

async function serveManage(page: Page, sync: Sync) {
  const calls: string[] = [];
  await page.route('**/api/v1/business/integrations/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const tail = url.pathname.replace(/^.*\/connections\/[^/]+/, '');
    if (request.method() === 'POST' && tail === '/sync') {
      calls.push('sync');
      return answerSync(route, sync);
    }
    if (tail === '/history') return route.fulfill({ json: historyFixture(url.searchParams) });
    return route.fulfill({ json: manageTabsConnection() });
  });
  return calls;
}

test('Overview: a provider with nothing to sync says so, not "does not support that setting"', async ({
  page,
}, info) => {
  const calls = await serveManage(page, 'nothing');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(manage);
  await expect(page.getByRole('heading', { name: 'QuickBooks Online' })).toBeVisible();
  await page
    .getByTestId('sync-controls')
    .getByRole('button', { name: 'Sync Now', exact: true })
    .click();
  const alert = page.getByTestId('manage-integration-overview').getByRole('alert');
  await expect(alert).toHaveText(NOTHING);
  await expect(alert).not.toContainText('does not support that setting');
  expect(calls).toEqual(['sync']);
  await page.screenshot({ path: info.outputPath('overview-nothing-to-sync.png') });
});

test('Overview: a sync that starts says so', async ({ page }) => {
  await serveManage(page, 'started');
  await page.goto(manage);
  await expect(page.getByRole('heading', { name: 'QuickBooks Online' })).toBeVisible();
  await page
    .getByTestId('sync-controls')
    .getByRole('button', { name: 'Sync Now', exact: true })
    .click();
  await expect(page.getByTestId('manage-integration-overview').getByRole('status')).toHaveText(
    'Sync started for Invoices. Progress shows in Sync History.',
  );
});

test('a tab header: Sync Now with nothing to sync says so', async ({ page }) => {
  const calls = await serveManage(page, 'nothing');
  await page.goto(`${manage}/sync-history`);
  await expect(page.getByRole('heading', { name: 'QuickBooks Online' })).toBeVisible();
  await page.getByRole('button', { name: 'Sync Now', exact: true }).first().click();
  await expect(page.getByText(NOTHING)).toBeVisible();
  await expect(page.getByText('does not support that setting')).toHaveCount(0);
  expect(calls).toEqual(['sync']);
});

test('the Integrations list card: Sync Now with nothing to sync says so, not "Something went wrong"', async ({
  page,
}, info) => {
  await page.route('**/api/v1/business/integrations**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST' && url.pathname.endsWith('/sync'))
      return answerSync(route, 'nothing');
    const result = integrationOverviewFixture({
      tab: 'all',
      environment: 'LIVE',
      search: '',
    });
    if (url.pathname.endsWith('/activity'))
      return route.fulfill({
        json: { items: result.recent, page: 1, pageSize: 25, total: result.recent.length },
      });
    return route.fulfill({ json: result });
  });
  await page.goto(`${app}/integrations`);
  const card = page
    .getByTestId('integration-card')
    .filter({ has: page.getByRole('heading', { name: 'QuickBooks Online', exact: true }) });
  await card.getByRole('button', { name: 'Sync Now', exact: true }).click();
  await expect(card.getByRole('alert')).toHaveText(NOTHING);
  await card.screenshot({ path: info.outputPath('card-nothing-to-sync.png') });
});
