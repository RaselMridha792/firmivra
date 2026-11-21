import { expect, test } from '@playwright/test';

// R55, Leads Review Two 17: the campaign a lead came from goes with it to the client. The screen
// names the choice "Source / campaign attribution": ticked by default, kept to the review, and
// sent with the conversion. Mock mode (playwright.mock.config.ts) as the Owner, on Bruno Sandoval.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const lead = `http://app.localhost:${port}/leads/0199c0c0-0a00-7000-8000-000000000003`;

test('Source / campaign attribution is carried by default and shown on the review', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${lead}/convert/portal`);
  const carry = page.getByTestId('convert-lead-carry-over');
  await expect(
    carry.getByRole('checkbox', { name: 'Source / campaign attribution' }),
  ).toBeChecked();
  await page.getByRole('button', { name: /Review & Continue/ }).click();
  await expect(page).toHaveURL(`${lead}/convert/review`);
  const choices = page.getByTestId('convert-lead-review-selections');
  await expect(
    choices.getByRole('img', { name: 'Selected: Source / campaign attribution' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Convert to Client/ }).click();
  await expect(page).toHaveURL(`${lead}/convert/done`);
});

test('turning Source / campaign attribution off shows it as not selected on the review', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${lead}/convert/portal`);
  await page
    .getByTestId('convert-lead-carry-over')
    .getByRole('checkbox', { name: 'Source / campaign attribution' })
    .uncheck();
  await page.getByRole('button', { name: /Review & Continue/ }).click();
  await expect(
    page
      .getByTestId('convert-lead-review-selections')
      .getByRole('img', { name: 'Not selected: Source / campaign attribution' }),
  ).toBeVisible();
});
