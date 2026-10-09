import { expect, type Page, test } from '@playwright/test';
import {
  MOCK_ACCESS_CODE,
  MOCK_SIGNING_CODE,
  MOCK_SIGNING_TOKENS,
} from '../../src/mocks/esign-signing';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const link = (token: string) => `http://portal.localhost:${port}/lvp/sign#t=${token}`;

async function agreeToConsent(page: Page) {
  await expect(page.getByTestId('consent-text')).toContainText('Consent to sign electronically');
  // Continue without ticking the box: told to agree first.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Tick the box to agree')).toBeVisible();
  await page.getByLabel(/I agree to sign .* documents electronically\./).check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('email code, consent, then the document with my fields', async ({ page }) => {
  await page.goto(link(MOCK_SIGNING_TOKENS.emailCode));
  await expect(page.getByTestId('page-title')).toHaveText('Bookkeeping Services Agreement');
  // The token never stays in the address bar.
  await expect(page).toHaveURL(/\/lvp\/sign$/);
  await expect(page.getByText(/^j\*\*\*@example\./)).toBeVisible();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = page.getByLabel('Code from the email');
  await code.fill('000000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('That code is not right or has expired.')).toBeVisible();
  await code.fill(MOCK_SIGNING_CODE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await agreeToConsent(page);
  await expect(page.getByText('You have 7 fields to fill in')).toBeVisible();
  await expect(
    page.getByRole('document', { name: 'Bookkeeping Services Agreement' }),
  ).toBeVisible();
  await expect(page.locator('[data-page="1"]').getByTestId('esign-field')).toHaveCount(3);
  await expect(page.getByLabel('Your job title (required), Jamie Sample')).toBeVisible();
});

test('an access code instead of the email code', async ({ page }) => {
  await page.goto(link(MOCK_SIGNING_TOKENS.accessCode));
  const code = page.getByLabel('Access code');
  await code.fill('WRONG1');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await code.fill(MOCK_ACCESS_CODE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('consent-text')).toBeVisible();
});

test('no fields placed: signs on the added signature page', async ({ page }) => {
  await page.goto(link(MOCK_SIGNING_TOKENS.autoPage));
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('Code from the email').fill(MOCK_SIGNING_CODE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await agreeToConsent(page);
  await expect(page.getByText('You sign on the signature page at the end')).toBeVisible();
});

test('waiting, and links that no longer work', async ({ page }) => {
  await page.goto(link(MOCK_SIGNING_TOKENS.waiting));
  await expect(page.getByRole('heading', { name: 'Not your turn yet' })).toBeVisible();
  // A link already used to sign, and one that ran out.
  for (const token of [MOCK_SIGNING_TOKENS.used, MOCK_SIGNING_TOKENS.expired]) {
    await page.goto(link(token));
    await expect(page.getByRole('heading', { name: "This link can't be opened" })).toBeVisible();
    await expect(page.getByText('This link is not valid any more.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  }
});

test('the completed copy, after the email code', async ({ page }) => {
  await page.goto(link(MOCK_SIGNING_TOKENS.copy));
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('Code from the email').fill(MOCK_SIGNING_CODE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your signed copy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download the document' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download the certificate' })).toBeVisible();
});

test('the signer pages fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(link(MOCK_SIGNING_TOKENS.emailCode));
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('Code from the email').fill(MOCK_SIGNING_CODE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('consent-text')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

async function openDocument(page: Page, token: string) {
  await page.goto(link(token));
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('Code from the email').fill(MOCK_SIGNING_CODE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(/I agree to sign .* documents electronically\./).check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('adopt a signature, fill each required field with Next, then finish', async ({ page }) => {
  await openDocument(page, MOCK_SIGNING_TOKENS.emailCode);
  const progress = page.getByTestId('sign-progress');
  // The printed name comes filled in; initials, job title, the box and the signature do not.
  await expect(progress).toHaveText('1 of 5 required done');
  // Finish before adopting asks for the signature first.
  await page.getByRole('button', { name: 'Finish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Adopt your signature' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Printed name')).toHaveValue('Jamie Sample');
  // A typed signature must match the printed name.
  await dialog.getByLabel('Your full name').fill('Someone Else');
  await dialog.getByRole('button', { name: 'Adopt and sign' }).click();
  await expect(dialog.getByText('Type your signature exactly as your printed name.')).toBeVisible();
  await dialog.getByLabel('Your full name').fill('Jamie Sample');
  await expect(dialog.getByRole('textbox', { name: 'Your initials', exact: true })).toHaveValue(
    'JS',
  );
  await dialog.getByRole('button', { name: 'Adopt and sign' }).click();
  await expect(dialog).toBeHidden();
  await expect(progress).toHaveText('3 of 5 required done');
  await expect(page.getByLabel(/^Signature \(required\), Jamie Sample, done$/)).toContainText(
    'Jamie Sample',
  );
  // Finish now goes to the first empty required field, in document order.
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByText('Fill in every required field first: 2 are left.')).toBeVisible();
  await page.getByLabel('Your job title', { exact: true }).fill('Owner');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('checkbox', { name: 'I have read the engagement terms' }).check();
  await expect(progress).toHaveText('5 of 5 required done');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: "You're done" })).toBeVisible();
});

test('upload an optional attachment', async ({ page }) => {
  await openDocument(page, MOCK_SIGNING_TOKENS.emailCode);
  await page.getByLabel('Photo ID (optional), Jamie Sample').click();
  await page.getByTestId('attachment-upload').setInputFiles({
    name: 'photo-id.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
  });
  await expect(page.getByText('Uploaded: photo-id.pdf')).toBeVisible();
  await expect(
    page.getByLabel('Photo ID (optional), Jamie Sample: photo-id.pdf, done'),
  ).toBeVisible();
});

test('decline to sign, with a reason', async ({ page }) => {
  await openDocument(page, MOCK_SIGNING_TOKENS.autoPage);
  await page.getByRole('button', { name: 'Decline to sign' }).click();
  const dialog = page.getByRole('dialog', { name: 'Decline to sign' });
  await dialog.getByLabel(/Reason/).fill('I need to talk to my spouse first.');
  await dialog.getByRole('button', { name: 'Decline to sign' }).click();
  await expect(page.getByRole('heading', { name: 'You declined' })).toBeVisible();
});
