import { expect, type Page, test } from '@playwright/test';

// R56, Templates Review Two Y10 (decided Nov 19) and P02, in mock mode (playwright.mock.config.ts)
// as the Owner; a reload resets the mock. Y10: a letter previews (and prints) with the firm's
// letterhead, signature, footer and disclaimer; an email previews with the footer and disclaimer
// only, as its send adds them; Branding & Letterhead says where each goes. P02: a Bookkeeping
// template says what starts a client's bookkeeping. The mock branding (mocks/templates.ts) has a
// footer, a disclaimer and a signature, with the letterhead on. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/templates`;
test.use({ viewport: { width: 1440, height: 1000 } });

const previewFrame = (page: Page) =>
  page.getByTestId('preview-dialog').locator('iframe[data-testid="preview-body"]').contentFrame();

test('Y10: a letter previews with the letterhead, signature, footer and disclaimer, and can be printed', async ({
  page,
}, testInfo) => {
  await page.goto(`${base}/new?kind=LETTER_NOTICE`);
  await page.getByLabel('Template Name *').fill('Engagement letter (fake)');
  await page.getByLabel('Subject Line').fill('Your engagement');
  await page
    .getByRole('textbox', { name: /Content/ })
    .first()
    .click();
  await page.keyboard.type('Dear client (fake).');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}\/edit/, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Preview Template' }).click();
  const frame = previewFrame(page);
  await expect(frame.locator('[data-part="letterhead"]')).toContainText('LVP Accounting & Taxes', {
    timeout: 30_000,
  });
  await expect(frame.locator('[data-part="letterhead"]')).toContainText('100 Main Street');
  await expect(frame.locator('body')).toContainText('Dear client (fake).');
  await expect(frame.locator('[data-part="signature"]')).toContainText('The LVP team');
  await expect(frame.locator('[data-part="footer"]')).toContainText('100 Main Street');
  await expect(frame.locator('[data-part="disclaimer"]')).toContainText(
    'This message is for the intended client only.',
  );
  await expect(page.getByRole('button', { name: 'Print Letter' })).toBeVisible();
  await page.getByTestId('preview-dialog').screenshot({ path: testInfo.outputPath('letter.png') });
});

test('Y10: an email previews with the footer and disclaimer its send adds; no signature, no letterhead', async ({
  page,
}) => {
  await page.goto(`${base}/library/email`);
  await page
    .getByRole('button', { name: /^Preview New Client Welcome/ })
    .first()
    .click();
  const frame = previewFrame(page);
  await expect(frame.locator('[data-part="footer"]')).toContainText('100 Main Street', {
    timeout: 30_000,
  });
  await expect(frame.locator('[data-part="disclaimer"]')).toBeVisible();
  await expect(frame.locator('[data-part="signature"]')).toHaveCount(0);
  await expect(frame.locator('[data-part="letterhead"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Print Letter' })).toHaveCount(0);
});

test('Y10: Branding & Letterhead says where the footer, disclaimer and signature go', async ({
  page,
}) => {
  await page.goto(base);
  await page
    .getByTestId('tools')
    .getByRole('button', { name: /Branding/ })
    .click();
  const form = page.getByTestId('branding-form');
  await expect(form.getByLabel('Footer text')).toHaveAccessibleDescription(
    /Added once to emails sent from a template/,
  );
  await expect(form.getByLabel('Signature')).toHaveAccessibleDescription(
    /Emails keep the sender’s own My Signature/,
  );
});

test('P02: a Bookkeeping template says what starts a client’s bookkeeping', async ({ page }) => {
  const name = 'Monthly Books Completed';
  await page.goto(`${base}/library/bookkeeping`);
  await expect(
    page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: `Use ${name}` }),
  ).toHaveAccessibleDescription(
    /a client’s bookkeeping starts when you add the client under Bookkeeping, and each new period’s close checklist comes from Bookkeeping Settings/,
  );
});
