import { expect, test } from '@playwright/test';

// R61's live check (Nov 18), Appointments: Manage Appointment Types has no pager, and the shared
// Table still cut every list at 10 rows, so the 11th type on (archived ones too) could not be
// seen, picked, archived, restored or copied. A table with no pager now shows every row it is
// given. Mock mode as the Owner: eight more types make the list longer than ten. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('Manage Appointment Types lists every type past ten, and the last one can be archived', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/calendar/types`);
  const list = page.getByTestId('types-list');
  await expect(list).toContainText('Tax consultation', { timeout: 60_000 });
  const actions = list.getByRole('button', { name: /^Actions for / });
  const before = await actions.count();

  for (let n = 1; n <= 8; n += 1) {
    await page.getByRole('button', { name: 'Add Type' }).click();
    const add = page.getByRole('dialog', { name: 'Add Appointment Type' });
    await add.getByLabel('Name *').fill(`Fake Type ${n}`);
    await add.getByRole('button', { name: 'Add Type' }).click();
    await expect(page.getByTestId('types-result')).toHaveText(`Fake Type ${n} added.`);
  }

  const total = before + 8;
  expect(total).toBeGreaterThan(10);
  await expect(actions).toHaveCount(total);
  for (let n = 1; n <= 8; n += 1) await expect(list).toContainText(`Fake Type ${n}`);
  // No pager: nothing to page to.
  await expect(list.getByRole('navigation')).toHaveCount(0);

  // Whichever type now sits past the tenth row can still be acted on.
  const last = actions.last();
  await last.scrollIntoViewIfNeeded();
  const name = ((await last.getAttribute('aria-label')) ?? '').replace(/^Actions for /, '');
  expect(name).not.toBe('');
  await last.click();
  await page.getByRole('menuitem', { name: /^(Archive|Restore)$/ }).click();
  await expect(page.getByTestId('types-result')).toContainText(name);
});
