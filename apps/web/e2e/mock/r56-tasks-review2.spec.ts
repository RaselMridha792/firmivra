import { expect, type Locator, type Page, test } from '@playwright/test';

// R56: Octavia's Tasks Review Two, batch 1 (records/lists/tasks.md: T-C04 to T-C13, T-D03,
// T-D04), in mock mode as an Owner. The mock keeps its data in the page, so these tests move
// between pages by their links: a full load starts the data again. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/tasks`;

/** The palette a button wears (T-C07): primary is filled, outline and danger are bordered. */
async function tone(button: Locator): Promise<string> {
  const cls = (await button.getAttribute('class')) ?? '';
  if (cls.includes('bg-action')) return 'primary';
  if (cls.includes('border-action')) return 'outline';
  if (cls.includes('border-danger')) return 'danger';
  return 'secondary';
}

async function openCreate(page: Page) {
  await page.goto(`${base}/new`);
  await expect(page.getByRole('heading', { name: 'Create Task' })).toBeVisible({ timeout: 60_000 });
}

test('T-C07: the task forms use the palette: Save primary, Template and Draft outline, Cancel secondary', async ({
  page,
}) => {
  await openCreate(page);
  expect(await tone(page.getByTestId('task-save'))).toBe('primary');
  expect(await tone(page.getByTestId('task-save-draft'))).toBe('outline');
  expect(await tone(page.getByTestId('task-save-another'))).toBe('outline');
  expect(await tone(page.getByRole('button', { name: 'Save as Template' }))).toBe('outline');
  expect(await tone(page.getByRole('button', { name: 'Cancel' }))).toBe('secondary');

  await page.goto(`${base}/recurring/new`);
  await expect(page.getByTestId('series-save')).toBeVisible({ timeout: 60_000 });
  expect(await tone(page.getByTestId('series-save'))).toBe('primary');
  expect(await tone(page.getByRole('button', { name: 'Save as Template' }))).toBe('outline');
  expect(await tone(page.getByRole('button', { name: 'Cancel' }))).toBe('secondary');
});
