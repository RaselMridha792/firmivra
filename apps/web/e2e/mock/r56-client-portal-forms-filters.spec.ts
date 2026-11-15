import { expect, type Locator, type Page, test } from '@playwright/test';

// R56, the Client Portal module's Intake Forms (developer instructions items 1 and 7): an archived
// form is listed under Status "Archived" (it leaves All Statuses, as in the API), and the list
// filters by form type and by service. Mock mode (the mock's state lives in the page, so the
// spec moves only by in-app navigation and Back). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';
const PERSONAL = 'Personal Tax Intake Form';
const BUSINESS = 'Business Tax Intake Form';

/** Request Form with Jamie chosen, send `form` by email, and come Back to the forms tab. */
async function requestForm(page: Page, forms: Locator, form: string) {
  await forms.getByRole('button', { name: 'Request Form' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Send Intake Form' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('Jamie Sample').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('combobox', { name: /Form \/ Template/ }).selectOption({ label: form });
  await page.getByRole('radio', { name: /^Email/ }).check();
  await page.getByRole('textbox', { name: /^Subject/ }).fill(`Your ${form}`);
  await page.getByRole('textbox', { name: /^Message/ }).fill('Hi Jamie, please fill this in.');
  await page.getByRole('button', { name: 'Send Form' }).click();
  await expect(page.getByTestId('send-result')).toContainText('Form Sent');
  await page.goBack();
  await expect(forms).toBeVisible({ timeout: 60_000 });
}

test('P1-17: an archived form is listed under Archived; Form Type and Service filter the list', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1536, height: 1200 });
  await page.goto(app(`/client-portal/${JAMIE}/forms`));
  const forms = page.getByTestId('portal-forms');
  await expect(forms.getByTestId('form-kpis')).toContainText('Total Forms', { timeout: 60_000 });
  await requestForm(page, forms, PERSONAL);
  await requestForm(page, forms, BUSINESS);

  const rows = forms.getByTestId('portal-forms-table').locator('tbody tr');
  await expect(rows).toHaveCount(2);

  // Form Type: only the chosen form's row; Service: only the chosen service's row.
  const formType = forms.getByLabel('Form Type');
  await formType.selectOption({ label: BUSINESS });
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('td').first()).toHaveText(BUSINESS);
  await formType.selectOption({ label: 'All Form Types' });
  await expect(rows).toHaveCount(2);
  const service = forms.getByLabel('Service');
  await expect(service.locator('option')).toHaveCount(3);
  const serviceName = (await service.locator('option').nth(1).innerText()).trim();
  await service.selectOption({ label: serviceName });
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('td').nth(1)).toHaveText(serviceName);
  await forms.getByRole('button', { name: 'Clear' }).click();
  await expect(rows).toHaveCount(2);
  await expect(service).toHaveValue('');

  // Archive the Personal Tax form: it leaves All Statuses and is listed under Archived.
  await forms.getByRole('button', { name: `Actions for ${PERSONAL}` }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(BUSINESS);
  await forms.getByLabel('Status').selectOption({ label: 'Archived' });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(PERSONAL);
  await expect(rows.first()).toContainText('Archived');
  await expect(rows.first()).toContainText('Personal Tax service');
});

test('P1-18: Download PDF on a form row opens the PDF in its own tab; a failure says why', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1536, height: 1200 });
  await page.goto(app(`/client-portal/${JAMIE}/forms`));
  const forms = page.getByTestId('portal-forms');
  await expect(forms.getByTestId('form-kpis')).toContainText('Total Forms', { timeout: 60_000 });
  await requestForm(page, forms, PERSONAL);

  const actions = forms.getByRole('button', { name: `Actions for ${PERSONAL}` });
  const opened = page.context().waitForEvent('page');
  await actions.click();
  await page.getByRole('menuitem', { name: 'Download PDF' }).click();
  await opened;
  await expect(forms).toBeVisible();
  await expect(forms.getByRole('alert')).toHaveCount(0);

  await page.evaluate(() => window.sessionStorage.setItem('fv-mock-fail', 'intakeForms.exportPdf'));
  await actions.click();
  await page.getByRole('menuitem', { name: 'Download PDF' }).click();
  await expect(forms.getByRole('alert')).toContainText('The PDF couldn’t be made');
  await expect(page).toHaveURL(app(`/client-portal/${JAMIE}/forms`));
});
