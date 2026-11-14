import { expect, test } from '@playwright/test';

// R60, Tax Returns with the shared pieces (Octavia's Oct 26 review): TX-F03 (SH1) every way out
// keeps Back to the return; TX-F05 (SH5) Send Message is written here; TX-F06 (SH6) Create
// Appointment opens the shared form on this client and return; TX-F08 to F10 (SH3) Upload and
// Request open here; TX-F13 to F15 (SH4) the shared task list and Create Task on this return.
// Mock mode as the Owner; nothing is sent anywhere.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

async function openReturn(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns'));
  await page
    .getByTestId('tr-filters')
    .getByLabel('Status', { exact: true })
    .selectOption('IN_PREPARATION');
  await page.getByTestId('return-link').first().click();
  await expect(page.getByTestId('return-workspace')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('action-bar')).toBeVisible();
}

test('Upload and Request open here; tasks and Create Task stay on this return', async ({
  page,
}) => {
  await openReturn(page);
  const here = new URL(page.url()).pathname;

  // SH3: in place, for this client's return and year.
  const docs = page.getByTestId('document-checklist');
  await docs.getByRole('button', { name: 'Upload Documents' }).click();
  const upload = page.getByRole('dialog', { name: 'Upload Document' });
  await expect(upload).toBeVisible();
  await expect(upload).toContainText(/Tax Returns|Tax year/);
  await upload.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(new RegExp(`${here}`));
  await docs.getByRole('button', { name: 'Request Documents' }).click();
  await expect(page.getByRole('dialog', { name: 'Request Documents' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Request Documents' })
    .getByRole('button', { name: 'Cancel' })
    .click();

  // SH4: the shared task list, and Create Task on this client, return and year, with Back here.
  const tasks = page.getByTestId('upcoming-tasks');
  const create = tasks.getByRole('link', { name: 'Create Task' });
  await expect(create).toHaveAttribute(
    'href',
    /^\/tasks\/new\?clientId=[0-9a-f-]+&engagementId=[0-9a-f-]+&period=Tax\+year\+\d{4}&from=/,
  );
  await expect(tasks.getByRole('link', { name: 'View All' })).toHaveAttribute(
    'href',
    /^\/tasks\?clientId=[0-9a-f-]+&from=/,
  );
  await page.screenshot({ path: 'e2e/screenshots/r60-tax-returns-shared/workspace.png' });
});

test('Send Message is written here; Create Appointment and Client Portal keep Back to the return', async ({
  page,
}) => {
  await openReturn(page);
  const bar = page.getByTestId('action-bar');
  await expect(bar.getByRole('link', { name: 'Create Appointment' })).toHaveAttribute(
    'href',
    /^\/calendar\/new\?clientId=[0-9a-f-]+&engagementId=[0-9a-f-]+&from=%2Ftax-returns%2F/,
  );
  // TX-F04: the firm-side Client Portal for this client, with the way back.
  await expect(bar.getByRole('link', { name: 'Client Portal' })).toHaveAttribute(
    'href',
    /^\/client-portal\/[0-9a-f-]+\?from=%2Ftax-returns%2F/,
  );

  await bar.getByRole('button', { name: 'Send Message' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Message' });
  await expect(dialog.getByLabel('Subject')).toHaveValue(/^\d{4} .*Return$/);
  await dialog.getByLabel('Message').fill('Your organizer is ready (synthetic).');
  await dialog.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.getByText('Message sent to the client.')).toBeVisible();
  await expect(page.getByTestId('return-workspace')).toBeVisible();
});
