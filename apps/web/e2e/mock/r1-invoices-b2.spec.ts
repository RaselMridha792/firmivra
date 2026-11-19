import { expect, test, type Locator } from '@playwright/test';

// R1, Invoices Review 2 batch 2 (the lead's list): the list's badges, Preview, the Invoice
// Templates link, Create Task / Schedule Follow-Up context, Send Receipt, the Payment Method filter,
// the Tipping label and the header Service from the whole catalog.
// Mock mode as the Owner; synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 240_000 });

/** The first badge in the list with this exact label. */
const badge = (list: Locator, label: string) =>
  list
    .locator('span.rounded-pill')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first();
/** A badge's background class, as a whole class name (`bg-navy`, never `bg-navy-soft`). */
const tone = (cls: string) => new RegExp(`(^|\\s)${cls}(\\s|$)`);

test('I-N07: Overdue and Canceled, Due Today and Partially Paid, Scheduled and Sent read apart', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  const main = page.locator('main');
  const table = main.getByRole('table');
  await expect(badge(table, 'Scheduled')).toBeVisible({ timeout: 60_000 });
  // Review Two: each pair differs in colour (R55, the two new tones), and by icon too.
  await expect(badge(table, 'Scheduled')).toHaveClass(tone('bg-teal-soft'));
  await expect(badge(table, 'Sent')).toHaveClass(tone('bg-info-soft'));
  await expect(badge(table, 'Scheduled').locator('svg')).toHaveCount(1);
  await expect(badge(table, 'Sent').locator('svg')).toHaveCount(1);
  // The status filter shows the others.
  const status = main.getByLabel('Status', { exact: true });
  await status.selectOption({ label: 'Overdue' });
  await expect(badge(table, 'Overdue')).toHaveClass(tone('bg-danger-soft'));
  await status.selectOption({ label: 'Canceled' });
  // Solid navy: apart from Overdue's red and Draft's grey (I-C11).
  await expect(badge(table, 'Canceled')).toHaveClass(tone('bg-navy'));
  await expect(badge(table, 'Canceled').locator('svg')).toHaveCount(1);
  await status.selectOption({ label: 'Draft' });
  await expect(badge(table, 'Draft')).toHaveClass(tone('bg-disabled'));
});

test('I-P03: Record Payment starts with Send receipt ticked, and it can be unticked', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // INV-2026-0101, sent and unpaid.
  await page.goto(app('/invoices/record-payment?invoice=0199b6e1-0000-7000-8000-000000000001'));
  const receipt = page.getByLabel('Send receipt to client');
  await expect(receipt).toBeChecked({ timeout: 60_000 });
  await receipt.uncheck();
  await expect(receipt).not.toBeChecked();
});

test('I-N09: Invoice Templates opens the invoice templates, and Back returns to Invoices', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  await page.getByRole('link', { name: 'Invoice Templates' }).click({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/settings\/payments\?from=%2Finvoices#invoice-templates$/, {
    timeout: 60_000,
  });
  await expect(page.getByRole('region', { name: 'Invoice templates' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('back-to-origin')).toHaveText('Back to Invoices & Payments');
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(/\/invoices$/, { timeout: 60_000 });
});

test('I-N08: Preview opens the invoice on screen, from the list and from the invoice', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  await page.getByRole('button', { name: 'Actions for INV-2026-0106' }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Preview Invoice' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invoice preview' });
  await expect(dialog.getByTestId('invoice-preview')).toContainText('INV-2026-0106');
  await expect(dialog.getByTestId('invoice-preview')).toContainText('Monthly bookkeeping, October');
  await expect(page).toHaveURL(/\/invoices$/);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();

  await page.goto(app('/invoices/0199b6e1-0000-7000-8000-000000000001'));
  await page.getByRole('button', { name: 'Preview' }).click({ timeout: 60_000 });
  await expect(
    page.getByRole('dialog', { name: 'Invoice preview' }).getByTestId('invoice-preview'),
  ).toContainText('INV-2026-0101');
});

test('I-P01/I-P02: Create Task and Schedule Follow-Up open with the invoice’s client filled in', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  await page.getByRole('button', { name: 'Actions for INV-2026-0106' }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Create Task' }).click();
  await expect(page).toHaveURL(/\/tasks\/new\?/, { timeout: 60_000 });
  // The client, and the invoice it is about.
  await expect(page.getByLabel('Task Name *')).toHaveValue('Follow up on INV-2026-0106', {
    timeout: 60_000,
  });
  await expect(page.locator('main')).toContainText('Jamie Sample');
  await expect(page.getByLabel('Description')).toHaveValue('About invoice INV-2026-0106.');

  await page.goto(app('/invoices'));
  await page.getByRole('button', { name: 'Actions for INV-2026-0106' }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Schedule Follow-Up' }).click();
  await expect(page).toHaveURL(/\/calendar\/new\?/, { timeout: 60_000 });
  await expect(page.locator('main')).toContainText('Jamie Sample', { timeout: 60_000 });
  await expect(page.locator('input[value="jamie.sample@example.test"]')).toBeVisible();
});

test('I-N10: the Payment Method filter lists the invoices paid that way (a voided payment does not count)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  const table = page.locator('main').getByRole('table');
  const method = page.locator('main').getByLabel('Payment Method', { exact: true });
  await method.selectOption({ label: 'Check' }, { timeout: 60_000 });
  // INV-2026-0095 has a live check (and a voided cash payment).
  await expect(table).toContainText('INV-2026-0095');
  await expect(page).toHaveURL(/method=CHECK/);
  await method.selectOption({ label: 'Cash' });
  await expect(page.locator('main').getByRole('link', { name: 'INV-2026-0095' })).toHaveCount(0);
});

test('I-N05: the Tipping setting says tips are not active yet at Pay Now', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/settings/payments'));
  await expect(page.getByTestId('tip-not-active').first()).toHaveText(
    "Not active yet: clients can't add a tip at Pay Now yet",
    { timeout: 60_000 },
  );
});

test('I-N01: the header Service lists the whole catalog; one the client lacks is added as Requested, with its plans', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices/new'));
  // Riley Example (fake) has no services yet.
  await page.getByLabel('Client *').selectOption({ label: 'Riley Example' }, { timeout: 60_000 });
  const service = page.getByLabel('Service', { exact: true });
  await service.selectOption({ label: 'Bookkeeping Services (new for this client)' });
  await expect(page.getByTestId('service-requested-hint')).toHaveText(
    'Not yet a service for this client: saving adds it as Requested.',
  );
  const plan = page.getByLabel('Plan', { exact: true });
  await expect(plan.locator('option')).toHaveText(['No plan', 'Starter', 'Growth', 'Premium']);
  await expect(page.getByTestId('invoice-service-plan')).toContainText('Billed monthly');
  await plan.selectOption('Growth');
  await page.getByLabel('Description 1 *').fill('Monthly books (fake)');
  await page.getByLabel('Rate 1 *').fill('199');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByText('Bookkeeping Services (Requested)').first()).toBeVisible();
});
