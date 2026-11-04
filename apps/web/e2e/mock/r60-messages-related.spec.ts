import { expect, type Page, test } from '@playwright/test';

// R60, MSG-F13 and F16 (Octavia's Messages review of Oct 27): New Message's Related To (one of the
// client's own records) and Assign Staff. Mock mode as the Owner: Jamie Sample's records are
// synthetic; Sam Staff works with Jamie but not with Riley. Nothing is sent anywhere.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const pick = (page: Page, name: string) =>
  page
    .getByRole('region', { name: 'Select Recipients' })
    .getByRole('checkbox', { name, exact: true });

test('MSG-F13, F16: the conversation is filed under the record and owned by the chosen staff', async ({
  page,
}) => {
  await page.goto(app('/messages/new'));
  const related = page.getByLabel('Related To');
  await expect(pick(page, 'Jamie Sample')).toBeVisible();
  await expect(related).toBeDisabled();
  await pick(page, 'Jamie Sample').check();
  await expect(related).toBeEnabled();
  await expect(related.locator('option', { hasText: '2025 bank statements' })).toHaveCount(1);
  await related.selectOption({ label: '2025 bank statements' });
  await page.getByLabel('Assign Staff').selectOption({ label: 'Sam Staff' });
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('A reminder about your bank statements. (synthetic)');
  await page.getByRole('button', { name: 'Review and Send' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send Message' }).click();
  const outcome = page.getByTestId('compose-outcome');
  await expect(outcome).toContainText('Message sent');
  await outcome.getByRole('link', { name: 'Open conversation' }).click();
  await expect(page.getByTestId('conversation')).toContainText('A reminder about your bank');
  // Filed under the record: the Documents view lists it.
  const row = page.getByTestId('thread-row').filter({ hasText: 'A reminder about your bank' });
  await expect(row).toContainText('Document request');
  await page.getByRole('tab', { name: /^Documents/ }).click();
  await expect(
    page.getByTestId('thread-row').filter({ hasText: 'A reminder about your bank' }),
  ).toHaveCount(1);
});

test('MSG-F13: Related To is for one client; MSG-F16: a staff member owns only their clients', async ({
  page,
}) => {
  await page.goto(app('/messages/new'));
  await pick(page, 'Jamie Sample').check();
  await pick(page, 'Riley Example').check();
  const related = page.getByLabel('Related To');
  await expect(related).toBeDisabled();
  await expect(related).toContainText('Choose one client');
  await page.getByLabel('Assign Staff').selectOption({ label: 'Sam Staff' });
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Hello (synthetic)');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(
    page.getByText('This staff member does not work with everyone you chose.'),
  ).toBeVisible();
});
