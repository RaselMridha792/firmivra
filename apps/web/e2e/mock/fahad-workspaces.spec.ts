import { expect, test } from '@playwright/test';
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/workspaces`;
test('manual workspaces preview', async ({ page }) => {
  test.skip(process.env['FAHAD_MANUAL'] !== '1', 'Opt-in manual preview');
  test.setTimeout(0);
  await page.setViewportSize({ width: Number(process.env['FAHAD_WIDTH'] ?? 1440), height: 1000 });
  await page.goto(base);
  await expect(page.getByTestId('workspaces-screen')).toBeVisible();
  await page.pause();
});
for (const width of [375, 768, 1024, 1440]) {
  test(`workspaces list and detail fit ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base);
    const list = page.getByTestId(width < 768 ? 'workspace-cards' : 'workspace-table');
    await expect(list).toContainText('Bookkeeping (Growth)');
    await list.getByRole('link', { name: 'Bookkeeping (Growth)', exact: true }).click();
    await expect(page.getByTestId('workspace-detail')).toBeVisible();
    await expect(page.getByTestId('workspace-reports')).toContainText('Reports');
    await expect(page.getByTestId('workspace-documents')).toContainText('Business_Expenses_Q3.pdf');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`workspace-${width}.png`), fullPage: true });
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
  await page.getByLabel('Summary (optional)', { exact: true }).fill('Quarterly accounts reconciled.');
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
  await expect(report).toContainText('Published');
});
