import { expect, test } from '@playwright/test';

// R55, Client Portal guide 5 and 7.2 (Rasel, Oct 24: the parts without schema): the firm turns
// portal tabs on and off in Settings > Client Portal, with a warning first; the portal's menu,
// folder tabs and quick links leave a hidden tab, and its page says so even by its address.
// In mock mode (playwright.mock.config.ts) as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const shots = 'e2e/mock/r55-screenshots/portal';

test('Settings > Client Portal turns a tab off after a warning, and Cancel restores', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/portal`);
  await expect(page.getByText('Turning portal features on and off')).toHaveCount(0);
  const table = page.getByRole('table', { name: 'Default portal tabs' });
  await expect(table.getByRole('row')).toHaveCount(7);
  await expect(table.getByRole('row', { name: /Business Documents & Resources/ })).toContainText(
    'Always shown',
  );
  const save = page.getByRole('button', { name: 'Save changes' }).last();
  await expect(save).toBeDisabled();

  await table.getByRole('switch', { name: 'Show Tax Returns' }).click();
  const dialog = page.getByRole('dialog', { name: 'Turn off Tax Returns?' });
  await expect(dialog).toContainText('Nothing is deleted');
  await dialog.getByRole('button', { name: 'Keep it on' }).click();
  await expect(table.getByRole('switch', { name: 'Show Tax Returns' })).toBeChecked();

  await table.getByRole('switch', { name: 'Show Messages and Notes' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Turn off' }).click();
  await expect(table.getByRole('switch', { name: 'Show Messages and Notes' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(table.getByRole('switch', { name: 'Show Messages and Notes' })).toBeChecked();

  await table.getByRole('switch', { name: 'Show Tax Returns' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Turn off' }).click();
  await save.click();
  await expect(page.getByText('Changes saved.').last()).toBeVisible();
  await expect(table.getByRole('switch', { name: 'Show Tax Returns' })).not.toBeChecked();
  await page.getByRole('heading', { name: 'Portal Features' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/features-settings.png` });
});

test('the portal hides a tab that is off, and its page says so by address', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'firmivra-mock:portal-tabs',
      JSON.stringify({ MESSAGES: false, TAX_RETURNS: false }),
    );
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://portal.localhost:${port}/lvp/documents`);
  const folders = page.getByRole('navigation', { name: 'Portal folders' });
  await expect(folders.getByRole('link', { name: 'Receipts & Invoices' })).toBeVisible();
  await expect(folders.getByRole('link', { name: 'Tax Returns' })).toHaveCount(0);
  await expect(folders.getByRole('link', { name: 'Messages and Notes' })).toHaveCount(0);
  const menu = page.getByRole('navigation', { name: 'Main' });
  await expect(menu.getByRole('link', { name: 'Messages' })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: 'Invoices & Payments' })).toBeVisible();
  const side = page.getByRole('complementary', { name: 'Help and shortcuts' });
  await expect(side.getByRole('link', { name: 'Send a Message' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Send a Message/ })).toHaveCount(0);
  await expect(page.locator('footer').getByRole('link', { name: 'Contact Us' })).toHaveCount(0);
  await page.screenshot({ path: `${shots}/tabs-hidden.png` });

  await page.goto(`http://portal.localhost:${port}/lvp/taxes`);
  const notice = page.getByRole('status').filter({ hasText: "Tax Returns isn't available" });
  await expect(notice).toContainText('has turned this part of the portal off');
  await expect(notice).toContainText('Nothing you shared with them is removed');
  await page.screenshot({ path: `${shots}/tab-off-page.png` });
});
