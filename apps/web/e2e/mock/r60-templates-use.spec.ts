import { expect, test, type Page } from '@playwright/test';

// R60, Octavia's Oct 28 Templates review, TP-F08 part 2 (playwright.mock.config.ts, as an Owner;
// the mock answers as the API): a Task or Document Request template's Use starts its module's own
// task or request from the template it stands for, its Preview shows the steps, and Use says what
// is missing until one is chosen. Tax Workflow and Bookkeeping keep Use off, with the reason. A
// reload resets the mock, so the library is reached again with Back.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/templates`;
test.use({ viewport: { width: 1440, height: 1000 } });

const offUse = (page: Page, name: string) =>
  page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: `Use ${name}` });

/** Opens the template from its library, chooses what it stands for, saves, and goes Back. */
const link = async (page: Page, slug: string, name: string, picker: string, choice: string) => {
  await page.goto(`${base}/library/${slug}`);
  await expect(offUse(page, name)).toHaveAccessibleDescription(
    /^Choose the .+ it stands for under Structure in the editor first\.$/,
  );
  await page.getByRole('link', { name, exact: true }).click();
  await page.waitForURL(/\/edit$/);
  await page.getByTestId('structure-panel').getByLabel(picker).selectOption({ label: choice });
  await page.getByTestId('save-template').click();
  await expect(page.getByText('Template saved.').filter({ visible: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('library-page')).toBeVisible();
};

test('a Task template starts a task from its task template, and its Preview shows the steps', async ({
  page,
}) => {
  const name = 'Standard Client Follow-Up Task Checklist';
  await link(page, 'task', name, 'Task template', 'Return review');
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row.getByRole('link', { name: `Use ${name}` })).toHaveAttribute(
    'href',
    /^\/tasks\/new\?template=[0-9a-f-]{36}$/,
  );
  await row.getByRole('button', { name: `Preview ${name}` }).click();
  const structure = page.getByRole('region', { name: 'Saved structure' });
  await expect(structure).toContainText('Return review');
  await expect(structure.getByRole('listitem')).toHaveText([
    'Check income and deductions',
    'Review with the client',
    'Collect signatures',
  ]);
});

test('a Document Request template opens Create Request with its documents added', async ({
  page,
}) => {
  const name = 'Secure Document Upload Request';
  await link(page, 'document-request', name, 'Requested documents', 'Personal Tax Documents');
  await page.getByRole('link', { name: `Use ${name}` }).click();
  await page.waitForURL(/\/documents\/requests\/new\?template=/);
  await expect(page.getByText('W-2 Forms (All Employers)').first()).toBeVisible({
    timeout: 30_000,
  });
});

test('Bookkeeping keeps Use off with the reason; its Preview says no structure yet', async ({
  page,
}) => {
  const name = 'Monthly Books Completed';
  await page.goto(`${base}/library/bookkeeping`);
  await expect(offUse(page, name)).toHaveAccessibleDescription(
    /^Bookkeeping cannot start from a template yet/,
  );
  await page
    .getByRole('row', { name: new RegExp(name) })
    .getByRole('button', {
      name: `Preview ${name}`,
    })
    .click();
  await expect(page.getByRole('region', { name: 'Saved structure' })).toContainText(
    'No structure yet.',
  );
});
