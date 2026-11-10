import { expect, test, type Page } from '@playwright/test';

// R60, the tax return's Confirm buttons for R55's Manual Event Confirmation (AU-F31, #1264): a
// filed return records the authority's acceptance or rejection once for its tax year, while the
// firm has the switch on. It records the fact only; the return's status stays. Mock mode as the
// Owner (the mock keeps state until a full reload, so the steps navigate in the app).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const shots = 'e2e/screenshots/r60-tax-returns-confirm';

test.describe.configure({ timeout: 180_000 });

/** The first return in this status, on its E-File tab, reached from the sidebar. */
async function openFiled(page: Page, status: string) {
  await page.getByRole('link', { name: 'Tax Returns', exact: true }).first().click();
  await page.getByTestId('tr-filters').getByLabel('Status', { exact: true }).selectOption(status);
  await expect(page.getByTestId('return-link').first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('return-link').first().click();
  await expect(page.getByTestId('return-workspace')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'E-File' }).click();
  return page.getByTestId('efile');
}

const offered = (efile: ReturnType<Page['getByTestId']>, event: string) =>
  efile.locator(`[data-testid="confirm-filing"][data-event="${event}"]`);

test('with the switch on, a filed return confirms its acceptance or rejection once', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/automations/logs'));
  await page.getByRole('button', { name: 'View Automation Settings' }).click();
  await page.getByLabel('Manual Event Confirmation').check();
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText(/Settings saved/i)).toBeVisible();

  // Accepted: Confirm Accepted only.
  let efile = await openFiled(page, 'ACCEPTED');
  await expect(offered(efile, 'tax_return.accepted')).toBeVisible();
  await expect(offered(efile, 'tax_return.rejected')).toHaveCount(0);
  await offered(efile, 'tax_return.accepted').click();
  const dialog = page.getByRole('dialog', { name: 'Confirm Accepted' });
  await expect(dialog).toContainText("the authority confirmed this return's acceptance");
  await expect(dialog).toContainText('never files, submits, charges or pays anything');
  await dialog.getByLabel('Reference').fill('ACK-FAKE-0001');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/confirm-dialog.png` });
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toBeHidden();
  const done = efile.locator('[data-testid="filing-confirmed"][data-event="tax_return.accepted"]');
  await expect(done).toContainText('Acceptance confirmed');
  await expect(done).toContainText('(ACK-FAKE-0001)');
  await expect(offered(efile, 'tax_return.accepted')).toHaveCount(0);
  await page.screenshot({ path: `${shots}/accepted.png` });

  // Transmitted, waiting for the answer: either outcome.
  efile = await openFiled(page, 'TRANSMITTED');
  await expect(offered(efile, 'tax_return.accepted')).toBeVisible();
  await expect(offered(efile, 'tax_return.rejected')).toBeVisible();
  await page.screenshot({ path: `${shots}/transmitted.png` });

  // Rejected: Confirm Rejected only.
  efile = await openFiled(page, 'REJECTED');
  await expect(offered(efile, 'tax_return.rejected')).toBeVisible();
  await expect(offered(efile, 'tax_return.accepted')).toHaveCount(0);
});

test('with the switch off (the default), a filed return offers no Confirm', async ({ page }) => {
  await page.goto(app('/tax-returns'));
  const efile = await openFiled(page, 'TRANSMITTED');
  await expect(efile.getByTestId('confirm-filing')).toHaveCount(0);
  await expect(efile.getByTestId('confirm-outcome')).toBeHidden();
});
