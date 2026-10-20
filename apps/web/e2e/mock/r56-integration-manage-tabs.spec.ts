import { expect, test, type Page, type Route } from '@playwright/test';
import {
  CUSTOM_INTEGRATION_ID,
  customConfigFixture,
  customConnectionFixture,
  customEventsFixture,
  healthFixture,
  historyFixture,
  MANAGE_INTEGRATION_ID,
  manageTabsConnection,
  mappingsFixture,
  permissionsFixture,
  runFixture,
} from '../../src/mocks/integrations-manage-tabs';

// R56: the Manage Integration tabs after Overview (Sync Settings, Data Mapping, Permissions, Sync
// History, Troubleshooting) and the Custom API & Webhooks setup. The firm API is answered with
// synthetic contract fixtures through request interception, as Ibrahim's Overview spec does.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/integrations/${MANAGE_INTEGRATION_ID}`;
type State = 'data' | 'attention' | 'empty' | 'offline';

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

async function serve(page: Page, state: State = 'data') {
  const sent: Sent[] = [];
  const handle = async (route: Route) => {
    if (state === 'offline') return route.abort('connectionfailed');
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/business/integrations', '');
    const method = request.method();
    if (method !== 'GET') sent.push({ method, path, body: request.postDataJSON() as unknown });
    const tail = path.replace(/^\/connections\/[^/]+/, '');
    const custom = path.includes(CUSTOM_INTEGRATION_ID);
    const empty = state === 'empty';
    const json = (() => {
      if (path === '/custom-events') return customEventsFixture();
      if (tail === '' || tail === '/settings')
        return custom
          ? customConnectionFixture()
          : manageTabsConnection(state === 'attention' ? 'attention' : 'data');
      if (tail === '/mappings')
        return method === 'PUT' ? mappingsFixture() : mappingsFixture(empty);
      if (tail === '/permissions')
        return permissionsFixture(state === 'attention' ? 'attention' : empty ? 'empty' : 'data');
      if (tail === '/history') return historyFixture(url.searchParams, empty);
      if (tail.startsWith('/history/')) return runFixture(tail.split('/').pop() ?? '');
      if (tail === '/health')
        return healthFixture(state === 'attention' ? 'attention' : empty ? 'empty' : 'data');
      if (tail === '/test')
        return { ...healthFixture('data'), runId: '77777777-7777-4777-8777-777777777777' };
      if (tail === '/reconnect')
        return { mode: 'REDIRECT', url: 'https://provider.example.test/authorize' };
      if (tail === '/custom') return customConfigFixture();
      if (tail === '/custom/secret') return { ...customConfigFixture(), secretLast4: 'a1b2' };
      if (tail === '/custom/test')
        return {
          ok: true,
          statusCode: 200,
          durationMs: 184,
          message: 'The endpoint accepted the test event.',
          runId: '88888888-8888-4888-8888-888888888888',
        };
      return manageTabsConnection();
    })();
    return route.fulfill({ json });
  };
  await page.route('**/api/v1/business/integrations/**', handle);
  return sent;
}

async function open(page: Page, path: string) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(path);
}

