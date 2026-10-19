import { expect, test } from '@playwright/test';

const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const url = `http://admin.localhost:${port}/communications/broadcasts/new`;
const screenshotDir = 'e2e/screenshots/arfan-create-broadcast';
const draftKey = 'firmivra.broadcast.basic-information';
const modules = (process.env['PLAYWRIGHT_API_MOCK'] ?? 'all').split(',');
const emptyModules = (process.env['PLAYWRIGHT_API_MOCK_EMPTY'] ?? '').split(',');
const unavailable = !modules.includes('all') && !modules.includes('adminCommunications');
const empty = emptyModules.includes('all') || emptyModules.includes('adminCommunications');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto(url);
  await expect(page).toHaveTitle('Create broadcast: Basic information');
});

test('keeps the design frame in data, empty and unavailable states at desktop, tablet and mobile widths', async ({
  page,
}) => {
  if (unavailable) await expect(page.getByTestId('page-error')).toBeVisible();
  else if (empty) await expect(page.getByTestId('page-empty')).toBeVisible();
  else await expect(page.getByLabel('Category (Optional)')).toBeEnabled();

  await expect(
    page.getByRole('list', { name: 'Broadcast progress' }).getByRole('listitem'),
  ).toHaveCount(4);
  await expect(page.getByRole('heading', { name: 'Basic Information', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Broadcast Summary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Need Help?' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Email', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'SMS', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'In-App', exact: true })).toBeChecked();
  await page.addStyleTag({
    content: '[data-testid="mock-badge"], nextjs-portal { display: none !important; }',
  });
  const state = unavailable ? 'api-unavailable' : empty ? 'empty' : 'data';
  for (const width of unavailable || empty ? [1440, 375] : [1536, 1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save as Draft' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `${screenshotDir}/${state}-${width}.png`, fullPage: true });
  }
  if (unavailable || empty) {
    await expect(page.getByLabel('Category (Optional)')).toBeDisabled();
    await expect(page.getByLabel('Broadcast Name', { exact: true })).toBeEnabled();
  }
});

test('requires a nonblank name and a channel; All Channels allows individual deselection', async ({
  page,
}) => {
  await page.getByLabel('Broadcast Name', { exact: true }).fill('   ');
  await page.getByRole('switch', { name: 'Select All' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Enter a broadcast name.')).toBeVisible();
  await expect(page.getByText('Select at least one channel.')).toBeVisible();
  await expect(page).toHaveURL(url);
  await page.getByRole('checkbox', { name: 'All Channels', exact: true }).check();
  await page.getByRole('checkbox', { name: 'SMS', exact: true }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Email', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'In-App', exact: true })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Select All' })).not.toBeChecked();
  await expect(page.getByText('Select at least one channel.')).not.toBeVisible();
});

test('updates the summary, previews templates and carries the draft to Audience and back', async ({
  page,
}) => {
  test.skip(unavailable || empty, 'This interaction uses the populated display fixtures.');
  await page.getByLabel('Broadcast Name', { exact: true }).fill('October product update');
  await page.getByLabel('Description (Optional)').fill('News for the sample workspace.');
  await page.getByLabel('Category (Optional)').selectOption('system-notices');
  await page.getByRole('checkbox', { name: 'SMS', exact: true }).uncheck();
  await expect(page.getByTestId('broadcast-summary')).toContainText('October product update');
  await expect(page.getByTestId('broadcast-summary')).toContainText('Email, In-App');
  await expect(page.getByTestId('broadcast-summary')).toContainText('System Notices');
  await page.getByRole('button', { name: 'Browse Templates' }).click();
  await page.getByRole('button', { name: 'Monthly Newsletter', exact: true }).click();
  await page.getByRole('button', { name: 'Preview Template' }).click();
  await expect(page.getByRole('dialog')).toContainText('Your monthly Firmivra update');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByText('Draft saved in this tab.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Broadcast Name', { exact: true })).toHaveValue(
    'October product update',
  );
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(`${url}/audience`);
  const draft = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, unknown>,
    draftKey,
  );
  expect(draft).toMatchObject({
    name: 'October product update',
    description: 'News for the sample workspace.',
    channels: ['EMAIL', 'IN_APP'],
    category: 'system-notices',
    templateId: 'sample-newsletter',
  });
  await page.goBack();
  await expect(page.getByLabel('Broadcast Name', { exact: true })).toHaveValue(
    'October product update',
  );
  await page.getByRole('link', { name: 'Cancel and back to broadcasts' }).click();
  await expect(page).toHaveURL(`http://admin.localhost:${port}/communications/broadcasts`);
});
