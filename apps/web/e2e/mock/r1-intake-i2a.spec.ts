import { expect, test, type Page } from '@playwright/test';

// Intake Forms Review Two, I2a (R1): EXPIRY-01 (an exact expiration in the firm's time zone,
// shown on the form, refused on its field when not later than now), USABILITY-03 (Assign Staff,
// Extend Expiration, Duplicate and Archive straight from a form and its row) and USABILITY-04 (a
// failed Export PDF says why and the review stays where it is). Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const form = (n: number) =>
  `${app}/intake-forms/0199c0d0-0a00-7000-8000-${String(n).padStart(12, '0')}`;
const LATER = 'Choose an expiration date and time later than now.';
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const more = async (page: Page, action: string) => {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: action }).click();
};

test('EXPIRY-01: the form shows its due date and exact expiration; Extend Expiration takes a later time only', async ({
  page,
}) => {
  await page.goto(form(4));
  const card = page.getByTestId('client-card');
  await expect(card).toContainText('Due Date');
  await expect(card).toContainText(/Expires.*\d{1,2}:\d{2} [AP]M [A-Z]{2,4}/);

  await more(page, 'Extend Expiration');
  const dialog = page.getByTestId('extend-dialog');
  await expect(dialog.getByLabel('Expiration', { exact: true })).toHaveValue('AT');
  await expect(dialog).toContainText('Times are in');
  await dialog.getByLabel('Expiration date').fill(day(-1));
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toContainText(LATER);
  await dialog.getByLabel('Expiration date').fill(day(10));
  await dialog.getByLabel('Expiration time').fill('17:30');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Expiration saved.')).toBeVisible();
  await expect(card).toContainText(/Expires.*5:30 PM/);

  // Never expires is a choice of its own.
  await more(page, 'Extend Expiration');
  await page
    .getByTestId('extend-dialog')
    .getByLabel('Expiration', { exact: true })
    .selectOption('NONE');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(card).toContainText('No expiration');
});

test('USABILITY-03: Assign Staff, Duplicate and Archive from the form; the row menu offers them too', async ({
  page,
}) => {
  await page.goto(form(4));
  await more(page, 'Assign Staff');
  await page.getByTestId('assign-dialog').getByLabel('Assigned to').selectOption({ index: 1 });
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Staff assigned.')).toBeVisible();

  await more(page, 'Archive');
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('Form archived.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0);

  await page.goto(form(2));
  await more(page, 'Duplicate');
  await expect(page.getByTestId('duplicate-dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }).click();
  await expect(page).toHaveURL(/\/intake-forms\/builder\/[0-9a-f-]{36}$/);

  await page.goto(`${app}/intake-forms`);
  await page
    .getByRole('button', { name: /^Actions for / })
    .first()
    .click();
  for (const name of ['Assign Staff', 'Duplicate', 'Archive'])
    await expect(page.getByRole('menuitem', { name })).toBeVisible();
});

test('USABILITY-04: a failed Export PDF says why and keeps the review where it is', async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.sessionStorage.setItem('fv-mock-fail', 'intakeForms.exportPdf'),
  );
  await page.goto(`${form(3)}/responses`);
  await page.getByRole('button', { name: 'Export PDF' }).click();
  await expect(page.getByText(/The PDF couldn’t be made/)).toBeVisible();
  await expect(page).toHaveURL(/\/responses$/);
  await expect(page.getByTestId('intake-tab-responses')).toBeVisible();
});

test('EXPIRY-01: Send Form offers the default, a date and time, or never; a past time is refused on the field', async ({
  page,
}) => {
  await page.goto(`${app}/intake-forms/send`);
  const field = page.getByTestId('expiry-field');
  const choice = field.getByLabel('Expiration', { exact: true });
  await expect(choice.locator('option')).toHaveCount(3);
  await choice.selectOption('AT');
  await field.getByLabel('Expiration date').fill(day(-1));
  await expect(field).toContainText('Times are in');
  await page.getByRole('button', { name: 'Send Form' }).click();
  await expect(field).toContainText(LATER);
  await choice.selectOption('NONE');
  await expect(field).toContainText('The form stays open until it is submitted or archived.');
});
