import { expect, test } from '@playwright/test';

// Settings > Workflow & Automations (/settings/workflow), in mock mode (playwright.mock.config.ts), signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('shows the return statuses and appointment types', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/workflow`);
  await expect(page).toHaveTitle('Workflow & automations');
  await expect(page.getByTestId('workflow-statuses').getByRole('listitem').first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('workflow-types')).toContainText('minutes');
  await expect(page.getByRole('link', { name: 'Open Automations' })).toHaveAttribute(
    'href',
    '/modules/automations',
  );
});
