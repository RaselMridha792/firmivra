import { expect, test } from '@playwright/test';

// SH9 (Octavia's Oct 25 review: PY-F12; BK-D07): the plan is chosen from Services & Pricing (the
// module's own services, by id), never typed, and says that choosing bills nothing. Mock mode.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-9c00-7000-8000-000000000001';

test('Payroll settings: Plan or service lists the payroll services of Services & Pricing', async ({
  page,
}) => {
  await page.goto(`${app}/payroll/clients/${GREEN}?tab=settings`);
  const plan = page.getByLabel('Plan or service');
  await expect(plan).toBeEnabled();
  await expect(plan.locator('option')).not.toHaveCount(1);
  await expect(
    page.getByText('From Services & Pricing. Choosing a plan does not bill the client.'),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Plan or service' })).toHaveCount(0);
  // The client's saved plan is not a catalog service: it shows as such, and cannot be chosen.
  await expect(plan.locator('option:checked')).toHaveText(/\(not in Services & Pricing\)$/);
  const count = await plan.locator('option').count();
  const last =
    (await plan
      .locator('option')
      .nth(count - 1)
      .textContent()) ?? '';
  await plan.selectOption({ index: count - 1 });
  await expect(plan.locator('option:checked')).toHaveText(last);
});

test('Bookkeeping: Add Client and the Plan Type filter offer the bookkeeping services', async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping`);
  const filter = page.getByLabel('Plan Type');
  await expect(filter.locator('option')).not.toHaveCount(1);
  await page.getByRole('button', { name: 'Add Client' }).first().click();
  const plan = page.getByRole('dialog').getByLabel('Plan', { exact: true });
  await expect(plan.locator('option')).not.toHaveCount(1);
  await expect(
    page.getByRole('dialog').getByText(/Choosing a plan does not bill the client/),
  ).toBeVisible();
});
