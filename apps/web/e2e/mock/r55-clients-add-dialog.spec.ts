import { expect, type Page, test } from '@playwright/test';

// R55, Clients Review 2: closing Add New Client after typing in it, and a failed save.
// Mock mode as the Owner, at her 1165 x 747 window. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function openAdd(page: Page) {
  await page.getByRole('main').getByRole('button', { name: 'Add New Client' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add New Client' });
  await expect(dialog).toBeVisible();
  return dialog;
}

// Clients Review 2 (C2-029): Cancel threw away a filled Individual draft and Escape a filled
// Business draft with no warning. Cancel, Escape and the X each ask first; Keep Editing keeps
// every value; only Discard closes it, and Add opens blank again after that.
test('a filled Add New Client asks before Cancel, Escape or the X throws it away', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1165, height: 747 });
  await page.goto(app('/clients'));
  await expect(page.getByTestId('page-title')).toHaveText('Clients', { timeout: 60_000 });

  // Individual: Cancel, then the X.
  let dialog = await openAdd(page);
  await dialog.getByLabel('Full name *').fill('Dana Draft (fake)');
  await dialog.getByLabel('Email *').fill('dana.draft@example.test');
  const leaving = dialog.getByRole('alertdialog', {
    name: 'You have entered details for this client. Close without adding them?',
  });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(leaving).toBeVisible();
  await expect(dialog).toBeVisible();
  await leaving.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(leaving).toBeHidden();
  await expect(dialog.getByLabel('Full name *')).toHaveValue('Dana Draft (fake)');
  await expect(dialog.getByLabel('Email *')).toHaveValue('dana.draft@example.test');

  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(leaving).toBeVisible();
  await leaving.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toBeHidden();

  dialog = await openAdd(page);
  await expect(dialog.getByLabel('Full name *')).toHaveValue('');
  await expect(dialog.getByLabel('Email *')).toHaveValue('');

  // Business: Escape.
  await dialog.getByLabel('Client type *').selectOption({ label: 'Business' });
  await dialog.getByLabel('Business name *').fill('Draft Holdings LLC (fake)');
  await dialog.getByLabel('Business name *').press('Escape');
  await expect(leaving).toBeVisible();
  await expect(dialog).toBeVisible();
  await leaving.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(dialog.getByLabel('Business name *')).toHaveValue('Draft Holdings LLC (fake)');
  await page.keyboard.press('Escape');
  await leaving.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toBeHidden();

  // An untouched form closes at once: nothing to lose.
  dialog = await openAdd(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

// Clients Review 2 (§6 Reliability and accessibility a): a save that fails (here the clients
// mock answers 500, like a failing API) keeps every value typed and says why, so Add Client can
// simply be pressed again; and closing the dialog gives focus back to Add New Client.
test('a failed Add keeps every value and says why; trying again saves; closing refocuses Add New Client', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1165, height: 747 });
  await page.goto(app('/clients'));
  await expect(page.getByTestId('page-title')).toHaveText('Clients', { timeout: 60_000 });

  let dialog = await openAdd(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('main').getByRole('button', { name: 'Add New Client' }),
  ).toBeFocused();

  dialog = await openAdd(page);
  const values: [string, string][] = [
    ['Full name *', 'Robin Retry (fake)'],
    ['Email *', 'robin.retry@example.test'],
    ['Phone *', '(404) 555-0177'],
    ['Street address *', '9 Fake Lane'],
    ['City *', 'Atlanta'],
    ['ZIP code *', '30303'],
  ];
  for (const [label, value] of values) await dialog.getByLabel(label).fill(value);
  await dialog.getByLabel('State *').selectOption('GA');

  await page.evaluate(() => sessionStorage.setItem('fv-mock-fail', 'clients.create'));
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Something went wrong on our side. Try again in a moment.',
  );
  await expect(dialog).toBeVisible();
  for (const [label, value] of values) await expect(dialog.getByLabel(label)).toHaveValue(value);
  await expect(dialog.getByLabel('State *')).toHaveValue('GA');
  await expect(dialog.getByRole('button', { name: 'Add Client' })).toBeEnabled();

  await page.evaluate(() => sessionStorage.removeItem('fv-mock-fail'));
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Robin Retry (fake)', {
    timeout: 60_000,
  });
});