test('every tab keeps the header and the six tabs, and marks its own', async ({ page }) => {
  await serve(page);
  for (const [suffix, label] of [
    ['/sync-settings', 'Sync Settings'],
    ['/data-mapping', 'Data Mapping'],
    ['/permissions', 'Permissions'],
    ['/sync-history', 'Sync History'],
    ['/troubleshooting', 'Troubleshooting'],
  ] as const) {
    await open(page, `${base}${suffix}`);
    await expect(page.getByRole('heading', { name: 'QuickBooks Online' })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Integration management' });
    await expect(tabs.getByRole('link')).toHaveCount(6);
    await expect(tabs.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  }
});

test('sync settings send only what changed and keep unsupported directions out', async ({
  page,
}) => {
  const sent = await serve(page);
  await open(page, `${base}/sync-settings`);
  const save = page.getByRole('button', { name: 'Save Sync Settings' });
  await expect(save).toBeDisabled();
  // Chart of Accounts is import-only, so two-way is not for every selected object.
  await page.getByLabel('Chart of Accounts').check();
  await expect(page.getByLabel('Sync direction')).toContainText('not for every selected object');
  await save.click();
  await expect(page.getByText(/is not supported by every selected object/)).toBeVisible();
  expect(sent).toHaveLength(0);
  await page.getByLabel('Sync direction').selectOption('IMPORT');
  await page.getByLabel('Sync frequency').selectOption('30');
  await page.getByRole('switch', { name: 'Create clients that do not exist yet' }).click();
  await save.click();
  await expect(page.getByText('Sync settings saved.')).toBeVisible();
  const patch = sent.find((s) => s.method === 'PATCH');
  expect(patch?.path).toBe(`/connections/${MANAGE_INTEGRATION_ID}/settings`);
  expect(patch?.body).toEqual({
    syncEveryMinutes: 30,
    direction: 'IMPORT',
    entities: expect.arrayContaining(['chart_of_accounts']),
    options: { create_missing_clients: false, income_account: 'services', classes: ['tax'] },
  });
});

test('data mapping saves a scope from the provider field lists', async ({ page }) => {
  const sent = await serve(page);
  await open(page, `${base}/data-mapping`);
  const clients = page.getByTestId('mapping-scope').filter({ hasText: 'Client fields' });
  await expect(clients).toContainText('3 fields mapped');
  await expect(clients.getByRole('row')).toHaveCount(4);
  await clients.getByRole('button', { name: 'Configure Mapping' }).click();
  await clients.getByRole('button', { name: 'Add Field' }).click();
  await clients.getByRole('button', { name: 'Save Mapping' }).click();
  await expect(clients.getByText('Choose both fields on every row')).toBeVisible();
  const last = clients.getByLabel('LVP Pro field').last();
  await last.selectOption('billing_address');
  await clients.getByLabel('Provider field').last().selectOption('bill_addr');
  await clients.getByRole('button', { name: 'Save Mapping' }).click();
  const put = sent.find((s) => s.method === 'PUT');
  expect(put?.body).toEqual({
    scope: 'client',
    pairs: [
      { localField: 'client_name', externalField: 'customer_name', direction: 'TWO_WAY' },
      { localField: 'email', externalField: 'primary_email', direction: 'TWO_WAY' },
      { localField: 'phone', externalField: 'primary_phone', direction: 'TWO_WAY' },
      { localField: 'billing_address', externalField: 'bill_addr', direction: 'TWO_WAY' },
    ],
  });
});

test('permissions show what is missing and Reconnect goes to the provider', async ({ page }) => {
  await serve(page, 'attention');
  await page.route('https://provider.example.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Provider sign-in</h1>' }),
  );
  await open(page, `${base}/permissions`);
  const list = page.getByTestId('permission-list');
  await expect(list.getByRole('listitem').filter({ hasText: 'payments' })).toContainText('Missing');
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await list.getByRole('button', { name: 'Reconnect' }).click();
  await expect(page).toHaveURL('https://provider.example.test/authorize');
});

test('sync history filters, pages and opens a failed run with guidance', async ({ page }) => {
  await serve(page);
  await open(page, `${base}/sync-history`);
  const history = page.getByTestId('sync-history');
  await expect(history.getByRole('row')).toHaveCount(21);
  await expect(page.getByText('Showing 1 – 20 of 30 runs')).toBeVisible();
  await history.getByLabel('Result').selectOption('FAILED');
  await expect(history.getByRole('row')).toHaveCount(6);
  await history.getByRole('button', { name: 'View Vendors run' }).first().click();
  const detail = page.getByTestId('run-detail');
  await expect(detail).toContainText('The provider rejected two vendor records.');
  await expect(detail).toContainText('What to do');
});

