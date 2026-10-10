import { expect, test, type Page } from '@playwright/test';

// Settings > Terms & Privacy > Intake agreements in mock mode, as an owner. The mock has the
// firm-wide sample agreement (versions 1 and 2, three boxes in version 2) and one for the
// Bookkeeping service. Synthetic text only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function openAgreements(page: Page) {
  await page.goto(app('/settings/legal'));
  await expect(page.getByTestId('page-title')).toHaveText('Terms & Privacy');
  await page.getByRole('tab', { name: 'Intake agreements' }).click();
}

test('an owner lists the agreements and reads the current and an older version', async ({
  page,
}) => {
  await openAgreements(page);
  const agreements = page.getByTestId('agreement');
  await expect(agreements).toHaveCount(2);
  await expect(agreements.first()).toContainText('Client Intake Agreement (sample)');
  await expect(agreements.first()).toContainText('Firm-wide');
  await expect(agreements.first()).toContainText('Version 2');
  await expect(agreements.nth(1)).toContainText('Service: Bookkeeping');

  await agreements.first().getByRole('button', { name: /^Open/ }).click();
  const boxes = page.getByRole('list', { name: 'Boxes the signer ticks' }).first();
  await expect(boxes.getByRole('listitem')).toHaveCount(3);
  await expect(boxes).toContainText('Optional');

  await page.getByRole('button', { name: 'View version 1' }).click();
  await expect(page.getByRole('dialog')).toContainText('I have read the agreement');
  await expect(page.getByRole('dialog')).not.toContainText('My information is accurate');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '← All agreements' }).click();
  await expect(agreements).toHaveCount(2);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});
