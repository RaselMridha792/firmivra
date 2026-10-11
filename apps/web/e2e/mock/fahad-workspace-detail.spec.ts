import { expect, test } from '@playwright/test';
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/workspaces`;
for (const width of [375, 768, 1024, 1440]) {
  test(`workspaces list and detail fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/0199b6a2-0000-7000-8000-000000000002`);
    await expect(page.getByTestId('workspace-detail')).toBeVisible();
    await expect(page.getByTestId('workspace-reports')).toContainText('Reports');
    await expect(page.getByTestId('workspace-documents')).toContainText('Business_Expenses_Q3.pdf');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width === 375 || width === 1440)
      await page.screenshot({
        path: testInfo.outputPath(`workspace-${width}.png`),
        fullPage: true,
      });
  });
}
test('workspace task, note and report creation with publish', async ({ page }) => {
  await page.goto(`${base}/0199b6a2-0000-7000-8000-000000000002`);
  await page.getByLabel('New task', { exact: true }).fill('Reconcile quarterly bank statements');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByTestId('workspace-tasks')).toContainText(
    'Reconcile quarterly bank statements',
  );
  await page
    .getByRole('button', { name: 'Complete Reconcile quarterly bank statements', exact: true })
    .click();
  await expect(
    page
      .getByTestId('workspace-tasks')
      .getByRole('listitem')
      .filter({ hasText: 'Reconcile quarterly bank statements' }),
  ).toContainText('DONE');
  await page.getByLabel('Internal note', { exact: true }).fill('Quarterly review completed.');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.getByTestId('workspace-notes')).toContainText('Quarterly review completed.');
  await page.getByLabel('Report title', { exact: true }).fill('Quarterly reconciliation report');
  await page
    .getByLabel('Summary (optional)', { exact: true })
    .fill('Quarterly accounts reconciled.');
  await page.getByRole('button', { name: 'Create report', exact: true }).click();
  const report = page
    .getByTestId('workspace-reports')
    .getByRole('listitem')
    .filter({ hasText: 'Quarterly reconciliation report' });
  await expect(report).toContainText('Draft');
  await expect(report).toContainText('Quarterly accounts reconciled.');
  await report
    .getByRole('button', { name: 'Publish Quarterly reconciliation report', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('visible to the client');
  await expect(report).toContainText('Draft');
  await page.getByRole('button', { name: 'Confirm publish', exact: true }).click();
  await expect(report).toContainText('Published');
  await report
    .getByRole('button', { name: 'Unpublish Quarterly reconciliation report', exact: true })
    .click();
  await page.getByRole('button', { name: 'Confirm unpublish', exact: true }).click();
  await expect(report).toContainText('Draft');
});

test('draft report edits retain cents and deletion requires confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.goto(`${base}/0199b6a2-0000-7000-8000-000000000002`);
  await page.getByLabel('Report title', { exact: true }).fill('Editable reconciliation');
  await page.getByRole('button', { name: 'Add figure', exact: true }).click();
  await page.getByLabel('Figure label 1', { exact: true }).fill('Adjustment');
  await page.getByLabel('Amount 1 (USD, optional)', { exact: true }).fill('-123.45');
  await page.getByRole('button', { name: 'Create report', exact: true }).click();
  const report = page
    .getByTestId('workspace-reports')
    .getByRole('listitem')
    .filter({ hasText: 'Editable reconciliation' });
  await expect(report).toContainText('-$123.45');
  await report.getByRole('button', { name: 'Edit Editable reconciliation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit draft report' });
  await expect(dialog.getByLabel('Amount 1 (USD, optional)', { exact: true })).toHaveValue(
    '-123.45',
  );
  await dialog.getByLabel('Period (optional)', { exact: true }).fill('October 2026');
  await dialog.getByRole('button', { name: 'Save report', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(report).toContainText('October 2026');
  await expect(report).toContainText('-$123.45');
  await report.getByRole('button', { name: 'Delete Editable reconciliation', exact: true }).click();
  await page.getByRole('button', { name: 'Keep draft', exact: true }).click();
  await expect(report).toBeVisible();
  await report.getByRole('button', { name: 'Delete Editable reconciliation', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(report).toHaveCount(0);
});

test('previously published reports cannot be deleted after unpublish', async ({ page }) => {
  await page.goto(`${base}/0199b6a2-0000-7000-8000-000000000002`);
  const report = page
    .getByTestId('workspace-reports')
    .getByRole('listitem')
    .filter({ hasText: 'September close' });
  await expect(
    report.getByRole('button', { name: 'Delete September close', exact: true }),
  ).toHaveCount(0);
  await report.getByRole('button', { name: 'Unpublish September close', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm unpublish', exact: true }).click();
  await expect(report).toContainText('Draft');
  await expect(
    report.getByRole('button', { name: 'Delete September close', exact: true }),
  ).toHaveCount(0);
});
for (const width of [375, 768, 1024, 1440]) {
  test(`workspace detail fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://app.localhost:${port}/workspaces/0199b6a2-0000-7000-8000-000000000002`);
    await expect(page.getByTestId('workspace-detail')).toBeVisible();
    await expect(page.getByTestId('workspace-tasks')).toContainText(
      'Reconcile September bank statement',
    );
    await expect(page.getByTestId('workspace-documents')).toContainText('Business_Expenses_Q3.pdf');
    await expect(page.getByTestId('workspace-reports')).toContainText('September close');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('completed workspaces prevent task and report changes', async ({ page }) => {
  await page.goto(base);
  await page.getByLabel('Status', { exact: true }).selectOption('COMPLETED');
  await page.getByRole('link', { name: '2025 Tax Planning', exact: true }).first().click();
  await expect(page.getByLabel('Stage', { exact: true })).toBeDisabled();
  await expect(page.getByTestId('workspace-task-form')).toHaveCount(0);
  await expect(page.getByTestId('workspace-report-form')).toHaveCount(0);
  await expect(
    page.getByTestId('workspace-tasks').getByRole('button', { name: /^Complete / }),
  ).toHaveCount(0);
  await expect(page.getByTestId('workspace-notes')).toBeVisible();
});