test('troubleshooting runs a test and links the failed runs', async ({ page }) => {
  const sent = await serve(page, 'attention');
  await open(page, `${base}/troubleshooting`);
  await expect(page.getByTestId('health-checks')).toContainText('Payments permission missing');
  await expect(page.getByTestId('health-suggestions')).toContainText('Reconnect to grant');
  await page.getByRole('button', { name: 'Run Connection Test' }).click();
  await expect(page.getByTestId('health-checks')).toContainText('Permissions granted');
  expect(sent.some((s) => s.path.endsWith('/test'))).toBe(true);
  await page.getByRole('link', { name: 'View failed runs' }).click();
  await expect(page).toHaveURL(/sync-history\?status=FAILED$/);
  await expect(page.getByTestId('sync-history').getByLabel('Result')).toHaveValue('FAILED');
});

test('the custom API setup saves, rotates a write-only secret and sends a test', async ({
  page,
}) => {
  const sent = await serve(page);
  await open(
    page,
    `http://app.localhost:${port}/integrations/${CUSTOM_INTEGRATION_ID}/sync-settings`,
  );
  const setup = page.getByTestId('custom-setup');
  await expect(setup.getByLabel('Endpoint URL (https)')).toHaveValue(
    'https://hooks.example.test/lvp',
  );
  await expect(setup).toContainText('ends in 9f2c');
  await setup.getByLabel('Endpoint URL (https)').fill('http://hooks.example.test/lvp');
  await setup.getByRole('button', { name: 'Save Custom Connection' }).click();
  await expect(setup.getByText('The endpoint must be an https address.')).toBeVisible();
  await setup.getByLabel('Endpoint URL (https)').fill('https://hooks.example.test/v2');
  await setup.getByLabel('Appointment booked (Appointments)').check();
  await setup.getByRole('button', { name: 'Save Custom Connection' }).click();
  expect(sent.find((s) => s.path.endsWith('/custom'))?.body).toEqual({
    endpointUrl: 'https://hooks.example.test/v2',
    events: ['client.created', 'invoice.paid', 'appointment.booked'],
  });
  await setup.getByLabel('New secret (write-only)').fill('synthetic-secret-value-123');
  await setup.getByRole('button', { name: 'Rotate Secret' }).click();
  await expect(setup.getByText(/It ends in a1b2; it is not shown again/)).toBeVisible();
  await expect(setup.getByLabel('New secret (write-only)')).toHaveValue('');
  await setup.getByRole('button', { name: 'Send Test Event' }).click();
  await expect(
    setup.getByText('The endpoint accepted the test event. (HTTP 200, 184 ms)'),
  ).toBeVisible();
});

for (const state of ['empty', 'offline'] as const)
  test(`the tabs keep their frames when ${state}`, async ({ page }) => {
    await serve(page, state);
    for (const [suffix, ids] of [
      ['/sync-settings', ['sync-schedule', 'sync-objects', 'provider-options']],
      ['/data-mapping', ['mapping-scope']],
      ['/permissions', ['permission-list', 'permission-notes']],
      ['/sync-history', ['sync-history']],
      ['/troubleshooting', ['health-checks', 'health-suggestions', 'quick-fixes']],
    ] as const) {
      await open(page, `${base}${suffix}`);
      await expect(page.getByTestId('integration-header')).toBeVisible();
      for (const id of ids) await expect(page.getByTestId(id).first()).toBeVisible();
    }
  });

test('the tabs fit a phone without sideways scrolling', async ({ page }) => {
  await serve(page);
  await page.setViewportSize({ width: 375, height: 800 });
  for (const suffix of [
    '/sync-settings',
    '/data-mapping',
    '/permissions',
    '/sync-history',
    '/troubleshooting',
  ]) {
    await page.goto(`${base}${suffix}`);
    await expect(page.getByTestId('integration-header')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
