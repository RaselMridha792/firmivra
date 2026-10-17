import { expect, test } from '@playwright/test';

// R56: the Intake Form submission detail under /intake-forms/[id] in mock mode
// (playwright.mock.config.ts runs every module on mock data as an Owner). Form 3 is a submitted
// one with documents and a note; form 4 has only been sent.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const form = (n: number, tab = '') =>
  `http://app.localhost:${port}/intake-forms/0199c0d0-0a00-7000-8000-${String(n).padStart(12, '0')}${tab}`;
const TABS = ['', '/responses', '/documents', '/notes', '/communication', '/history'];

test('every tab keeps the header, the client card and the tab bar', async ({ page }) => {
  for (const tab of TABS) {
    await page.goto(form(3, tab));
    await expect(
      page.getByRole('heading', { name: 'Intake Form Details', level: 1 }),
    ).toBeVisible();
    await expect(page.getByTestId('client-card')).toContainText('Bruno Sandoval');
    const bar = page.getByRole('navigation', { name: 'Submission' });
    await expect(bar.getByRole('link')).toHaveCount(6);
    await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);
  }
  await page.goto(form(3));
  await page
    .getByRole('navigation', { name: 'Submission' })
    .getByRole('link', { name: 'Notes' })
    .click();
  await expect(page).toHaveURL(/\/notes$/);
});

test('Overview: the cards, the summary and the right column', async ({ page }) => {
  await page.goto(form(3));
  for (const id of [
    'card-personal',
    'card-dependents',
    'card-income',
    'card-deductions',
    'card-bank',
    'card-ready',
    'rail-summary',
    'rail-documents',
    'rail-notes',
    'rail-history',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId('card-personal')).toContainText('XXX-XX-4821');
  await expect(page.getByTestId('card-dependents')).toContainText('Marcus');
  await expect(page.getByTestId('rail-summary')).toContainText('100%');
});

test('Overview of a form only sent keeps every frame', async ({ page }) => {
  await page.goto(form(4));
  await expect(page.getByTestId('card-personal')).toBeVisible();
  await expect(page.getByTestId('card-ready')).toContainText('Waiting for the client');
  await expect(page.getByRole('button', { name: 'Mark Reviewed' })).toBeDisabled();
});

test('Responses lists every section of the form', async ({ page }) => {
  await page.goto(form(3, '/responses'));
  await expect(page.getByTestId('section-personal')).toContainText('Filing Status');
  await expect(page.getByTestId('section-dependents')).toContainText('Marcus');
  await expect(page.getByTestId('section-deductions')).toBeVisible();
});

test('Documents lists the uploads with their scan result', async ({ page }) => {
  await page.goto(form(3, '/documents'));
  await expect(page.getByTestId('document-list').getByRole('listitem')).toHaveCount(4);
  await expect(page.getByTestId('documents')).toContainText('Clean');
});

test('Notes: adds a note and shows it first', async ({ page }) => {
  await page.goto(form(3, '/notes'));
  await page.getByLabel('Add a note (only your firm sees it)').fill('Asked for the 2024 return.');
  await page.getByRole('button', { name: 'Save Note' }).click();
  await expect(page.getByTestId('note-list').getByRole('listitem').first()).toContainText(
    'Asked for the 2024 return.',
  );
});

test('Communication and History show what happened', async ({ page }) => {
  await page.goto(form(3, '/communication'));
  await expect(page.getByTestId('communication')).toContainText('Form sent to client');
  await page.goto(form(3, '/history'));
  await expect(page.getByTestId('history')).toContainText('Form submitted');
});

test('Mark Reviewed completes the form', async ({ page }) => {
  await page.goto(form(3));
  await page.getByRole('button', { name: 'Mark Reviewed' }).click();
  await expect(page.getByText('Marked as reviewed.')).toBeVisible();
  await expect(page.getByTestId('client-card')).toContainText('Completed');
});

test('Request Revision asks for a note and sends the form back', async ({ page }) => {
  await page.goto(form(8));
  await page.getByRole('button', { name: 'Request Revision' }).click();
  await page.getByLabel('What should the client change?').fill('Please add the missing 1099.');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Revision requested.')).toBeVisible();
});

test('No sideways scroll at 375 px on any tab', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const tab of TABS) {
    await page.goto(form(3, tab));
    await expect(page.getByTestId('client-card')).toBeVisible();
    await page.waitForTimeout(500);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over, tab || 'overview').toBeLessThanOrEqual(1);
  }
});
