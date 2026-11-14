import { expect, type Page, test } from '@playwright/test';

// R55, Intake Forms Review Two INTAKE-ACCESS-02: Share & Publish on a published form (its link,
// a website button with the note that an inline embed comes once enabled, Share by link and
// Publish in client portal), and the shared link's page, which starts the form for anyone. Mock
// mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
/** A share token as the mock makes them (mocks/intake-forms.ts): 32 hex characters + 11. */
const TOKEN = '0199c0d00f0070008000000000000002mockshare00';

const cardMenu = async (page: Page, name: string) => {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  return page.getByRole('menu');
};

test('Share & Publish: the link and website button, Publish in client portal, sharing off', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/intake-forms/templates'));
  await (
    await cardMenu(page, 'Audit Support Intake Form')
  )
    .getByRole('menuitem', { name: 'Share & Publish' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Audit Support Intake Form' });
  const share = dialog.getByTestId('form-share');
  await expect(share.getByLabel('Link', { exact: true })).toHaveValue(
    /\/lvp\/start\/[A-Za-z0-9_-]{43}$/,
  );
  await expect(share.getByLabel('Embed code', { exact: true })).toHaveValue(/^<a href=/);
  await expect(share).toContainText(
    'An inline embed will be available once enabled for your site.',
  );

  // Off by default; on, it is listed in the client portal.
  const portalSwitch = share.getByRole('switch', { name: 'Publish in client portal' });
  await expect(portalSwitch).not.toBeChecked();
  await portalSwitch.click();
  await expect(portalSwitch).toBeChecked();

  // Sharing off: the link and button go, and say why.
  await share.getByRole('switch', { name: 'Share by link' }).click();
  await expect(share.getByRole('switch', { name: 'Share by link' })).not.toBeChecked();
  await expect(share.getByTestId('public-link-empty')).toContainText('Sharing by link is off');
  await expect(share.getByLabel('Link', { exact: true })).toHaveCount(0);
});

test('the shared link starts the form for anyone; a dead link says so', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal(`/lvp/start/${TOKEN}`));
  await page.getByLabel('First Name *').fill('Avery');
  await page.getByLabel('Last Name *').fill('Shared');
  await page.getByLabel('Email Address *').fill('avery.shared@example.test');
  await page.getByRole('button', { name: 'Start My Form' }).click();
  await expect(page.getByTestId('intake-next')).toBeVisible();
  await expect(page.locator('[aria-current="step"]')).toContainText(/./);

  await page.goto(portal(`/lvp/start/${'x'.repeat(43)}`));
  await expect(page.getByTestId('share-invalid')).toContainText(
    'This form link is not available any more',
  );
});
