import { expect, test } from '@playwright/test';

// R55, Octavia's Super Admin review of Oct 31 (SA-COM): New Message asks before unsaved edits are
// lost (R5). Mock mode; 1440 px.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

test('New Message: Cancel with unsaved edits asks Discard or Keep editing; nothing is sent (SA-COM-R5)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Nothing typed: Cancel leaves at once.
  await page.goto(admin('/communications/new'));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/\/communications$/);

  await page.goto(admin('/communications/new'));
  await page.getByRole('textbox', { name: 'Message body' }).click();
  await page.keyboard.type('Hello from the platform (synthetic).');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'Discard this message?' });
  await expect(ask).toBeVisible();
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/super-admin/message-discard.png' });
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('textbox', { name: 'Message body' })).toContainText(
    'Hello from the platform',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Discard this message?' })
    .getByRole('button', { name: 'Discard' })
    .click();
  await expect(page).toHaveURL(/\/communications$/);
});

test('firm-scoped links open Support and Billing for that one firm, in Super Admin (SA-RPT-R4, R5)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Support: the firm from the address is the Firm filter, shown as a chip.
  await page.goto(admin('/support'));
  await page.getByRole('button', { name: /^Filters/ }).click();
  const firmSelect = page.getByLabel('Firm', { exact: true });
  const firm = await firmSelect.locator('option').nth(1).getAttribute('value');
  const firmName = (await firmSelect.locator('option').nth(1).textContent())?.trim() ?? '';
  expect(firm).toMatch(/^[0-9a-f-]{36}$/);
  await page.goto(admin(`/support?firm=${firm}`));
  await expect(page.getByTestId('active-filters')).toContainText(`Firm: ${firmName}`);
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/super-admin/support-for-firm.png' });

  // Billing: the firm from the address is the firm picker's choice.
  await page.goto(admin('/billing'));
  const picker = page.getByRole('combobox', { name: /Firm/ }).first();
  const billingFirm = await picker.locator('option').nth(1).getAttribute('value');
  await page.goto(admin(`/billing?firm=${billingFirm}`));
  await expect(page.getByRole('combobox', { name: /Firm/ }).first()).toHaveValue(billingFirm ?? '');
});
