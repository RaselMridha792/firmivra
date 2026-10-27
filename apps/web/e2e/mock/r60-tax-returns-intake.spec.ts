import { expect, type Page, test } from '@playwright/test';

// Octavia's Tax Returns review of Oct 25, TX-F11: Intake & Documents has an Intake Form card with
// the client's intake for this return's year (never a fixed year). Open shows the submitted
// answers with Back to the return's tab (SH1); Request Correction sends it back to the client.
// In mock mode (playwright.mock.config.ts) as the Owner: every client has last season's
// submitted intake and the season before's completed one. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const season = String(new Date().getFullYear() - 1);

async function openReturn(page: Page, year: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns'));
  await page.getByTestId('tr-filters').getByLabel('Tax Year').selectOption(year);
  await page.getByTestId('return-link').first().click();
  await page.getByRole('tab', { name: 'Intake & Documents' }).click();
}

test("the return's intake opens with Back to this tab, and a correction is sent back", async ({
  page,
}) => {
  await openReturn(page, season);
  const card = page.getByTestId('intake-form');
  await expect(card).toContainText(`Individual Tax Return ${season}`);
  await expect(card).toContainText('Submitted');
  // Only this return's year: the season before's intake is another return's.
  await expect(card).not.toContainText(`Individual Tax Return ${Number(season) - 1}`);
  const returnUrl = page.url();

  await card.getByRole('link', { name: /^Open/ }).click();
  await expect(page).toHaveURL(/\/intake-forms\/[0-9a-f-]+/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(returnUrl);
  await expect(page.getByRole('tab', { name: 'Intake & Documents' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await card.getByRole('button', { name: 'Request Correction' }).click();
  const send = page.getByRole('dialog').getByRole('button', { name: 'Send to Client' });
  await expect(send).toBeDisabled();
  await page
    .getByTestId('correction-dialog')
    .getByLabel('What to correct (the client sees this)')
    .fill('Please add the second W-2.');
  await send.click();
  await expect(page.getByText('gets the form back with your note.')).toBeVisible();
  await expect(card).toContainText('Needs Correction');
  await expect(card).toContainText('Please add the second W-2.');
});

test('a year with no intake says so and offers to send one', async ({ page }) => {
  await openReturn(page, String(Number(season) - 2));
  const card = page.getByTestId('intake-form');
  await expect(card).toContainText(`No intake form for ${Number(season) - 2} yet.`);
  await expect(card.getByRole('link', { name: 'Send an Intake Form' })).toBeVisible();
});
