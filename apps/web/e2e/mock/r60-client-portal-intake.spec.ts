// R60, the Client Portal module's Intake Forms (intake-form-client-portal.jpg; instructions 21
// to 23): the counts are the client's forms (none, then the one sent), the row actions of a form
// waiting on the client, Send Reminder, More Actions, the side cards and Manage Templates. Mock
// mode (the mock's state lives in the page, so the spec moves only in-app and by Back).
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';
const FORM = 'Personal Tax Intake Form';

test('Intake Forms: the counts follow the forms sent, a waiting form has its actions, and More Actions and Manage Templates open', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1536, height: 1200 });
  await page.goto(app(`/client-portal/${JAMIE}/forms`));
  const forms = page.getByTestId('portal-forms');
  const kpis = forms.getByTestId('form-kpis');
  const kpi = (label: string) =>
    kpis.getByText(label, { exact: true }).locator('xpath=preceding-sibling::p[1]');
  await expect(kpis).toContainText('Total Forms', { timeout: 60_000 });
  // Nothing sent yet: every count is zero, as the list is empty.
  await expect(kpi('Total Forms')).toHaveText('0');
  await expect(forms).toContainText('No intake forms sent to this client yet.');

  // Request Form sends one; back on the tab, the counts and the list show it.
  await forms.getByRole('button', { name: 'Request Form' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Send Intake Form' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('combobox', { name: /Form \/ Template/ }).selectOption({ label: FORM });
  await page.getByRole('radio', { name: /^Email/ }).check();
  await page.getByRole('textbox', { name: /^Subject/ }).fill(`Your ${FORM}`);
  await page.getByRole('textbox', { name: /^Message/ }).fill('Hi Jamie, please fill this in.');
  await page.getByRole('button', { name: 'Send Form' }).click();
  await expect(page.getByTestId('send-result')).toContainText('Form Sent');
  await page.goBack();
  await expect(kpi('Total Forms')).toHaveText('1', { timeout: 60_000 });
  await expect(kpi('Not Started')).toHaveText('1');
  await expect(page.getByTestId('form-pending-actions')).toContainText('1 forms not started');
  const table = page.getByTestId('portal-forms-table');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('tbody tr').first()).toContainText(FORM);

  // A form waiting on the client: Send Reminder is among its actions.
  await table.getByRole('button', { name: `Actions for ${FORM}` }).click();
  for (const item of [
    'View Submission',
    'Download PDF',
    'Send Reminder',
    'Send Message',
    'View Form History',
    'Archive',
  ]) {
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await page.getByRole('menuitem', { name: 'Send Reminder' }).click();
  await expect(table.getByRole('alert')).toHaveCount(0);

  // More Actions and the side cards.
  await forms.getByRole('button', { name: 'More form actions' }).click();
  for (const item of [
    'View in Intake Forms',
    'Manage Templates',
    'Form Settings (Client Permissions)',
  ]) {
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(forms.getByRole('button', { name: 'Send Reminder', exact: true })).toBeVisible();
  for (const quick of ['Request a New Form', 'Send Reminder to Client', 'View Form History']) {
    await expect(page.getByRole('button', { name: quick })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Manage Templates', exact: true }).last().click();
  await expect(page).toHaveURL(/\/intake-forms/);
});
