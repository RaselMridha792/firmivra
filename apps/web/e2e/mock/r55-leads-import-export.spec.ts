import { expect, test } from '@playwright/test';

// R55, Leads Review Two (Octavia, Nov 8) R2 16: bulk import and export beside the Leads list's
// main actions. Import maps a CSV's columns, checks every row before anything is created, then
// imports only the new valid leads; Export states its scope and columns before making the file. In
// mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

const CSV = [
  'First Name,Last Name,E-mail,Company,Lead Source',
  'Nora,Quill,nora.quill@example.test,Quill LLC,Referral',
  'Sam,Twin,marco.diaz@example.test,,Website Form',
  'Bad,Email,not-an-email,,',
  'Nora,Again,NORA.QUILL@example.test,,',
].join('\r\n');

test('imports a CSV: maps the columns, checks the rows, then creates only the new ones', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  await page.getByTestId('import-leads').click();
  const screen = page.getByTestId('leads-import');
  await expect(screen.getByRole('heading', { name: 'Import Leads' })).toBeVisible();

  await screen
    .getByTestId('import-upload')
    .locator('input[type=file]')
    .setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  const map = screen.getByTestId('import-map');
  await expect(map).toContainText('leads.csv: 4 rows');
  // The columns are guessed from the headers ("E-mail" is Email, "Company" the business name).
  await expect(map.getByLabel('E-mail')).toHaveValue('email');
  await expect(map.getByLabel('Company')).toHaveValue('businessName');
  await expect(map.getByLabel('Lead Source')).toHaveValue('source');

  // A default service is required before the rows are checked.
  await map.getByTestId('import-check').click();
  await expect(map.getByRole('alert')).toHaveText('Choose the default service.');
  await map.getByTestId('import-default-service').selectOption({ index: 1 });
  await map.getByTestId('import-check').click();

  const preview = screen.getByTestId('import-preview');
  await expect(preview).toContainText('1New leads to create');
  await expect(preview).toContainText('2Possible duplicates');
  await expect(preview).toContainText('1Rows with problems');
  const problems = preview.getByRole('table', {
    name: 'Possible duplicates and rows with problems',
  });
  await expect(problems.getByRole('row', { name: /Sam Twin/ })).toContainText(
    'Possible duplicate of Marco Diaz: skipped',
  );
  await expect(problems.getByRole('row', { name: /Bad Email/ })).toContainText('Email: ');
  await expect(problems.getByRole('row', { name: /Nora Again/ })).toContainText(
    'Possible duplicate of an earlier row: skipped',
  );

  // The possible duplicates are skipped unless added on purpose for Review Duplicates.
  const run = preview.getByTestId('import-run');
  await expect(run).toHaveText('Import 1 Lead');
  await preview.getByTestId('import-review-duplicates').check();
  await expect(run).toHaveText('Import 3 Leads');
  await expect(problems.getByRole('row', { name: /Sam Twin/ })).toContainText(
    'added for Review Duplicates',
  );
  await preview.getByTestId('import-review-duplicates').uncheck();
  await run.click();
  await expect(preview.getByTestId('import-run')).toHaveCount(0);
  const results = screen.getByTestId('import-results');
  await expect(results).toContainText('1Created');
  await expect(results).toContainText('2Duplicates skipped');
  await expect(results.getByRole('link', { name: 'Review Duplicates' })).toHaveCount(0);

  // The new lead is on the Leads list (the same page load: client navigation).
  await results.getByRole('link', { name: 'Go to Leads' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Leads');
  await expect(page.getByRole('row', { name: /Nora Quill/ })).toBeVisible();
});

test('exports the list as filtered, with its scope and columns stated first', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  await page.getByTestId('export-leads').click();
  const dialog = page.getByRole('dialog', { name: 'Export Leads' });
  // Nothing selected: Selected is off, and the filtered list is chosen.
  await expect(dialog.getByRole('radio', { name: 'Selected leads (0)' })).toBeDisabled();
  const filtered = dialog.getByRole('radio', { name: /The list as filtered now \(\d+\)/ });
  await expect(filtered).toBeChecked();
  await expect(dialog).toContainText('Dates of birth and addresses are never exported.');
  await dialog.getByRole('checkbox', { name: 'Tags' }).uncheck();

  await dialog.getByTestId('export-make').click();
  const ready = dialog.getByTestId('export-ready');
  await expect(ready).toContainText(/\d+ leads in leads\.csv/);
  await expect(ready.getByRole('link', { name: 'leads.csv' })).toHaveAttribute(
    'href',
    /^data:text\/csv/,
  );
});
