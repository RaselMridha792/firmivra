import { expect, test } from '@playwright/test';

// R55, Client Portal guide 7.5 and 9.2 (Rasel, Oct 24: the parts without schema): a client's
// email notices are always on, and a Text box is their opt-in, so the card says what they agree
// to. In mock mode (playwright.mock.config.ts): Jamie Sample has a phone, so texts are offered.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const shots = 'e2e/mock/r55-screenshots/portal';

test('email is locked on for every category, and the Text boxes carry the opt-in wording', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://portal.localhost:${port}/lvp/profile`);
  await page.getByText('Notification Preferences', { exact: true }).click();
  for (const category of ['Documents', 'Invoices and payments', 'Messages and notes']) {
    const email = page.getByLabel(`${category} by email`);
    await expect(email).toBeChecked();
    await expect(email).toBeDisabled();
    await expect(page.getByLabel(`${category} by text`)).toBeEnabled();
  }
  await expect(page.getByText('Email is always on')).toBeVisible();
  const consent = page.getByTestId('sms-consent');
  await expect(consent).toContainText('you agree to receive notification texts from LVP');
  await expect(consent).toContainText('Reply STOP to stop');
  await expect(page.getByTestId('sms-stopped')).toHaveCount(0);

  await page.getByLabel('Invoices and payments by text').click();
  await expect(page.getByLabel('Invoices and payments by text')).toBeChecked();
  await consent.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/notification-preferences.png` });
});
