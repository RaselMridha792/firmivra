import { expect, test } from '@playwright/test';

// Settings > Billing & Subscriptions (/settings/billing), in mock mode (playwright.mock.config.ts),
// signed in as the Owner. Octavia's Billing guide of Oct 18: the firm's plan, usage, billing
// details and invoices, and plan or contact changes as requests to Firmivra. The mock keeps its
// data in the page. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const billing = `http://app.localhost:${port}/settings/billing`;

test('shows the plan, the usage, the billing details and the invoices, and opens one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(billing);
  await expect(page).toHaveTitle('Billing & subscriptions');
  const plan = page.getByTestId('billing-plan');
  await expect(plan).toContainText('Team Pro', { timeout: 60_000 });
  await expect(plan).toContainText('Active');
  await expect(plan).toContainText('Next billing date: Nov 18, 2026');
  const usage = page.getByTestId('billing-usage');
  await expect(usage).toContainText('8 / 10');
  await expect(usage).toContainText('1 / 2');
  await expect(page.getByTestId('billing-details')).toContainText('Sample Billing Contact');
  await expect(page.getByTestId('billing-details')).toContainText('100 Sample Road');
  await expect(page.getByTestId('billing-method')).toContainText('No payment method on file');
  await expect(page.getByTestId('billing-method')).toContainText(
    'Last payment: Credit Card, $99.00 on Oct 18, 2026 (INV-1026)',
  );

  const invoices = page.getByRole('table', { name: 'Subscription invoices' });
  await expect(invoices.getByRole('row')).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'Download INV-1026 as PDF' })).toHaveAttribute(
    'href',
    /\/api\/v1\/business\/billing\/invoices\/.+\/pdf$/,
  );
  await page.getByRole('button', { name: 'View INV-1026' }).click();
  const view = page.getByRole('dialog', { name: 'Invoice INV-1026' });
  await expect(view).toContainText('Team Pro (Monthly)');
  await expect(view).toContainText('Balance due');
  await view.getByRole('button', { name: 'Close', exact: true }).click();

  await plan.getByRole('button', { name: 'View plan details' }).click();
  const details = page.getByRole('dialog', { name: 'Team Pro' });
  await expect(details).toContainText('$99.00/month');
  await expect(details).toContainText('Client portal');
  await details.getByRole('button', { name: 'Close', exact: true }).click();

  await expect(page.getByRole('link', { name: 'Payments & Payouts' })).toHaveAttribute(
    'href',
    '/settings/payments',
  );
});

test('asks to upgrade: the plan catalog, what blocks a plan, the review, the request status', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(billing);
  const plan = page.getByTestId('billing-plan');
  await plan.getByRole('button', { name: 'Upgrade Plan' }).click({ timeout: 60_000 });
  const change = page.getByRole('dialog', { name: 'Change Your Firmivra Plan' });
  // Solo Core cannot hold today's staff users: it says why and cannot be chosen.
  const solo = change.getByTestId('plan-SOLO_CORE');
  await expect(solo).toContainText('8 active staff users; Solo Core allows 2');
  await expect(solo.getByRole('button', { name: 'Select Solo Core' })).toBeDisabled();
  await expect(change.getByTestId('plan-TEAM_PRO')).toContainText('Current plan');
  await change.getByRole('button', { name: 'Select Practice Plus' }).click();

  const review = page.getByRole('dialog', { name: 'Review Plan Change' });
  await expect(review).toContainText('Team Pro, $99.00/month');
  await expect(review).toContainText('Practice Plus, Monthly');
  await review.getByRole('button', { name: 'Send Request' }).click();
  await expect(review).toBeHidden();
  await expect(page.getByText('Request #1011 sent to Firmivra')).toBeVisible();
  const status = page.getByTestId('billing-request-plan_change');
  await expect(status).toContainText('Submitted');
  await expect(status).toContainText('Plan change: Team Pro to Practice Plus (Monthly)');
  // The plan itself is unchanged until Firmivra applies it.
  await expect(plan).toContainText('Team Pro · $99.00/month');
});

test('asks Firmivra for a new billing contact', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(billing);
  await page
    .getByTestId('billing-details')
    .getByRole('button', { name: 'Edit Billing Details' })
    .click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: 'Edit Billing Details' });
  await expect(dialog.getByLabel('Billing contact email')).toHaveValue('billing@lvp.test');
  // Nothing changed: the request names nothing new.
  await dialog.getByRole('button', { name: 'Send Request' }).click();
  await expect(dialog).toContainText('Enter a new contact name or email');
  await dialog.getByLabel('Billing contact email').fill('payables@lvp.test');
  await dialog.getByRole('button', { name: 'Send Request' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('billing-request-billing_contact')).toContainText(
    'Billing contact change',
  );
});