test('report figures validate, support negative amounts and remove attachments', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.goto(`${base}/0199b6a2-0000-7000-8000-000000000002`);
  await page.getByLabel('Report title', { exact: true }).fill('Quarterly adjustment');
  await page.getByRole('button', { name: 'Add figure', exact: true }).click();
  await page.getByLabel('Figure label 1', { exact: true }).fill('Refund adjustment');
  await page.getByLabel('Amount 1 (USD, optional)', { exact: true }).fill('abc');
  await page.getByRole('button', { name: 'Create report', exact: true }).click();
  await expect(
    page.getByText('Enter an amount with at most two decimal places, within the supported limit.'),
  ).toBeVisible();
  await page.getByLabel('Amount 1 (USD, optional)', { exact: true }).fill('-123.45');
  await page.getByLabel('Figure note 1 (optional)', { exact: true }).fill('Credit carried forward');
  await page.getByRole('button', { name: 'Add figure', exact: true }).click();
  await page.getByRole('button', { name: 'Remove figure 2', exact: true }).click();
  const attach = page
    .getByTestId('report-document-picker')
    .getByRole('button', { name: /^Attach / })
    .first();
  await attach.click();
  await expect(page.getByTestId('report-selected-document')).toBeVisible();
  await page.getByTestId('report-selected-document').click();
  await expect(page.getByTestId('report-selected-document')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create report', exact: true }).click();
  const report = page
    .getByTestId('workspace-reports')
    .getByRole('listitem')
    .filter({ hasText: 'Quarterly adjustment' });
  await expect(report).toContainText('-$123.45');
  await expect(report).toContainText('Credit carried forward');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
