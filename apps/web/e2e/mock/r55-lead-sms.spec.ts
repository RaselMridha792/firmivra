import { expect, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) item 9 (CHANGE-LIST L2): Send SMS shows each recipient's
// saved number before sending, and says what happened after, for one lead and for selected
// leads, in mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/leads`;

test('one lead from its row: the saved number, then the result', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const table = page.getByRole('table', { name: 'Leads' });
  await table.getByRole('button', { name: 'Send SMS to Bruno Sandoval' }).click();
  const dialog = page.getByTestId('lead-message-sms');
  await expect(dialog.getByTestId('message-recipients')).toContainText('Bruno Sandoval');
  await expect(dialog.getByTestId('message-recipients')).toContainText('(555) 030-1003');
  await dialog.getByLabel('Message').fill('Your appointment is confirmed.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByTestId('message-result')).toHaveText('Text sent to 1 lead.');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
});

test('selected leads: every number listed, then how many went', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const table = page.getByRole('table', { name: 'Leads' });
  for (const name of ['Bruno Sandoval', 'Selma Shields'])
    await table
      .getByRole('row', { name: new RegExp(name) })
      .getByRole('checkbox')
      .check();
  await page.getByRole('button', { name: 'Send SMS' }).first().click();
  const list = page.getByTestId('lead-message-sms').getByTestId('message-recipients');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('(555) 030-1004');
  await page.getByTestId('lead-message-sms').getByLabel('Message').fill('Office closed Friday.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('message-result')).toHaveText('Text sent to 2 leads.');
});

test('the lead page’s SMS button shows the same composer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${url}/0199c0c0-0a00-7000-8000-000000000003/notes`);
  await expect(page.getByTestId('lead-name')).toHaveText('Bruno Sandoval');
  await page
    .getByRole('group', { name: 'Lead actions' })
    .getByRole('button', { name: 'SMS' })
    .click();
  await expect(page.getByTestId('message-recipients')).toContainText('(555) 030-1003');
});
