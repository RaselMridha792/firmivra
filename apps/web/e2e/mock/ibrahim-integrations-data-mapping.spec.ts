import { expect, test, type Page } from '@playwright/test';
import { SaveIntegrationMappingsRequest } from '@firmivra/types';
import {
  DATA_MAPPING_ID,
  mappingConnectionFixture,
  mappingFieldsFixture,
} from '../../src/mocks/integrations-data-mapping';

test.use({ viewport: { width: 1440, height: 1100 } });
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const url = `http://app.localhost:${port}/integrations/${DATA_MAPPING_ID}/data-mapping`;
type State =
  | 'data'
  | 'empty'
  | 'offline'
  | 'forbidden'
  | 'readonly'
  | 'partial'
  | 'legacy'
  | 'limited'
  | 'unmapped'
  | 'no-directions';
async function fixture(page: Page, state: State = 'data', failFirst = false) {
  const detail = mappingConnectionFixture();
  const fields = mappingFieldsFixture(state === 'empty');
  const changes: SaveIntegrationMappingsRequest[] = [];
  if (state === 'readonly') detail.canManage = false;
  if (state === 'limited') detail.provider.directions = ['IMPORT'];
  if (state === 'no-directions') detail.provider.directions = [];
  if (state === 'unmapped')
    fields.scopes.forEach((scope) => {
      scope.pairs = [];
    });
  if (state === 'legacy')
    fields.scopes[0]?.pairs.push({
      scope: 'client',
      localField: 'legacy',
      localLabel: 'Legacy Field',
      externalField: 'legacy_provider',
      externalLabel: 'Legacy Provider Field',
      direction: 'TWO_WAY',
    });
  await page.route(
    `**/api/v1/business/integrations/connections/${DATA_MAPPING_ID}**`,
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (state === 'offline' || (state === 'partial' && path.endsWith('/mappings')))
        return route.abort('connectionfailed');
      if (state === 'forbidden')
        return route.fulfill({
          status: 403,
          json: { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
        });
      if (route.request().method() === 'GET')
        return route.fulfill({ json: path.endsWith('/mappings') ? fields : detail });
      if (route.request().method() === 'PUT') {
        const body = SaveIntegrationMappingsRequest.parse(route.request().postDataJSON());
        changes.push(body);
        if (failFirst && changes.length === 1)
          return route.fulfill({
            status: 409,
            json: { error: { code: 'INVALID_CONFIGURATION', message: 'Unsupported mapping' } },
          });
        const scope = fields.scopes.find((item) => item.scope === body.scope);
        if (!scope) throw new Error('Unexpected scope');
        scope.pairs = body.pairs.map((pair) => ({
          ...pair,
          scope: scope.scope,
          direction: pair.direction ?? 'TWO_WAY',
          localLabel: scope.localFields.find((field) => field.key === pair.localField)?.label ?? '',
          externalLabel:
            scope.externalFields.find((field) => field.key === pair.externalField)?.label ?? '',
        }));
        return route.fulfill({ json: fields });
      }
      return route.fulfill({
        status: 409,
        json: { error: { code: 'SYNC_IN_PROGRESS', message: 'Already syncing' } },
      });
    },
  );
  return { changes, fields, detail };
}
const card = (page: Page, label = 'Clients') =>
  page
    .getByTestId('mapping-scope')
    .filter({ has: page.getByRole('heading', { name: label, exact: true }) });
async function configure(page: Page, label = 'Clients') {
  await card(page, label).getByRole('button', { name: 'Configure Mapping' }).click();
}
async function addEmail(page: Page) {
  const scope = card(page);
  await scope.getByRole('button', { name: 'Add Field' }).click();
  await scope.getByLabel('LVP Pro field', { exact: true }).last().selectOption('email');
  await scope.getByLabel('Provider field', { exact: true }).last().selectOption('email_address');
}
async function frames(page: Page) {
  await expect(page.getByTestId('integration-header')).toBeVisible();
  await expect(page.getByTestId('mapping-scope').first()).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Integration management' }).getByRole('link'),
  ).toHaveCount(6);
}

