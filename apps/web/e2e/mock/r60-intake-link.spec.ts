import { expect, type Page, test } from '@playwright/test';

// Octavia's I3 (review of Oct 20; Rasel, Oct 22) and INTAKE-ACCESS-02: a service's main form's link
// is its Begin Online page; any other published form has its own share link. Each comes with a
// website button that opens it, each with Copy (Share & Publish). Mock mode
// (playwright.mock.config.ts) as an Owner: each service's first template is its main form, and
// Business Development is off Begin Online (a HIDDEN link).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const PERSONAL_TAX = '0199c0d0-0f00-7000-8000-000000000001';

const cardMenu = async (page: Page, name: string) => {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  return page.getByRole('menu');
};

test('Publish on a main form shows Share & Publish: the Begin Online page and its button', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(app(`/intake-forms/builder/${PERSONAL_TAX}`));
  await expect(page.getByLabel('Form Name')).toHaveValue('Personal Tax Intake Form');
  await page.getByRole('button', { name: 'Publish Form' }).click();

  const dialog = page.getByRole('dialog', { name: 'Personal Tax Intake Form' });
  await expect(dialog).toBeVisible();
  // Published as the form's next version: the same form, so the same link.
  await expect(page).toHaveURL(new RegExp(`${PERSONAL_TAX}$`));
  await expect(page.getByTestId('builder-status')).toHaveText(
    'Published as a new version. Forms already sent keep the earlier one.',
  );
  const link = dialog.getByLabel('Link', { exact: true });
  await expect(link).toHaveValue(/\/lvp\/begin\/annual-tax$/);
  const url = await link.inputValue();
  // A website button that opens the link (an inline embed needs framing enabled for the site).
  const button = dialog.getByLabel('Embed code', { exact: true });
  await expect(button).toHaveValue(new RegExp(`^<a href="${url}" target="_blank" rel="noopener"`));
  await expect(button).toHaveValue(/>Personal Tax Intake Form<\/a>$/);
  await expect(dialog).toContainText(
    'An inline embed will be available once enabled for your site.',
  );
  await expect(dialog.getByTestId('public-link-notice')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Copy Form Link' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Link copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  // Done closes it; More save options opens it again.
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'More save options' }).click();
  await page.getByRole('menuitem', { name: 'Share & Publish' }).click();
  await expect(dialog.getByLabel('Link', { exact: true })).toHaveValue(url);
});

test("the card menu has Share & Publish for each form, with the link's state", async ({ page }) => {
  await page.goto(app('/intake-forms/templates'));

  // Every form has it, a form with no service (Client Onboarding) too.
  const onboarding = await cardMenu(page, 'New Client Intake Form');
  await expect(onboarding.getByRole('menuitem', { name: 'Share & Publish' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Business Development is not on Begin Online: the link is shown with why it takes nothing.
  await (
    await cardMenu(page, 'Custom Advisory Intake Form')
  )
    .getByRole('menuitem', { name: 'Share & Publish' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Custom Advisory Intake Form' });
  await expect(dialog.getByLabel('Link', { exact: true })).toHaveValue(
    /\/lvp\/begin\/business-development$/,
  );
  await expect(dialog.getByTestId('public-link-notice')).toHaveText(
    'This form is hidden from clients. The link takes no new submissions while it is hidden.',
  );
  await dialog.getByRole('button', { name: 'Done' }).click();

  // A second template of a service: its own share link, not the service's page.
  await (
    await cardMenu(page, 'Audit Support Intake Form')
  )
    .getByRole('menuitem', { name: 'Share & Publish' })
    .click();
  const second = page.getByRole('dialog', { name: 'Audit Support Intake Form' });
  await expect(second.getByLabel('Link', { exact: true })).toHaveValue(
    /\/lvp\/start\/[A-Za-z0-9_-]{43}$/,
  );
  await expect(second.getByRole('switch', { name: 'Share by link' })).toBeChecked();
});
