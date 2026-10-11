import { expect, test } from '@playwright/test';
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/workspaces`;
for (const width of [375, 768, 1024, 1440]) {
  test(`workspaces list and detail fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/0199b6a2-0000-7000-8000-000000000002`);
    await expect(page.getByTestId('workspace-detail')).toBeVisible();
    await expect(page.getByTestId('workspace-reports')).toContainText('Reports');
    await expect(page.getByTestId('workspace-documents')).toContainText('Business_Expenses_Q3.pdf');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
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
