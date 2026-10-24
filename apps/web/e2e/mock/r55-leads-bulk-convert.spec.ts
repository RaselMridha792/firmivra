import { expect, type Page, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) L12: Convert to Client in the bulk bar, as her written spec
// lists it (Rasel, Oct 24). Each lead becomes a client from its own record, or is listed with the
// reason it was left. In mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/leads`;
const shots = 'e2e/mock/r55-screenshots/leads';

const table = (page: Page) => page.getByRole('table', { name: 'Leads' });
const row = (page: Page, name: string) => table(page).getByRole('row', { name: new RegExp(name) });

test('converts the selected leads from their records and says what happened to each', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  for (const name of ['Bruno Sandoval', 'Selma Shields'])
    await row(page, name).getByRole('checkbox').check();
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' }).first();
  // Her spec's order: Email, SMS, staff, status, campaign, tags, convert, delete.
  await expect(bar.getByRole('button')).toHaveText([
    'Send Email',
    'Send SMS',
    'Assign Staff',
    'Change Status',
    'Add to Campaign',
    'Add Tags',
    'Convert to Client',
    'Delete',
  ]);
  await bar.getByRole('button', { name: 'Convert to Client' }).click();
  const dialog = page.getByRole('dialog', { name: 'Convert to Client' });
  await expect(dialog).toContainText('2 leads selected');
  await expect(dialog.getByLabel('Primary staff')).toHaveValue('');
  await expect(dialog.getByLabel('Send each new client a portal invitation now')).not.toBeChecked();
  await page.screenshot({ path: `${shots}/bulk-convert-dialog.png` });
  await dialog.getByRole('button', { name: 'Convert 2 leads' }).click();

  const result = dialog.getByTestId('bulk-convert-result');
  await expect(result.getByRole('status')).toBeVisible();
  const converted = await result
    .getByRole('list', { name: 'Converted' })
    .getByRole('listitem')
    .count()
    .catch(() => 0);
  const left = await result
    .getByRole('list', { name: 'Left as leads' })
    .getByRole('listitem')
    .count()
    .catch(() => 0);
  expect(converted + left).toBe(2);
  if (converted)
    await expect(
      result.getByRole('list', { name: 'Converted' }).getByRole('link').first(),
    ).toHaveAttribute('href', /^\/clients\//);
  await page.screenshot({ path: `${shots}/bulk-convert-result.png` });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Bulk actions' }).first()).toContainText(
    '0 leads selected',
  );
  if (converted) await expect(table(page)).toContainText('Converted');
});
