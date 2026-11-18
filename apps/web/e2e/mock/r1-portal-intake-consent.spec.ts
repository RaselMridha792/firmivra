import { expect, test } from '@playwright/test';

// R1, Intake Forms Review Two row 21: the review step shows the firm's consent checkbox (Intake
// Form Settings > Consent checkbox required, on in the mock as the setting's default); Submit
// waits for it, and once sent the client sees the firm's own thank-you message. The portal mock's
// second form (Bookkeeping, sent back for a correction) has every answer. Mock mode as the portal
// client; synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const CORRECTION = '0199b6a8-0000-7000-8000-000000000002';

test.describe.configure({ timeout: 240_000 });

test('Submit waits for the consent box, then shows the firm’s thank-you message', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal(`/lvp/intake/${CORRECTION}`));
  const progress = page.getByRole('list', { name: 'Intake progress' });
  await expect(progress).toBeVisible({ timeout: 60_000 });
  await progress
    .getByRole('button', { name: /^Go to / })
    .last()
    .click();
  const consent = page.getByTestId('intake-consent');
  await expect(consent).toContainText(
    "I confirm the information and files I've provided are accurate and complete",
  );

  // The agreement: its required boxes and the typed name.
  const agreement = page.getByRole('region', { name: /agreement/i }).first();
  for (const box of await agreement.locator('input[type=checkbox]').all()) await box.check();
  await page.getByLabel('Full Name *').fill('Jamie Sample');
  await page.getByLabel('Signature (type your full name) *').fill('Jamie Sample');

  await page.getByTestId('intake-next').click();
  await expect(consent.getByRole('alert')).toHaveText(
    'Tick the box to confirm your information before you submit.',
  );
  await consent.getByRole('checkbox').check();
  await page.getByTestId('intake-next').click();
  await expect(page.getByTestId('intake-completion')).toContainText(
    'Thank you! We have your form and will be in touch within two business days.',
    { timeout: 60_000 },
  );
  // Intake Review 2 23-g: the firm numbers its forms, so the done screen gives the Submission ID.
  await expect(page.getByTestId('submission-id')).toHaveText('Submission ID SUB-00004');
});
