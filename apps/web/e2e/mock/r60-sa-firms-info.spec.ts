// SA-FRM-F06 (R60, Nov 19): Request Information. The Super Admin asks a firm's owner from the
// firm page's Actions menu; the request shows in the firm's Account History with its Support
// ticket. The firm's Owner answers in Settings > Requests from Firmivra with text and a file;
// nobody else sees the page. Mock mode; mock data lives in the tab.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;
const app = (path: string) => `http://app.localhost:${port}${path}`;
/** The mock's Active firm that came from an application (mocks/firm-applications.ts, n 5). */
const NORTHSIDE = '0199b6a3-0000-7000-8000-000000000005';

test('SA-FRM-F06: Request Information needs a subject and a message, and lands in the Account History', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin(`/firms/${NORTHSIDE}`));
  await page.getByRole('button', { name: 'Actions' }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: /^Request Information/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Request Information' });
  await dialog.getByRole('button', { name: 'Send Request' }).click();
  await expect(dialog.getByLabel('Subject (required)')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByLabel('Message (required)')).toHaveAttribute('aria-invalid', 'true');
  await dialog.getByLabel('Subject (required)').fill('Your business licence');
  await dialog.getByLabel('Message (required)').fill('Fake: please send your current licence.');
  await dialog.getByRole('button', { name: 'Send Request' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('firm-action-done')).toContainText('as Support ticket #1101');
  const latest = page.getByTestId('firm-account-event').first();
  await expect(latest).toContainText('Information requested');
  await expect(latest).toContainText('Subject: Your business licence');
  await expect(latest.getByRole('link', { name: 'Open Support ticket #1101' })).toHaveAttribute(
    'href',
    /\/support\/tickets\//,
  );
});

test('SA-FRM-F06: the Owner answers Firmivra’s request with text and a file', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/settings/firmivra-requests'));
  const row = page.getByTestId('firmivra-request').filter({ hasText: 'Your business licence' });
  await expect(row).toContainText('Waiting on You', { timeout: 60_000 });
  await row.getByRole('link', { name: 'Your business licence' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Your business licence');
  await expect(page.getByTestId('firmivra-request-text')).toContainText(
    'please send a copy of your current business licence',
  );

  const answer = page.getByTestId('firmivra-answer');
  await answer.getByRole('button', { name: 'Send Answer' }).click();
  await expect(answer.getByLabel('Answer (required)')).toHaveAttribute('aria-invalid', 'true');
  await answer.getByLabel('Answer (required)').fill('Fake: our licence is attached.');
  await answer.locator('input[type=file]').setInputFiles({
    name: 'Fake licence.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n%%EOF\n'),
  });
  await expect(answer.getByRole('list', { name: 'Files to send' })).toContainText(
    'Fake licence.pdf',
  );
  await answer.getByRole('button', { name: 'Send Answer' }).click();

  const message = page.getByTestId('firmivra-message').last();
  await expect(message).toContainText('Fake: our licence is attached.');
  await expect(message).toContainText('Fake licence.pdf');
  await expect(message.getByRole('button', { name: /^Download/ })).toBeVisible();
  await expect(page.getByText('Answered', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Back to Requests from Firmivra' }).click();
  await expect(row).toContainText('Answered');
  // A resolved request can't be answered again.
  await page
    .getByTestId('firmivra-request')
    .filter({ hasText: 'Your office address' })
    .getByRole('link')
    .click();
  await expect(page.getByText('Firmivra has closed this request.')).toBeVisible();
  await expect(page.getByTestId('firmivra-answer')).toHaveCount(0);
});

test('SA-FRM-F06: only the Owner sees Requests from Firmivra', async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem('fv-mock-role', 'ADMIN'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/settings/firmivra-requests'));
  await expect(page.getByText("Only the firm's Owner sees Firmivra's requests")).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByRole('navigation', { name: 'Settings' }).getByRole('link', {
      name: 'Requests from Firmivra',
    }),
  ).toHaveCount(0);
});
