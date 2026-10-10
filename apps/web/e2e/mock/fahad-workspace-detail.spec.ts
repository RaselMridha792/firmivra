import { expect, test } from '@playwright/test';
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
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
