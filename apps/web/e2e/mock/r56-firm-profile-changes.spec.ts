import { expect, test } from '@playwright/test';

// R56: applying a firm's Company Profile Request Change on the Super Admin's firm page (Rasel,
// Oct 24; R60's Request Change raises the ticket). Mock mode (`api.adminFirmProfile` contract
// mock): the firm's requests with the ticket's values; licensing waits for its records; the
// values are prefilled, checked before sending, applied, and the row says so.
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const firm = '00000000-0000-4000-8000-000000000001';

test('a firm’s change requests: apply the legal name and EIN, licensing waits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`http://admin.localhost:${port}/firms/${firm}`);
  const card = page.getByTestId('profile-changes');
  await expect(card).toBeVisible({ timeout: 60_000 });
  const rows = card.getByTestId('profile-change');
  await expect(rows).toHaveCount(2);

  const licensing = rows.filter({ hasText: 'Professional Licensing' });
  await expect(licensing).toContainText('Licensing details can be applied once their records');
  await expect(licensing.getByRole('button', { name: /Apply/ })).toBeDisabled();

  const company = rows.filter({ hasText: 'Company Information' });
  await expect(company.getByRole('link', { name: '#0405' })).toHaveAttribute(
    'href',
    `/support/tickets/${firm.slice(0, 24)}000000000001`,
  );
  await company.getByRole('button', { name: /Apply/ }).click();
  const dialog = page.getByTestId('apply-profile-change');
  await expect(dialog.getByLabel('Legal Company Name')).toHaveValue('Sample Firm Holdings LLC');
  await expect(dialog.getByLabel('EIN (Tax ID)')).toHaveValue('98-7654321');
  await expect(dialog).toContainText('Now: Ending in 6789');
  await expect(dialog).toContainText('We merged with the holding company.');

  // Checked before anything is sent.
  await dialog.getByLabel('EIN (Tax ID)').fill('98-765');
  await dialog.getByRole('button', { name: 'Apply Change' }).click();
  await expect(dialog).toContainText('Enter the 9-digit EIN');

  await dialog.getByLabel('EIN (Tax ID)').fill('98-7654321');
  await dialog.getByRole('button', { name: 'Apply Change' }).click();
  await expect(page.getByTestId('profile-change-applied')).toHaveText(
    'Applied Legal Company Name, EIN (Tax ID) from #0405 (EIN ending in 4321). Resolve the ticket with a reply to tell the firm.',
  );
  await expect(company).toContainText('Applied');
  await expect(company.getByRole('button', { name: /Apply Again/ })).toBeEnabled();
});
