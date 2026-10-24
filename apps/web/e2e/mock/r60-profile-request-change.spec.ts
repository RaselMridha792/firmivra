import { expect, test } from '@playwright/test';

// Company Profile's Request Change (her guide B2, B3, E4; Rasel's default of Oct 24): the legal
// name, the EIN and the licensing details are locked; Request Change sends a request to Firmivra
// and the card shows its status. Mock mode (playwright.mock.config.ts) as the Owner; the mock
// keeps its data in the page. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('the legal name and EIN are locked; Request Change sends a request whose status shows', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/settings/profile'));
  const company = page.getByTestId('company-information');
  await expect(company.getByRole('heading', { name: 'Company Information' })).toBeVisible();
  await expect(company).toContainText('Legal Company Name');
  await expect(company).toContainText('Sample Legal Name LLC');
  await expect(company).toContainText('EIN (Tax ID)');
  await expect(company.getByRole('img', { name: 'Locked' })).toHaveCount(2);
  // No EIN field to type into any more; the display details stay editable.
  await expect(page.getByLabel(/^EIN/)).toHaveCount(0);
  await expect(company.getByLabel('Company Name *')).toBeVisible();

  await company.getByRole('button', { name: 'Request Change' }).click();
  const dialog = page.getByRole('dialog', { name: 'Request a Change' });
  await expect(dialog).toContainText('Current: Sample Legal Name LLC');
  await expect(dialog.getByLabel('New License Number')).toHaveCount(0);

  // Nothing entered: both problems are named and nothing is sent.
  await dialog.getByRole('button', { name: 'Submit Request' }).click();
  await expect(dialog).toContainText('Enter at least one new value');
  await expect(dialog).toContainText('Say why the change is needed');

  // The API refuses the current name; the typed values stay.
  await dialog.getByLabel('New Legal Company Name').fill('Sample Legal Name LLC');
  await dialog.getByLabel('Reason for the change *').fill('A new name was registered.');
  await dialog.getByRole('button', { name: 'Submit Request' }).click();
  await expect(dialog).toContainText('This is already the legal name');
  await expect(dialog.getByLabel('Reason for the change *')).toHaveValue(
    'A new name was registered.',
  );

  await dialog.getByLabel('New Legal Company Name').fill('Sample Renamed Legal LLC');
  await dialog.getByLabel('New EIN (Tax ID)').fill('12-3456789');
  await dialog.getByRole('button', { name: 'Submit Request' }).click();
  await expect(dialog).toBeHidden();
  await expect(company).toContainText('Request #1004 sent to Firmivra');
  const status = company.getByTestId('company-request');
  await expect(status).toContainText('Submitted');
  await expect(status).toContainText('Request #1004');
  await expect(status).toContainText('Legal Company Name, EIN (Tax ID)');
  // The profile itself is unchanged until Firmivra applies it.
  await expect(company).toContainText('Sample Legal Name LLC');
});

test('the licensing card is read-only, asks for its own fields and shows Firmivra’s reply', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/settings/profile'));
  const licensing = page.getByTestId('licensing-information');
  for (const label of ['Regulatory Body', 'License Type', 'License Number', 'Expiration Date'])
    await expect(licensing).toContainText(label);
  await expect(licensing.getByRole('img', { name: 'Locked' })).toHaveCount(5);
  const status = licensing.getByTestId('licensing-request');
  await expect(status).toContainText('In Review');
  await expect(status).toContainText('Request #1003');
  await expect(status).toContainText('checking the new license number');

  await licensing.getByRole('button', { name: 'Request Change' }).click();
  const dialog = page.getByRole('dialog', { name: 'Request a Change' });
  await expect(dialog.getByLabel('New Legal Company Name')).toHaveCount(0);
  await dialog.getByLabel('New License Number').fill('CPA-000111');
  await dialog.getByLabel('Reason for the change *').fill('Our license was renewed.');
  await dialog.getByRole('button', { name: 'Submit Request' }).click();
  await expect(dialog).toBeHidden();
  await expect(status).toContainText('Submitted');
  await expect(status).toContainText('License Number');
});