test('Manage header, all scope cards and responsive layout', async ({ page }, info) => {
  await fixture(page);
  await page.goto(url);
  await frames(page);
  await expect(page.getByTestId('mapping-scope')).toHaveCount(5);
  await expect(card(page)).toContainText('Customer Name');
  await expect(
    page
      .getByRole('navigation', { name: 'Integration management' })
      .getByRole('link', { name: 'Data Mapping' }),
  ).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: info.outputPath('data-mapping-data-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await frames(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('data-mapping-data-mobile.png'), fullPage: true });
});

test('save retry preserves edits and only updates the selected scope', async ({ page }) => {
  const { changes, fields } = await fixture(page, 'data', true);
  await page.goto(url);
  await configure(page);
  await addEmail(page);
  await configure(page, 'Invoices');
  await card(page, 'Invoices')
    .getByLabel('Provider field', { exact: true })
    .last()
    .selectOption('doc_number');
  const save = card(page).getByRole('button', { name: 'Save Mapping' });
  await save.click();
  await expect(card(page).getByRole('alert')).toContainText('not offered by the provider');
  await expect(card(page).getByLabel('Provider field', { exact: true }).last()).toHaveValue(
    'email_address',
  );
  await save.click();
  await expect(card(page).getByRole('status')).toContainText('Mapping saved.');
  expect(changes).toHaveLength(2);
  expect(changes[1]?.scope).toBe('client');
  expect(changes[1]?.pairs).toHaveLength(2);
  expect(changes[1]).not.toHaveProperty('businessId');
  expect(
    fields.scopes
      .find((scope) => scope.scope === 'invoice')
      ?.pairs.find((pair) => pair.localField === 'amount')?.externalField,
  ).toBe('total_amount');
  await expect(
    card(page, 'Invoices').getByLabel('Provider field', { exact: true }).last(),
  ).toHaveValue('doc_number');
  await page.reload();
  await expect(card(page)).toContainText('Email Address');
});

test('removing all rows clears one scope and preserves the others', async ({ page }) => {
  const { changes, fields } = await fixture(page);
  await page.goto(url);
  await configure(page);
  await card(page).getByRole('button', { name: 'Remove row 1' }).click();
  await card(page).getByRole('button', { name: 'Save Mapping' }).click();
  await expect(card(page).getByRole('status')).toContainText('Mapping saved.');
  expect(changes[0]).toEqual({ scope: 'client', pairs: [] });
  expect(fields.scopes.find((scope) => scope.scope === 'invoice')?.pairs).toHaveLength(3);
});

test('orphan mappings are preserved until explicitly removed', async ({ page }) => {
  const { changes } = await fixture(page, 'legacy');
  await page.goto(url);
  await configure(page);
  await expect(card(page).getByLabel('LVP Pro field', { exact: true }).last()).toHaveValue(
    'legacy',
  );
  await card(page).getByRole('button', { name: 'Save Mapping' }).click();
  await expect(card(page).getByRole('alert')).toContainText('no longer supported');
  expect(changes).toHaveLength(0);
  await card(page).getByRole('button', { name: 'Remove row 2' }).click();
  await card(page).getByRole('button', { name: 'Save Mapping' }).click();
  await expect(card(page).getByRole('status')).toContainText('Mapping saved.');
  expect(changes[0]?.pairs).toHaveLength(1);
});

test('directions come from the provider and new rows use a supported default', async ({ page }) => {
  const { changes } = await fixture(page, 'limited');
  await page.goto(url);
  await configure(page);
  await card(page).getByLabel('Direction', { exact: true }).first().selectOption('IMPORT');
  await addEmail(page);
  await expect(card(page).getByLabel('Direction', { exact: true }).last()).toHaveValue('IMPORT');
  await card(page).getByRole('button', { name: 'Save Mapping' }).click();
  await expect.poll(() => changes.length).toBe(1);
  expect(changes[0]?.pairs.every((pair) => pair.direction === 'IMPORT')).toBe(true);
});

test('empty saved mappings retain Configure Mapping and provider fields', async ({ page }) => {
  await fixture(page, 'unmapped');
  await page.goto(url);
  await configure(page);
  await addEmail(page);
  await expect(card(page).getByLabel('Provider field', { exact: true })).toHaveValue(
    'email_address',
  );
});

test('no supported direction still permits explicit clearing', async ({ page }) => {
  const { changes } = await fixture(page, 'no-directions');
  await page.goto(url);
  await configure(page);
  await expect(card(page).getByRole('button', { name: 'Add Field' })).toBeDisabled();
  await card(page).getByRole('button', { name: 'Remove row 1' }).click();
  await card(page).getByRole('button', { name: 'Save Mapping' }).click();
  await expect.poll(() => changes.length).toBe(1);
  expect(changes[0]).toEqual({ scope: 'client', pairs: [] });
});

for (const state of ['empty', 'offline', 'partial', 'forbidden', 'readonly'] as const) {
  test(`${state} keeps the Manage frame and safe mapping actions`, async ({ page }, info) => {
    await fixture(page, state);
    await page.goto(url);
    await frames(page);
    if (state === 'readonly')
      await expect(card(page).getByRole('button', { name: 'Configure Mapping' })).toBeDisabled();
    else if (state === 'empty')
      await expect(page.getByText('This provider has no fields to map.')).toBeVisible();
    else await expect(page.getByTestId('mapping-scope').getByRole('alert')).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`data-mapping-${state}-desktop.png`),
      fullPage: true,
    });
  });
}
