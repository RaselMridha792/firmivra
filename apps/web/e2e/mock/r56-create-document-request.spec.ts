import { expect, test, type Page } from '@playwright/test';

// R56: Create Document Request (Documents design, Frame 4) in mock mode: `api.documentLibrary`'s
// templates and createRequest, and the clients mock for the recipient. Synthetic data only.
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const app = (path: string) => `http://app.localhost:${port}${path}`;

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/documents/requests/new'));
  await expect(page.getByTestId('create-document-request')).toBeVisible({ timeout: 60_000 });
}

async function chooseClient(page: Page, name: string) {
  await page.getByRole('button', { name: /^Client/ }).click();
  await page.getByRole('dialog', { name: 'Choose a client' }).getByRole('button', { name }).click();
  // Jamie Sample has two open services, so the request names one.
  await page.getByLabel('Service *').selectOption({ index: 1 });
}

test('Request Details holds the whole request and goes straight to Review & Send', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole('heading', { name: 'Create Document Request' })).toBeVisible();
  await expect(page.getByLabel('Request steps')).toContainText('Request Details');
  // A lead cannot be asked yet: it becomes a client first.
  await expect(page.getByRole('radio', { name: /Lead/ })).toBeDisabled();

  // Nothing filled: every part says what it needs.
  await page.getByRole('button', { name: 'Next: Review & Send' }).click();
  await expect(page.getByText('Choose the client this request is for.')).toBeVisible();
  await expect(page.getByText('Choose a request type.')).toBeVisible();
  await expect(page.getByText('Tick at least one document to request.')).toBeVisible();

  await chooseClient(page, 'Jamie Sample');
  await page.getByLabel('Request Title *').fill('2025 Tax Documents');
  await page.getByLabel('Request Type *').selectOption({ label: 'Personal Tax Documents' });
  await page.getByLabel('Due Date *').fill(inDays(20));
  const rows = page.getByTestId('request-item');
  await expect(rows).toHaveCount(5);
  await page.getByRole('checkbox', { name: 'Request Investment Statements' }).uncheck();
  await page.getByRole('switch', { name: 'Prior Year Tax Return (2024) is required' }).click();

  // The subject and message follow the request until they are typed over.
  await expect(page.getByLabel('Subject Line *')).toHaveValue('Action Needed: 2025 Tax Documents');
  await expect(page.getByLabel('Message *')).toHaveValue(/^Hi Jamie Sample,/);
  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByTestId('message-preview');
  await expect(preview).toContainText('W-2 Forms (All Employers)');
  await expect(preview).not.toContainText('Investment Statements');
  await expect(preview).toContainText('Prior Year Tax Return (2024) (optional)');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Next: Review & Send' }).click();
  const review = page.getByTestId('review');
  await expect(review).toContainText('Documents (4)');
  await expect(review).toContainText('Personal Tax Documents');
  await expect(review).toContainText('Reminder 3 days before the due date');
  await page.getByRole('button', { name: 'Send Request' }).click();
  await expect(page.getByTestId('request-saved')).toContainText(
    'DR-0025 was sent to Jamie Sample.',
  );
});

test('Select Documents: templates, individual documents, saved lists and the summary', async ({
  page,
}) => {
  await open(page);
  await chooseClient(page, 'Jamie Sample');
  await page.getByLabel('Request Title *').fill('Year-End Documents');
  await page.getByLabel('Request Type *').selectOption({ label: 'Custom' });
  await page.getByLabel('Due Date *').fill(inDays(10));
  await page.getByRole('button', { name: 'Add Custom Document' }).click();
  await page.getByLabel('Document Name *').fill('Fake Lease Agreement');
  await page.getByRole('button', { name: 'Add Document' }).click();
  await page.getByRole('button', { name: 'Next: Review & Send' }).click();

  // Previous walks back through Message & Settings to Select Documents.
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByTestId('message')).toBeVisible();
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByTestId('template-card')).toHaveCount(8);
  await expect(page.getByTestId('request-summary')).toContainText('Custom');
  await expect(page.getByTestId('request-summary')).toContainText('Jamie Sample');

  await page.getByRole('button', { name: 'Use Template: Payroll Setup' }).click();
  await expect(page.getByTestId('selected-item')).toHaveCount(5);
  await expect(page.getByTestId('template-preview')).toContainText('EIN Confirmation Letter');

  await page.getByRole('tab', { name: 'My Saved Lists' }).click();
  await page.getByRole('button', { name: 'Use Template: My Year-End Checklist' }).click();
  await expect(page.getByTestId('selected-item')).toHaveCount(8);

  await page.getByRole('tab', { name: 'Add Individual Documents' }).click();
  await page.getByRole('searchbox', { name: 'Search documents' }).fill('Balance');
  await page.getByRole('button', { name: 'Add Balance Sheet' }).click();
  await expect(
    page.getByRole('button', { name: 'Balance Sheet is on the request' }),
  ).toBeDisabled();
  await expect(page.getByTestId('selected-item')).toHaveCount(9);

  await page.getByRole('button', { name: 'Clear All' }).click();
  await page.getByRole('button', { name: 'Next: Message & Settings' }).click();
  await expect(page.getByText('Tick at least one document to request.')).toBeVisible();
});

test('Save as Draft needs only a client and a title', async ({ page }) => {
  await open(page);
  await chooseClient(page, 'Jamie Sample');
  await page.getByLabel('Request Title *').fill('Fake Draft Request');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByTestId('request-saved')).toContainText('was saved as a draft.');
  await page.getByRole('button', { name: 'Back to Document Requests' }).last().click();
  await expect(page.getByTestId('document-requests')).toBeVisible();
});
