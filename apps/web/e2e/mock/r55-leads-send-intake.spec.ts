import { expect, test } from '@playwright/test';

// R55, Leads Review Two R2 3a: Send Intake Form from a lead opens Send Intake Form with that lead
// already chosen as the recipient, sends nothing by itself, and offers the way back to the lead.
// Mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const id = '0199c0c0-0a00-7000-8000-000000000001';

test('R2 3a: Send Intake Form from a lead preselects it, sends nothing, and leads back to it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads/${id}`);
  await expect(page.getByTestId('lead-name')).toHaveText('Avery Lawson');
  await page
    .getByTestId('card-quick-actions')
    .getByRole('link', { name: 'Send Intake Form' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/intake-forms/send\\?leadId=${id}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Send Intake Form' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Lead' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: /^Lead \*/ })).toContainText('Avery Lawson');
  // Nothing went out: no result, and Send Form still waits for a form to be chosen and sent.
  await expect(page.getByTestId('send-result')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send Form' })).toBeVisible();

  await page.getByRole('link', { name: 'Back to Avery Lawson' }).click();
  await expect(page).toHaveURL(new RegExp(`/leads/${id}/documents$`));
  await expect(page.getByTestId('lead-name')).toHaveText('Avery Lawson');
});
