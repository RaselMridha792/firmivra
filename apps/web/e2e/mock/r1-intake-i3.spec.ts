import { expect, test, type Page } from '@playwright/test';

// Intake Forms Review Two I3 in mock mode, as the Owner: 14b (six minimum-retention categories and
// Apply to all), 10c (the final reminder counts back from the expiry, so 5 minutes is offered in
// both lists) and DOCUMENTS-LIMIT-01 (the regular documents' largest file, 5 to 100 MB, apart from
// the intake forms' own). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function openIntakeSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/intake-forms/settings'));
  await expect(page.getByRole('switch', { name: 'Allow save and resume' })).toBeVisible({
    timeout: 60_000,
  });
}
const saved = (page: Page) =>
  expect(page.getByText('Your intake settings were saved.')).toBeVisible();

test('14b: six minimums, Apply to all, each on its own, and what is in effect', async ({
  page,
}) => {
  await openIntakeSettings(page);
  const box = page.getByTestId('data-retention');
  await expect(box).toContainText('nothing is deleted or archived');
  const categories = box.getByRole('list', { name: 'Retention by category' }).getByRole('listitem');
  await expect(categories).toHaveCount(6);
  for (const label of [
    'Client-sent documents',
    'Company-sent documents',
    'Submitted intake forms',
    'Portal messages',
    'System-sent emails',
    'Tax return documents',
  ])
    await expect(box.getByLabel(label)).toHaveValue('');

  // Apply to all fills all six; each can then change on its own.
  const apply = box.getByRole('button', { name: 'Apply to all six' });
  await expect(apply).toBeDisabled();
  await box.getByLabel('Apply to all (years)').fill('7');
  await apply.click();
  await expect(box.getByLabel('Portal messages')).toHaveValue('7');
  await box.getByLabel('Tax return documents').fill('10');
  await box.getByLabel('Portal messages').fill('');
  await expect(page.getByTestId('retention-portalMessages')).toContainText(
    'In effect: 7 years (Apply to all)',
  );
  await expect(page.getByTestId('retention-taxReturnDocuments')).toContainText(
    'In effect: 10 years',
  );
  await expect(page.getByTestId('retention-taxReturnDocuments')).toContainText(
    'Starts: when the tax return’s service (job) is completed.',
  );
  // I3b: the date the server's guard keeps to, and the default for a record with no completed job.
  await expect(page.getByTestId('retention-kept-taxReturnDocuments')).toContainText(
    'Kept until 10 years after its job is completed',
  );
  await expect(page.getByTestId('retention-kept-clientDocuments')).toContainText(
    'While its job isn’t completed, or if it has none, it is kept.',
  );
  await expect(page.getByTestId('retention-clientDocuments')).toContainText(
    'A lead’s files count once the lead becomes a client.',
  );
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await saved(page);
  await expect(box.getByLabel('Tax return documents')).toHaveValue('10');
  await expect(box.getByLabel('Client-sent documents')).toHaveValue('7');
  await expect(box.getByLabel('Portal messages')).toHaveValue('');
  await box.screenshot({ path: test.info().outputPath('retention.png') });

  // 1 to 30 whole years, at the field.
  await box.getByLabel('System-sent emails').fill('31');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('retention-systemEmails')).toContainText('Enter 1 to 30 years');
});

test('10c: the final reminder counts back from the expiry, with 5 minutes in both lists', async ({
  page,
}) => {
  await openIntakeSettings(page);
  const first = page.getByRole('combobox', { name: 'First reminder' });
  const final = page.getByRole('combobox', { name: 'Final reminder' });
  await expect(page.getByTestId('reminder-rule')).toContainText(
    'the final one back from when it expires',
  );
  await expect(final.locator('option').first()).toHaveText('5 minutes before expiry');
  await expect(final.locator('option').last()).toHaveText('60 days before expiry');
  await expect(first.locator('option').last()).toHaveText('30 days after sending');
  // A later first reminder leaves the final one as it is.
  await first.selectOption({ label: '30 days after sending' });
  await expect(final).toHaveValue('10080');
  await first.selectOption({ label: '5 minutes after sending' });
  await final.selectOption({ label: '5 minutes before expiry' });
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await saved(page);
  await expect(first).toHaveValue('5');
  await expect(final).toHaveValue('5');
});

test('10c: Send Form shows the final reminder before the expiry', async ({ page }) => {
  await page.goto(app('/intake-forms/send'));
  await page.getByRole('button', { name: 'View Schedule' }).click({ timeout: 60_000 });
  const schedule = page.getByRole('dialog', { name: 'Reminder Schedule' });
  await expect(schedule.getByTestId('send-schedule')).toContainText(
    'Final reminder7 days before it expires',
  );
  await expect(schedule).toContainText('A form with no expiration gets the first reminder only.');
});

test('DOCUMENTS-LIMIT-01: the largest document is 5 to 100 MB, apart from intake forms', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/documents/settings'));
  await expect(page.getByTestId('document-settings')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'File Settings' }).click();
  const size = page.getByLabel('Largest file');
  await expect(size).toHaveValue('100');
  await expect(size.locator('option')).toHaveText([
    '5 MB',
    '10 MB',
    '20 MB',
    '30 MB',
    '50 MB',
    '100 MB',
  ]);
  await expect(page.getByTestId('file-size-scope')).toContainText(
    'Intake forms have their own limit',
  );
  await size.selectOption('20');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Document settings were saved.')).toBeVisible();
  await expect(size).toHaveValue('20');
  await page.screenshot({ path: test.info().outputPath('documents-file-settings.png') });

  // Settings > Forms & Documents names both limits and where each is set.
  await page.goto(app('/settings/forms-documents'));
  const files = page.getByTestId('allowed-files');
  await expect(files).toContainText('Largest document', { timeout: 60_000 });
  await expect(files).toContainText('Largest intake form file10 MB');
  await expect(files).toContainText('Firmivra’s own limit100 MB a file');
  await expect(files).not.toContainText('everywhere');
  await expect(files.getByRole('link', { name: 'File Settings' })).toHaveAttribute(
    'href',
    '/documents/settings',
  );
});
