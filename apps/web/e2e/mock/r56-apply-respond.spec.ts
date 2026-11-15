import { expect, test } from '@playwright/test';

// R56, Super Admin SA-APP-F04 (Y06): the applicant's answer page from the emailed link. The
// request, a 6-digit code to the contact email (000000 in mock mode), then text and a PDF on the
// same application; an unknown link says it has ended. Mock mode. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const TOKEN = 'mockResponseToken0000000000000000000000000A';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

test('SA-APP-F04: the applicant confirms a code, then sends text and a file', async ({ page }) => {
  await page.goto(app(`/apply/respond#token=${TOKEN}`));
  const request = page.getByTestId('respond-request');
  await expect(request).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('respond-reason')).toContainText('Please send your PTIN');
  await expect(request).toContainText('ca***@example.test');

  await request.getByRole('button', { name: 'Send the code' }).click();
  const code = request.getByLabel('6-digit code');
  await code.fill('123456');
  await request.getByRole('button', { name: 'Continue' }).click();
  await expect(request.getByRole('alert')).toContainText('That code is not right');
  await code.fill('000000');
  await request.getByRole('button', { name: 'Continue' }).click();

  const answer = page.getByTestId('respond-answer');
  await expect(answer).toBeVisible();
  const send = answer.getByRole('button', { name: 'Send answer' });
  await expect(send).toBeDisabled();
  await answer.getByLabel('Answer').fill('PTIN P01234567. The license copy is attached.');
  await answer
    .locator('input[type="file"]')
    .setInputFiles({ name: 'license.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(answer.getByRole('list', { name: 'Files to send' })).toContainText('license.pdf');
  await send.click();
  await expect(page.getByTestId('respond-done')).toContainText(
    'Your answer was added to your application',
  );
});

test('SA-APP-F04: a link that is unknown or missing has ended', async ({ page }) => {
  await page.goto(app(`/apply/respond#token=${'B'.repeat(43)}`));
  await expect(page.getByTestId('respond-gone')).toContainText('This link no longer works', {
    timeout: 60_000,
  });
  await page.goto(app('/apply/respond'));
  await expect(page.getByTestId('respond-gone')).toBeVisible({ timeout: 60_000 });
});
