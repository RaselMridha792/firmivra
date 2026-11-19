import { expect, test, type Page } from '@playwright/test';

// R55, Communications and Messaging Review Two, C20: an easy "All contacts" audience. All
// Contacts' "Add all eligible (N)" adds, on the server, everyone the list marks eligible who is
// not chosen yet (N is the server's count), and Undo takes back exactly those
// (playwright.mock.config.ts, as an Owner; the mock answers and refuses as the API does:
// src/lib/comms-add-eligible-mock.test.ts).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/communications`;

const openAllContacts = async (page: Page) => {
  // The composer opens at once; Choose Recipients makes the draft (Dashboard Review 2, Q3).
  await page.goto(`${base}/new?channel=EMAIL`);
  const recipients = page.getByTestId('composer-form').getByTestId('recipients-field');
  await recipients.getByRole('button', { name: 'Choose Recipients' }).click({ timeout: 60_000 });
  await page.waitForURL(/\/edit$/);
  const modal = page.getByTestId('recipients-modal');
  await modal.getByRole('button', { name: 'All Contacts' }).click();
  await expect(modal.getByTestId('candidates').getByRole('checkbox').first()).toBeVisible();
  return modal;
};
const countIn = async (button: ReturnType<Page['getByRole']>) =>
  Number(/\((\d+)\)/.exec((await button.textContent()) ?? '')?.[1]);

test('C20: Add all eligible adds everyone eligible not chosen yet, and Undo takes back only those', async ({
  page,
}) => {
  const modal = await openAllContacts(page);
  const list = modal.getByTestId('candidates');
  const addAll = modal.getByRole('button', { name: /^Add all eligible \(\d+\)$/ });
  await expect(addAll).toBeEnabled();
  const before = await countIn(addAll);
  // One contact chosen by hand first: the count drops by one, from the server.
  const own = list.getByRole('checkbox', { disabled: false }).first();
  const ownName = (await own.getAttribute('aria-label')) ?? '';
  await own.check();
  await expect(addAll).toHaveText(`Add all eligible (${before - 1})`);
  await expect(modal.getByTestId('final-total')).toHaveText('1');

  await addAll.click();
  const added = before - 1;
  await expect(modal.getByRole('status')).toHaveText(`${added} contacts added.`);
  await expect(modal.getByTestId('added-all')).toContainText(`All eligible contacts (${added})`);
  await expect(modal.getByTestId('final-total')).toHaveText(String(before));
  // Nobody is left; someone who cannot receive it was never added.
  await expect(addAll).toHaveText('Add all eligible (0)');
  await expect(addAll).toBeDisabled();
  await expect(list.getByRole('checkbox', { disabled: true }).first()).not.toBeChecked();

  // Undo removes exactly what it added: the contact chosen by hand stays.
  await modal.getByTestId('added-all').getByRole('button', { name: 'Undo' }).click();
  await expect(modal.getByRole('status')).toHaveText('Undone: those contacts were removed.');
  await expect(modal.getByTestId('added-all')).toHaveCount(0);
  await expect(modal.getByTestId('final-total')).toHaveText('1');
  await expect(modal.getByRole('button', { name: `Remove ${ownName}` })).toBeVisible();
  await expect(addAll).toHaveText(`Add all eligible (${before - 1})`);
});

test('C20: the search narrows who is added, and the composer shows the audience it made', async ({
  page,
}) => {
  const modal = await openAllContacts(page);
  // client2@ is one contact; client1 is client1 and client10-19 (fake addresses).
  await modal.getByRole('searchbox', { name: 'Search recipients' }).fill('client2@');
  const addAll = modal.getByRole('button', { name: /^Add all eligible \(\d+\)$/ });
  await expect(addAll).toHaveText('Add all eligible (1)');
  await expect(modal.getByText('Everyone matching the search who can receive this')).toBeVisible();
  await addAll.click();
  await expect(modal.getByRole('status')).toHaveText('1 contact added.');
  await expect(modal.getByTestId('final-total')).toHaveText('1');
  await modal.getByRole('searchbox', { name: 'Search recipients' }).fill('client1');
  await expect(addAll).toHaveText(/^Add all eligible \(\d+\)$/);
  const more = await countIn(addAll);
  expect(more).toBeGreaterThan(1);
  await addAll.click();
  await expect(modal.getByTestId('added-all')).toContainText(`All eligible contacts (${more + 1})`);
  await page.getByRole('button', { name: `Apply ${more + 1} Recipients` }).click();
  const field = page.getByTestId('composer-form').getByTestId('recipients-field');
  await expect(field.getByTestId('audience-count')).toHaveText(
    `${more + 1} can receive this message`,
  );
  // Ten names are shown, then how many more.
  await expect(field.getByTestId('more-recipients')).toHaveText(`and ${more + 1 - 10} more`);
});
