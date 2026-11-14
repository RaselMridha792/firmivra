import { expect, test, type Page } from '@playwright/test';

// R60, Clients Review 2 (G8): Clients > Services manages the client's services. Enroll in Service
// creates an engagement; a row's actions edit its details (the package and staff links open Edit),
// pause and resume it in Service & Billing (any service, with a reason), end it with a
// date and a reason, reactivate it, and show its history. Mock mode as the Owner; client 1 is
// Jamie Sample, whose Personal Tax row is the engagements mock's first engagement. Synthetic data
// only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const jamie = '0199b6a1-0000-7000-8000-000000000001';
const shots = 'e2e/screenshots/r60-clients-services';

test.describe.configure({ timeout: 240_000 });

const row = (page: Page, name: string) =>
  page.getByTestId('client-service').filter({ has: page.getByText(name, { exact: true }) });

async function act(page: Page, name: string, item: string) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('Enroll, edit, Service & Billing, end, reactivate and history on Clients > Services', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/clients/${jamie}/services`));
  await expect(row(page, 'Personal Tax')).toBeVisible({ timeout: 60_000 });

  // Enroll: nothing goes without a service.
  await page.getByTestId('enroll-service').click();
  const enroll = page.getByRole('dialog', { name: 'Enroll in Service' });
  await enroll.getByRole('button', { name: 'Enroll' }).click();
  await expect(enroll).toContainText('Choose a service');
  await enroll.getByLabel('Service *').selectOption({ label: 'Bookkeeping Services' });
  await enroll.getByLabel('Package (optional)').fill('Growth (fake)');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/enroll.png` });
  await enroll.getByRole('button', { name: 'Enroll' }).click();
  await expect(enroll).toBeHidden();
  await expect(page.getByText(/is enrolled in Bookkeeping Services/)).toBeVisible();

  // The package link opens Edit; a changed package saves.
  await row(page, 'Personal Tax')
    .getByRole('button', { name: 'Edit the package of Personal Tax' })
    .click();
  const edit = page.getByRole('dialog', { name: 'Edit Service Details' });
  await expect(edit.getByRole('button', { name: 'Save' })).toBeDisabled();
  await edit.getByLabel('Package').fill('Premium (fake)');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('Personal Tax: the details are saved.')).toBeVisible();

  // Service & Billing: any service goes on hold with a reason, then resumes.
  await act(page, 'Personal Tax', 'Service & Billing');
  let billing = page.getByRole('dialog', { name: 'Service & Billing' });
  await expect(billing.getByRole('radio', { name: 'Service only' })).toBeChecked();
  await billing.getByLabel('Reason for pausing the service *').fill('Client travelling (fake).');
  await billing.getByLabel('I confirm these changes.').check();
  await billing.getByRole('button', { name: 'Apply' }).click();
  await expect(billing).toBeHidden();
  await expect(row(page, 'Personal Tax').getByText('Paused', { exact: true })).toBeVisible();
  await act(page, 'Personal Tax', 'Service & Billing');
  billing = page.getByRole('dialog', { name: 'Service & Billing' });
  await expect(billing.getByTestId('service-billing-state')).toContainText('On hold');
  await billing.getByLabel('I confirm these changes.').check();
  await billing.getByRole('button', { name: 'Apply' }).click();
  await expect(billing).toBeHidden();
  await expect(row(page, 'Personal Tax').getByText('Paused', { exact: true })).toHaveCount(0);

  // End Service asks for a reason, then ends it; Reactivate brings it back.
  await act(page, 'Personal Tax', 'End Service');
  const end = page.getByRole('dialog', { name: 'End Service' });
  await end.getByRole('button', { name: 'End Service' }).click();
  await expect(end).toContainText('Say why the service ends');
  await end.getByLabel('Reason *').fill('Client moved away (fake).');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/end-service.png` });
  await end.getByRole('button', { name: 'End Service' }).click();
  await expect(end).toBeHidden();
  await expect(page.getByText('Personal Tax is ended.')).toBeVisible();

  await act(page, 'Personal Tax', 'History');
  const history = page.getByRole('dialog', { name: 'Service History' });
  await expect(history).toContainText('Why it ended: Client moved away (fake).');
  await expect(history).toContainText('Ended');
  await expect(history).toContainText('Details changed: package');
  await expect(history).toContainText('Paused');
  await expect(history).toContainText('Resumed');
  await expect(history).toContainText('Enrolled');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/history.png` });
  await history.getByRole('button', { name: /close/i }).first().click();

  await act(page, 'Personal Tax', 'Reactivate');
  await page
    .getByRole('dialog', { name: 'Reactivate Service' })
    .getByRole('button', { name: 'Reactivate' })
    .click();
  await expect(page.getByText('Personal Tax is active again.')).toBeVisible();
});

test('the Services tab fits a 375 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(app(`/clients/${jamie}/services`));
  await expect(page.getByTestId('enroll-service')).toBeVisible({ timeout: 60_000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
