import { expect, test } from '@playwright/test';

// R55, Octavia's Super Admin review of Oct 31 (SA-COM): New Message asks before unsaved edits are
// lost (R5). Mock mode; 1440 px.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

test('New Message: Cancel with unsaved edits asks Discard or Keep editing; nothing is sent (SA-COM-R5)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Nothing typed: Cancel leaves at once.
  await page.goto(admin('/communications/new'));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/\/communications$/);

  await page.goto(admin('/communications/new'));
  await page.getByRole('textbox', { name: 'Message body' }).click();
  await page.keyboard.type('Hello from the platform (synthetic).');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'Discard this message?' });
  await expect(ask).toBeVisible();
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/super-admin/message-discard.png' });
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('textbox', { name: 'Message body' })).toContainText(
    'Hello from the platform',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Discard this message?' })
    .getByRole('button', { name: 'Discard' })
    .click();
  await expect(page).toHaveURL(/\/communications$/);
});

test('firm-scoped links open Support and Billing for that one firm, in Super Admin (SA-RPT-R4, R5)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Support: the firm from the address is the Firm filter, shown as a chip.
  await page.goto(admin('/support'));
  await page.getByRole('button', { name: /^Filters/ }).click();
  const firmSelect = page.getByLabel('Firm', { exact: true });
  const firm = await firmSelect.locator('option').nth(1).getAttribute('value');
  const firmName = (await firmSelect.locator('option').nth(1).textContent())?.trim() ?? '';
  expect(firm).toMatch(/^[0-9a-f-]{36}$/);
  await page.goto(admin(`/support?firm=${firm}`));
  await expect(page.getByTestId('active-filters')).toContainText(`Firm: ${firmName}`);
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/super-admin/support-for-firm.png' });

  // Billing: the firm from the address is the firm picker's choice.
  await page.goto(admin('/billing'));
  const picker = page.getByRole('combobox', { name: /Firm/ }).first();
  const billingFirm = await picker.locator('option').nth(1).getAttribute('value');
  await page.goto(admin(`/billing?firm=${billingFirm}`));
  await expect(page.getByRole('combobox', { name: /Firm/ }).first()).toHaveValue(billingFirm ?? '');
});

test('New Message: Merge Field opens one chooser and puts the field at the cursor (SA-COM-R4)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin('/communications/new'));
  const subject = page.getByRole('textbox', { name: 'Subject' });
  await subject.fill('Hello  from us');
  await subject.evaluate((el: HTMLInputElement) => el.setSelectionRange(6, 6));
  await page.getByRole('button', { name: 'Insert Merge Field' }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(6);
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/super-admin/merge-field-chooser.png' });
  await page.getByRole('menuitem', { name: 'Contact first name' }).click();
  await expect(subject).toHaveValue('Hello {{contact.first_name}} from us');
  await page.getByRole('textbox', { name: 'Message body' }).click();
  await page.getByRole('button', { name: 'Merge Field', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Firm name' }).click();
  await expect(page.getByRole('textbox', { name: 'Message body' })).toContainText('{{firm.name}}');
});

test('New Message: Insert image opens the same picker as Templates and puts a reference at the cursor (SA-COM-R2)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin('/communications/new'));
  await page.getByRole('textbox', { name: 'Message body' }).click();
  await page.getByRole('button', { name: 'Insert image' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert Image' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab')).toHaveCount(2);
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/super-admin/message-insert-image.png' });
  await dialog.getByRole('tab', { name: /library/i }).click();
  const picks = dialog.getByRole('button').filter({ hasText: /\.(png|jpe?g|gif|webp)$/i });
  if ((await picks.count()) > 0) {
    await picks.first().click();
    const insert = dialog.getByRole('button', { name: /^Insert/ });
    if (await insert.count()) await insert.first().click();
    await expect(page.getByRole('textbox', { name: 'Message body' })).toContainText('[Image:');
  }
});

test('Applications: the list view lives in the address and Back returns to it; no workspace shortcut (SA-APP-F11, F12)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin('/applications'));
  await page.getByRole('tab', { name: /Approved/ }).click();
  await page.getByRole('searchbox', { name: 'Search applications' }).fill('Sample');
  await expect(page).toHaveURL(/tab=APPROVED/);
  await expect(page).toHaveURL(/search=Sample/);
  const open = page.getByRole('link', { name: /^Open application for / }).first();
  await expect(open).toHaveAttribute('href', /from=/);
  await open.click();
  await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}\?from=/);
  // F12: no shortcut into the firm's private workspace.
  await expect(page.getByRole('link', { name: /Open Firm Workspace/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to Applications' }).first().click();
  await expect(page).toHaveURL(/tab=APPROVED/);
  await expect(page.getByRole('searchbox', { name: 'Search applications' })).toHaveValue('Sample');
  await expect(page.getByRole('tab', { name: /Approved/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/super-admin/applications-restored.png' });
});
