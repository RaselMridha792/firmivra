import { expect, type Page, test } from '@playwright/test';

// R60, Appointments Review 2 B9: on a new appointment, "Show client instructions in" starts from
// the client: Email when they have an email, Portal when they have a portal login, Text only when
// they agreed to appointment texts. Once changed by hand, choosing the client leaves them. Mock
// mode (mocks/appointments-scheduling.ts: Bruno has no portal, Avery takes texts) as the Owner.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
}

async function choose(page: Page, typed: string, name: string) {
  await page.getByLabel('Client / Lead *').fill(typed);
  await page
    .getByTestId('contact-results')
    .getByRole('button', { name: new RegExp(name) })
    .click();
}

const toggles = (page: Page) => {
  const box = page.getByTestId('instructions-in');
  return {
    email: box.getByRole('checkbox', { name: 'Email', exact: true }),
    portal: box.getByRole('checkbox', { name: 'Portal', exact: true }),
    text: box.getByRole('checkbox', { name: 'Text (when the client gets texts)' }),
  };
};

test('a client without a portal login: Email on, Portal and Text off', async ({ page }) => {
  await open(page);
  await choose(page, 'Bruno', 'Bruno Sandoval');
  const t = toggles(page);
  await expect(t.email).toBeChecked();
  await expect(t.portal).not.toBeChecked();
  await expect(t.text).not.toBeChecked();
});

test('a client with a portal who agreed to texts: all three on', async ({ page }) => {
  await open(page);
  await choose(page, 'Avery', 'Avery Lawson');
  const t = toggles(page);
  await expect(t.email).toBeChecked();
  await expect(t.portal).toBeChecked();
  await expect(t.text).toBeChecked();
  await page.screenshot({ path: test.info().outputPath('instructions-in.png') });
});

test('toggles changed by hand stay as they are when the client is chosen', async ({ page }) => {
  await open(page);
  const t = toggles(page);
  await t.portal.uncheck();
  await choose(page, 'Avery', 'Avery Lawson');
  await expect(t.email).toBeChecked();
  await expect(t.portal).not.toBeChecked();
  await expect(t.text).not.toBeChecked();
});
