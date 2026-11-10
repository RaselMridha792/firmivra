import { expect, test } from '@playwright/test';
import { clientFixtures } from '../../src/mocks/clients';

// Business Advisory review of Oct 25, batch 2 (Octavia): B11, Generate Zoom Link says why it is
// off and how to fix it, and Settings > Availability sets each member's meeting link. Mock mode,
// as an Owner (mocks/appointments-scheduling.ts: Zoom connected, Theo Grant has no link).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

const video = async (page: import('@playwright/test').Page) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
  await page
    .getByRole('radiogroup', { name: 'Location Type *' })
    .getByRole('radio', { name: 'Zoom / Video' })
    .click();
  return page.getByTestId('video-link');
};

test('B11: Generate Zoom Link needs the staff member’s link; without one it is off and says where to add it', async ({
  page,
}) => {
  const row = await video(page);
  const toggle = row.getByRole('switch', { name: 'Generate Zoom Link' });
  // Morgan Avery has a link: Generate works, and nothing needs saying.
  await expect(toggle).toBeEnabled();
  await expect(page.getByTestId('video-notice')).toHaveCount(0);
  await toggle.click();
  await expect(row.getByRole('textbox', { name: 'Video Meeting Link' })).toBeDisabled();

  // Theo Grant has none: Generate is off and the notice names him and the way to fix it.
  await page.getByRole('button', { name: 'Remove Morgan Avery' }).click();
  await page
    .getByRole('button', { name: /Assigned Staff/ })
    .first()
    .click();
  await page.getByRole('checkbox', { name: 'Theo Grant' }).check();
  const notice = page.getByTestId('video-notice');
  await expect(notice).toContainText('Theo Grant has no meeting link yet');
  await expect(toggle).toBeDisabled();
  await expect(toggle).not.toBeChecked();
  await expect(notice.getByRole('link', { name: /Settings > Availability/ })).toHaveAttribute(
    'href',
    '/settings/availability',
  );
  await expect(notice.getByRole('link', { name: /Settings > Availability/ })).toHaveAttribute(
    'target',
    '_blank',
  );
  // A pasted link is still the way for him.
  const link = row.getByRole('textbox', { name: 'Video Meeting Link' });
  await expect(link).toBeEnabled();
  await link.fill('https://meet.example.test/theo');
  await notice.getByRole('button', { name: 'Check again' }).click();
  await expect(notice).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('zoom-no-link.png') });
});

test('B11: with Zoom not connected the notice says so and an Owner gets Integrations', async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem('firmivra-mock:video', 'off'));
  const row = await video(page);
  await expect(row.getByRole('switch', { name: 'Generate Zoom Link' })).toBeDisabled();
  const notice = page.getByTestId('video-notice');
  await expect(notice).toContainText('Zoom is not connected, so a link cannot be generated');
  await expect(notice.getByRole('link', { name: /Integrations/ })).toHaveAttribute(
    'href',
    '/integrations',
  );
});

test('B11: Settings > Availability sets, checks and removes a member’s meeting link', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/settings/availability'));
  const card = page.getByTestId('meeting-link');
  const field = card.getByRole('textbox', { name: 'Meeting link' });
  await expect(field).toHaveValue(/^https:\/\//, { timeout: 60_000 });

  await field.fill('http://meet.example.test/not-secure');
  await card.getByRole('button', { name: 'Save meeting link' }).click();
  await expect(card.getByRole('alert')).toBeVisible();

  await field.fill('https://meet.example.test/mock-user');
  await card.getByRole('button', { name: 'Save meeting link' }).click();
  await expect(card.getByRole('status')).toHaveText('Meeting link saved.');
  await page.screenshot({ path: test.info().outputPath('meeting-link.png') });

  await card.getByRole('button', { name: 'Remove link' }).click();
  await expect(card.getByRole('status')).toHaveText('Meeting link removed.');
  await expect(field).toHaveValue('');
});

// ---------- B12 and B34: document year and category selectors ----------
const CLIENT = '0199b6a1-0000-7000-8000-000000000001';
const thisYear = new Date().getFullYear();
const clientDocuments = async (page: import('@playwright/test').Page) => {
  await page.route(`**/api/v1/business/clients/${CLIENT}`, (route) =>
    route.fulfill({ json: clientFixtures()[0] }),
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/clients/${CLIENT}/documents`));
};

test('B12 and B34: the client’s document years roll (this year, six back, three ahead), keep stored years and take a custom one', async ({
  page,
}) => {
  await clientDocuments(page);
  const year = page.getByTestId('document-year-filter');
  await expect(page.getByTestId('client-documents-table')).toContainText('W-2_2025.pdf', {
    timeout: 60_000,
  });
  const choices = await year.locator('option').allTextContents();
  expect(choices[0]).toBe('All years');
  expect(choices).toContain(String(thisYear + 3));
  expect(choices).toContain(String(thisYear - 6));
  expect(choices).not.toContain(String(thisYear + 4));
  expect(choices.at(-1)).toBe('Custom year…');

  await year.selectOption('custom');
  const custom = page.getByLabel('Year: custom year');
  await custom.fill('1899');
  await expect(page.getByText('Use a year from 1900 to 2100.')).toBeVisible();
  await custom.fill('2015');
  await expect(year).toHaveValue('2015');
  await expect(page.getByText('No documents match these filters.')).toBeVisible();
  await year.selectOption('');
  await expect(page.getByTestId('client-documents-table')).toContainText('W-2_2025.pdf');
  await expect(page.getByTestId('no-categories')).toHaveCount(0);
});

test('B12: a firm with no document categories says where they are set up, on the client’s documents and on Upload', async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem('firmivra-mock:document-categories', 'none'),
  );
  await clientDocuments(page);
  const empty = page.getByTestId('no-categories');
  await expect(empty).toContainText('The firm has no document categories yet', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('document-category-filter')).toBeDisabled();
  await expect(empty.getByRole('link', { name: 'Add document categories' })).toHaveAttribute(
    'href',
    '/documents/settings?tab=general',
  );
  await page.screenshot({ path: test.info().outputPath('client-documents-no-categories.png') });

  await page.goto(app('/documents/upload'));
  const types = page.getByTestId('no-document-types');
  await expect(types).toContainText('The firm has no document types yet', { timeout: 60_000 });
  await expect(types.getByRole('link', { name: 'Add document types' })).toHaveAttribute(
    'href',
    '/documents/settings?tab=general',
  );
  await page.screenshot({ path: test.info().outputPath('upload-no-types.png') });
});

test('B34: Edit Details keeps the document’s year and offers the rolling years', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/documents/0199b6a5-0000-7000-8000-000000000006'));
  await expect(page.getByTestId('document-file')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Edit Details' }).click();
  const dialog = page.getByRole('dialog');
  const year = dialog.getByLabel('Tax Year', { exact: true });
  await expect(year).toHaveValue('2024');
  const choices = await year.locator('option').allTextContents();
  expect(choices).toContain(String(thisYear + 3));
  expect(choices).toContain('Custom year…');
  await page.screenshot({ path: test.info().outputPath('edit-details-years.png') });
});
