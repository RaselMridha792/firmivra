import { expect, test } from '@playwright/test';

// R55, Leads Review Two, R61's live check (Nov 18). Row 3: the business or company typed in Add
// New Lead shows on the list, the lead's header, Contact Information and Lead Details, and Edit
// Lead changes it. Row 26: every day and time on the lead is the firm's (New York), labelled,
// on a device in Chicago an hour behind. Mock mode as the Owner; synthetic data.
test.use({ timezoneId: 'America/Chicago' });

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}`;
const avery = `${base}/leads/0199c0c0-0a00-7000-8000-000000000001`;
const selma = `${base}/leads/0199c0c0-0a00-7000-8000-000000000004`;

test('row 3: the business name shows on the list, header and both cards, and Edit Lead changes it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/leads`);
  const row = page.getByRole('row').filter({ hasText: 'Selma Shields' });
  await expect(row).toContainText('Shields Holdings LLC', { timeout: 60_000 });

  await page.goto(selma);
  await expect(page.getByTestId('lead-business')).toHaveText('Shields Holdings LLC', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('card-contact')).toContainText(
    'Business / CompanyShields Holdings LLC',
  );
  await expect(page.getByTestId('card-lead-details')).toContainText(
    'Business / CompanyShields Holdings LLC',
  );

  await page.getByRole('button', { name: 'Edit lead' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Lead' });
  const field = dialog.getByLabel('Business / Company name');
  await expect(field).toHaveValue('Shields Holdings LLC');
  await field.fill('Shields Family Bakery (fake)');
  await dialog.getByRole('button', { name: 'Save Changes' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('lead-business')).toHaveText('Shields Family Bakery (fake)');
  await expect(page.getByTestId('card-contact')).toContainText('Shields Family Bakery (fake)');
  await expect(page.getByTestId('card-lead-details')).toContainText('Shields Family Bakery (fake)');

  // A lead without one reads a dash, and has no business line under its name.
  await page.goto(avery);
  await expect(page.getByTestId('card-contact')).toContainText('Business / Company—', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('lead-business')).toHaveCount(0);
});

test('row 26: Next Follow-Up, Next Action and the list are in the firm’s zone, labelled', async ({
  page,
}) => {
  // 8:15 AM in New York (7:15 AM here). Avery Lawson's call is seeded 30 hours ahead: Nov 17,
  // 2:15 PM in New York, which is 1:15 PM on this device.
  await page.clock.setFixedTime(new Date('2026-11-16T13:15:00.000Z'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(avery);

  const figure = page.getByTestId('figure-next-follow-up');
  await expect(figure).toContainText('Nov 17, 2026', { timeout: 60_000 });
  await expect(figure).toContainText('2:15 PM EST · Call');
  await expect(figure).not.toContainText('1:15 PM');

  const details = page.getByTestId('card-lead-details');
  await expect(details).toContainText('Call – Nov 17, 2026 at 2:15 PM EST');
  await expect(details).not.toContainText('1:15 PM');

  await page.goto(`${base}/leads`);
  const row = page.getByRole('row').filter({ hasText: 'Avery Lawson' });
  await expect(row).toContainText('Nov 17, 2026, 2:15 PM EST', { timeout: 60_000 });
  await expect(row).not.toContainText('1:15 PM');
});
