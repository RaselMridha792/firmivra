// R55, Client Portal Review One BA-CP: the client's Business Advisory under My Services. Reached
// from the advisory service's card; only what the firm marked for the client (delivered plans
// read-only, recommendations shown, tasks not hidden, resources sent, advisory files shared); a
// plan that isn't the client's is the not-found state. Mock mode, as client Jamie. Synthetic data.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('BA-CP: My Services opens Business Advisory, which shows only what the firm shared', async ({
  page,
}) => {
  await page.goto(portal('/lvp/services'));
  await page.getByRole('tab', { name: /^Recurring/ }).click();
  await page.getByTestId('service-advisory-link').click();
  await expect(page).toHaveURL(portal('/lvp/services/advisory'), { timeout: 60_000 });
  await expect(page).toHaveTitle('Business Advisory');

  await expect(page.getByTestId('advisory-summary')).toContainText('Sample Bakery LLC');
  await expect(page.getByTestId('advisory-summary')).toContainText('Your advisor: Olivia Owner');
  const plans = page.getByTestId('advisory-plan-row');
  await expect(plans).toHaveCount(2);
  await expect(plans.first()).toContainText('2026 Growth Plan (sample)');
  await expect(plans.first()).toContainText('Version 2');
  await expect(plans.first()).toContainText('Delivered');
  await expect(plans.nth(1)).toContainText('The firm is preparing a new version');

  const recs = page.getByTestId('advisory-recommendation');
  await expect(recs).toHaveCount(2);
  await expect(recs.first()).toContainText('Apply for an SBA 7(a) loan');
  await expect(recs.nth(1)).toContainText('Expected: +8% Profit');
  const tasks = page.getByTestId('advisory-task');
  await expect(tasks.first()).toContainText('Overdue');
  await expect(tasks.first()).toContainText('For you');
  await expect(tasks.nth(1)).toContainText('Your firm is on it');
  await expect(page.getByTestId('advisory-resource')).toContainText('Funding Readiness Checklist');
  await expect(page.getByTestId('advisory-files')).toContainText('Second shop budget (sample).pdf');
  await expect(page.getByTestId('advisory-disclaimer')).toContainText('not guarantees');
  // Nothing on the page edits anything.
  await expect(page.getByRole('textbox')).toHaveCount(0);
  // My Services stays the lit menu line.
  await expect(page.getByRole('link', { name: 'My Services' }).first()).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('BA-CP: a delivered plan opens read-only at the version delivered', async ({ page }) => {
  await page.goto(portal('/lvp/services/advisory'));
  await page
    .getByTestId('advisory-plan-row')
    .filter({ hasText: '2026 Growth Plan (sample)' })
    .getByRole('link')
    .click();
  await expect(page.getByTestId('page-title')).toHaveText('2026 Growth Plan (sample)', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('read-only-note')).toHaveText(
    'Read-only: version 2, exactly as your firm delivered it.',
  );
  await expect(page.getByTestId('plan-summary')).toContainText('Open a second location');
  await expect(page.getByTestId('plan-focus')).toContainText('Expansion');
  await expect(page.getByTestId('plan-goals')).toContainText('Sign a lease for the second shop');
  await expect(page.getByTestId('plan-recommendations')).toContainText(
    'Apply for an SBA 7(a) loan',
  );
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('link', { name: '← Business Advisory' }).click();
  await expect(page).toHaveURL(portal('/lvp/services/advisory'));
});

test("BA-CP: a plan that isn't the client's shows the not-found state", async ({ page }) => {
  await page.goto(portal('/lvp/services/advisory/plans/0199d600-0000-7000-8000-000000000003'));
  await expect(page.getByTestId('page-not-found')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('page-title')).toHaveCount(0);
});
