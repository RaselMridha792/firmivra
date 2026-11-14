import { expect, test } from '@playwright/test';

// R55, Leads Review Two (Octavia, Nov 8) R2 17: Settings > Lead assignment. Ordered rules with
// conditions, an assignee and a fallback; the preview says where a lead would go before saving. In
// mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('adds a rule, previews where a lead goes, and saves', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/lead-routing`);
  const screen = page.getByTestId('lead-routing');
  await expect(screen.getByRole('heading', { name: 'Lead assignment' })).toBeVisible();
  const preview = screen.getByTestId('routing-preview');
  await expect(preview).toContainText('Rules are off');

  await screen.getByRole('switch', { name: 'Assign new leads by these rules' }).click();
  await screen.getByLabel('When no rule matches, assign to').selectOption({ label: 'Theo Grant' });
  await screen.getByRole('button', { name: 'Add Rule' }).click();
  // Required: a name and an assignee.
  await screen.getByTestId('routing-save').click();
  await expect(screen).toContainText('Name the rule');

  const rule = screen.getByTestId('routing-rule');
  await rule.getByLabel('Rule name').fill('Referrals to Hana');
  await rule.getByLabel('Assign to').selectOption({ label: 'Hana Kim' });
  await rule.getByRole('group', { name: 'Source' }).getByLabel('Referral').check();

  await preview.getByLabel('Source').selectOption({ label: 'Referral' });
  await expect(preview).toContainText('Goes to Hana Kim, by the rule "Referrals to Hana"');
  await preview.getByLabel('Source').selectOption({ label: 'Walk In' });
  await expect(preview).toContainText('goes to Theo Grant (fallback)');

  await screen.getByTestId('routing-save').click();
  await expect(screen.getByRole('status').filter({ hasText: 'saved' })).toContainText(
    'Lead assignment saved.',
  );
});
