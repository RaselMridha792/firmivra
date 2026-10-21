import { expect, test } from '@playwright/test';

// R56: Tax Planning & Strategy in mock mode (every module on mock data, as an Owner): ten
// clients, six plans, eighteen opportunities and twelve library strategies.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/tax-planning`;

test('Overview: four KPIs, quick actions, recent clients, top opportunities, deadlines and resources', async ({
  page,
}) => {
  await page.goto(base);
  await expect(
    page.getByRole('heading', { name: 'Tax Planning & Strategy', level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId('tp-kpis').getByRole('listitem')).toHaveCount(4);
  await expect(
    page.getByRole('tablist', { name: 'Tax planning views' }).getByRole('tab'),
  ).toHaveCount(7);
  await expect(page.getByTestId('quick-actions').getByRole('link')).toHaveCount(4);
  await expect(page.getByTestId('recent-clients').getByTestId('client-link')).toHaveCount(5);
  await expect(
    page.getByTestId('top-opportunities').getByRole('link', { name: 'Review' }),
  ).toHaveCount(5);
  await expect(page.getByTestId('deadlines')).toContainText('Estimated Tax');
  await expect(page.getByTestId('resources')).toContainText('Checklist');
  await expect(page.getByTestId('disclaimer')).toContainText('Actual results may vary');
});

test('Lists: clients, strategies, calendar, resources and the savings report', async ({ page }) => {
  await page.goto(`${base}/clients`);
  await expect(page.getByTestId('tp-clients')).toContainText('Sarah Mitchell');
  await page.getByTestId('tp-clients').getByLabel('Search clients').fill('turner');
  await expect(page.getByTestId('tp-clients')).toContainText('Turner Group');
  await page.goto(`${base}/strategies`);
  await page.getByRole('button', { name: 'New Strategy' }).click();
  await page.getByTestId('strategy-dialog').getByLabel('Name').fill('Cost Segregation Study');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Strategy' }).click();
  await expect(page.getByTestId('tp-library')).toContainText('Cost Segregation Study');
  await page.goto(`${base}/calendar`);
  await expect(page.getByTestId('tp-calendar')).toContainText('Q4 Estimated Tax Payment Due');
  await page.goto(`${base}/resources`);
  await page.getByRole('button', { name: 'Send to Client' }).first().click();
  await page.getByTestId('send-resource').getByLabel('Client').selectOption({ index: 1 });
  await page.getByRole('dialog').getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Resource sent.')).toBeVisible();
  await page.goto(`${base}/reports`);
  await expect(page.getByTestId('tp-reports')).toContainText('Projected Savings by Plan');
});

test('Opportunities: filter the queue and review one: discussion, document, plan', async ({
  page,
}) => {
  await page.goto(`${base}/opportunities`);
  await expect(page.getByTestId('opp-link').first()).toBeVisible();
  await page.getByLabel('Priority').selectOption('HIGH');
  await expect(page.getByTestId('opp-link').first()).toBeVisible();
  await page.getByTestId('opp-link').first().click();
  await expect(page.getByTestId('opp-detail')).toBeVisible();
  await expect(page.getByTestId('estimate')).toContainText('Estimated Tax Savings');
  await page.getByRole('button', { name: 'Schedule Client Discussion' }).click();
  await page.getByTestId('action-dialog').getByLabel('Date').fill('2026-12-01');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Schedule Client Discussion' })
    .click();
  await expect(page.getByText('Discussion scheduled.')).toBeVisible();
  await page.getByTestId('add-to-plan').getByRole('button', { name: 'Add to Plan' }).click();
  await expect(page.getByText('Added to the plan.')).toBeVisible();
  await expect(page.getByTestId('opp-history')).toContainText('plan');
});

test('Opportunity: dismissing needs a reason', async ({ page }) => {
  await page.goto(`${base}/opportunities`);
  await page.getByTestId('opp-link').nth(1).click();
  await page.getByRole('button', { name: 'Dismiss Opportunity' }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Dismiss Opportunity' }),
  ).toBeDisabled();
  await page.getByTestId('action-dialog').getByLabel('Reason').fill('Not a fit for this client');
  await page.getByRole('dialog').getByRole('button', { name: 'Dismiss Opportunity' }).click();
  await expect(page.getByText('Dismissed.')).toBeVisible();
});

test('Plan: create it, enter figures, override an estimate, finalize it', async ({ page }) => {
  await page.goto(`${base}/plans/new`);
  await page
    .getByTestId('step-client')
    .getByLabel('Client')
    .selectOption({ label: 'Marcus Johnson' });
  await expect(page.getByTestId('client-card')).toContainText('Marcus Johnson');
  await page.getByLabel('Plan Name').fill('2026 Plan - Marcus');
  await page.getByTestId('step-goals-box').getByLabel('Reduce taxable income').check();
  await page.getByTestId('step-strategies-box').getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Next', exact: true }).first().click();
  await page.waitForURL(/\/edit\/financials$/);
  await expect(page.getByTestId('step-financial')).toBeVisible();
  // A new plan is for this year; the wizard asks for it and the year before.
  const year = new Date().getFullYear();
  await page.getByLabel(`Wages & Salary ${year - 1}`).fill('90000');
  await page.getByLabel(`Wages & Salary ${year}`).fill('95000');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.waitForURL(/\/edit\/goals$/);
  await expect(page.getByTestId('plan-strategy')).toHaveCount(1);
  await page.getByRole('button', { name: 'Override estimate' }).click();
  await page.getByTestId('override-dialog').getByLabel('Estimated savings ($)').fill('4000');
  await page
    .getByTestId('override-dialog')
    .getByLabel('Reason')
    .fill('Client confirmed the contribution');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Override' }).click();
  await expect(page.getByTestId('projected')).toContainText('$4,000');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.waitForURL(/\/edit\/implementation$/);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.waitForURL(/\/edit\/review$/);
  await expect(page.getByTestId('review-total')).toContainText('$4,000');
  await page.getByRole('button', { name: 'Finalize Plan' }).click();
  await expect(page.getByText('Plan finalized.')).toBeVisible();
  await expect(page.getByTestId('step-review')).toContainText('Version 2');
});

test('Calculator: a scenario is calculated with its assumptions, then saved', async ({ page }) => {
  await page.goto(`${base}/calculator`);
  await page.getByLabel('Wages & salary').fill('120000');
  await page.getByLabel('Retirement contribution').fill('10000');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByTestId('saving')).toBeVisible();
  await expect(page.getByTestId('calc-result')).toContainText('Federal income tax only');
  await page.getByRole('button', { name: 'Save Scenario' }).click();
  await expect(page.getByText('Scenario saved.')).toBeVisible();
  await expect(page.getByTestId('scenarios')).toContainText('Scenario');
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  for (const path of [
    '',
    '/clients',
    '/opportunities',
    '/strategies',
    '/calendar',
    '/resources',
    '/reports',
    '/calculator',
    '/plans/new',
  ]) {
    await page.goto(`${base}${path}`);
    await page.waitForTimeout(700);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  }
});
