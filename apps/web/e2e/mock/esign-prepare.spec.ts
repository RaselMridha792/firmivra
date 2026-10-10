import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
/** The mock's first client, Jamie Sample, who has a W-2 PDF in Documents. */
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';
const PDF = { name: 'Synthetic letter.pdf', mimeType: 'application/pdf' };

test('start a request, upload a file, wait for its check and remove it', async ({ page }) => {
  await page.goto(app('/firm-sign/new'));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Name the document')).toBeVisible();
  await page.getByLabel('Document name').fill('Synthetic Engagement Letter');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/firm-sign\/requests\/[0-9a-f-]+\/prepare$/);
  await expect(page.getByTestId('page-title')).toHaveText('Synthetic Engagement Letter');
  await expect(
    page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: 'Documents' }),
  ).toHaveAttribute('aria-current', 'step');
  await page
    .getByLabel('Upload files')
    .setInputFiles({ ...PDF, buffer: Buffer.from('%PDF-1.4 synthetic') });
  const files = page.getByTestId('request-files');
  await expect(files).toContainText('Synthetic letter.pdf');
  await expect(files).toContainText('Checking for viruses');
  // The mock's check takes 4 seconds; the step looks again until it is done.
  await expect(files).toContainText('Ready', { timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'Next: Recipients' })).toBeVisible();

  await page.getByRole('button', { name: 'Remove Synthetic letter.pdf' }).click();
  await expect(page.getByText('No files yet.')).toBeVisible();
});

test('from a client record: the client is chosen and their files can be added', async ({
  page,
}) => {
  await page.goto(app(`/firm-sign/new?clientId=${JAMIE}`));
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue(JAMIE);
  await page.getByLabel('Document name').fill('Synthetic W-2 sign-off');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('For Jamie Sample')).toBeVisible();
  await page.getByLabel('Find a file').fill('W-2');
  await page.getByLabel('File', { exact: true }).selectOption({ label: 'W-2_2025.pdf' });
  await page.getByRole('button', { name: 'Add file' }).click();
  // Files from the client's documents were already checked.
  await expect(page.getByTestId('request-files')).toContainText('W-2_2025.pdf');
  await expect(page.getByTestId('request-files')).toContainText('Ready');
});

test('a file that cannot be read says so', async ({ page }) => {
  await page.goto(app('/firm-sign/new'));
  await page.getByLabel('Document name').fill('Synthetic broken upload');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Upload files').setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic'),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'broken.pdf:' })).toBeVisible();
  await expect(page.getByText('No files yet.')).toBeVisible();
});

test('a sent request cannot be prepared', async ({ page }) => {
  await page.goto(app('/firm-sign/requests/0199b6e0-0000-7000-8000-000000000004/prepare'));
  await expect(page.getByText('This request has been sent')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the request' })).toBeVisible();
});
