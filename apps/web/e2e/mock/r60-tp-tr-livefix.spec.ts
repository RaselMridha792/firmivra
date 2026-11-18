// R60, R61's live-check FAILs (Nov 18): Tax Planning C18 (its reports open in Reports) and the
// plan steps at 390 px, and Tax Returns F20b (a refused paper filing names the API's reason and
// its blockers). Tax Returns ACC-DOC is unit-tested (checklist-filter.test.ts). Mock mode, as an
// Owner, with the mock refusing what the API refuses. Synthetic data only.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('C18: the Tax Planning reports open in Reports, without a comparison their data cannot make', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const key of ['tax_plan_savings', 'tax_plans_by_status']) {
    await page.goto(app(`/reports/${key}?from=${encodeURIComponent('/tax-planning/reports')}`));
    await expect(page.getByTestId('report-table')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('This report is not available')).toHaveCount(0);
  }
});

test('390 px: no plan step scrolls sideways', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-planning/clients'));
  await page.getByTestId('tp-clients').getByLabel('Search clients or plans').fill('Sarah');
  await page
    .getByRole('link', { name: `${new Date().getFullYear()} Tax Plan` })
    .first()
    .click();
  await expect(page).toHaveURL(/\/tax-planning\/plans\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const plan = /\/tax-planning\/plans\/([0-9a-f-]{36})/.exec(page.url())![1];
  await page.setViewportSize({ width: 390, height: 844 });
  for (const step of ['', '/financials', '/goals', '/implementation', '/review']) {
    await page.goto(app(`/tax-planning/plans/${plan}/edit${step}`));
    await expect(page.getByRole('navigation', { name: 'Plan steps' })).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), {
        message: `step ${step || '/'}`,
      })
      .toBeLessThanOrEqual(0);
  }
});

test('F20b: Record Paper Filing with an open Error says the reason and its blockers, and keeps the dialog open', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns'));
  await page
    .getByTestId('tr-filters')
    .getByLabel('Status', { exact: true })
    .selectOption('READY_FOR_REVIEW');
  await page.getByTestId('return-link').first().click();
  await expect(page.getByTestId('return-workspace')).toBeVisible({ timeout: 60_000 });
  // An open Error issue, raised by Return to Preparer.
  await page.getByRole('tab', { name: 'Review' }).click();
  await page
    .getByTestId('approvals')
    .getByRole('button', { name: 'Return to Preparer' })
    .first()
    .click();
  const back = page.getByRole('dialog', { name: 'Return to Preparer' });
  await back.getByLabel('Review note for the preparer').fill('A schedule to fix (fake)');
  await back.getByLabel('Raise a validation issue').check();
  const fields = back.getByTestId('issue-fields');
  await fields.getByLabel('Issue', { exact: true }).fill('Box 1 does not match (fake)');
  await fields.getByLabel('Version (draft return)').selectOption({ index: 1 });
  await fields.getByLabel('Checklist line').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Return to Preparer', exact: true }).last().click();
  await expect(back).toBeHidden();

  // A paper filing, refused while the Error is open.
  await page.getByRole('tab', { name: 'E-File' }).click();
  const efile = page.getByTestId('efile');
  await efile.getByRole('button', { name: 'Jurisdictions' }).click();
  await page.getByLabel('Federal filing method').selectOption('PAPER');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await efile.getByTestId('filing-US').getByRole('button', { name: 'Record Paper Filing' }).click();
  const paper = page.getByTestId('paper-dialog');
  await paper.getByLabel('Mail Tracking Number').fill('FAKE 9400 0002');
  await paper.getByLabel('Date mailed *').fill('2026-11-02');
  await page.getByRole('dialog').getByRole('button', { name: 'Record' }).click();
  await expect(
    page.getByText(
      'Resolve the validation errors first. Still to do: Resolve the open validation errors.',
    ),
  ).toBeVisible();
  await expect(page.getByText('This return cannot move there yet')).toHaveCount(0);
  await expect(paper).toBeVisible();
});
