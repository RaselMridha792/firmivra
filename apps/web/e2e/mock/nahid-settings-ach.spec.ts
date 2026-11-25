import { expect, test, type Page } from '@playwright/test';

// #35 Q23 (IP-041), Settings > Payments' ACH bank payments in mock mode (mocks/payments-setup.ts):
// locked until Stripe takes payments and its ACH Direct Debit capability is active; then the
// Owner can turn it on and save. A spec sets the tab's Stripe stage and capability with
// sessionStorage. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const payments = `http://app.localhost:${port}/settings/payments`;

async function open(page: Page, ach: boolean) {
  await page.addInitScript((active) => {
    sessionStorage.setItem('firmivra-mock:payments-stage', 'CONNECTED');
    if (active) sessionStorage.setItem('firmivra-mock:ach', 'active');
  }, ach);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(payments);
  const accepted = page.getByTestId('accepted-payments');
  await expect(accepted.getByRole('switch', { name: 'Credit / debit cards' })).toBeEnabled({
    timeout: 60_000,
  });
  return accepted;
}

test('Stripe ACH not active: the switch is locked and says how to get it', async ({ page }) => {
  const accepted = await open(page, false);
  const ach = accepted.getByTestId('method-ach');
  await expect(ach.getByRole('switch', { name: 'ACH bank payments' })).toBeDisabled();
  await expect(ach).toContainText('Bank payments need ACH Direct Debit turned on for your Stripe');
});

test('Stripe ACH active: the Owner turns bank payments on and saves', async ({ page }, info) => {
  const accepted = await open(page, true);
  const ach = accepted.getByTestId('method-ach');
  const toggle = ach.getByRole('switch', { name: 'ACH bank payments' });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await expect(ach).toContainText('Clients verify their bank instantly');
  await toggle.click();
  await accepted.getByRole('button', { name: 'Save Changes' }).click();
  await expect(accepted.getByRole('status')).toBeVisible();
  await expect(toggle).toBeChecked();
  await accepted.screenshot({ path: info.outputPath('ach-on.png') });
});
