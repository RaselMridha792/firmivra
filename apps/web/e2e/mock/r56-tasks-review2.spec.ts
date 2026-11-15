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

test('T-C05: Save & Create Another saves, then opens a clean form that says what was saved', async ({
  page,
}) => {
  await openCreate(page);
  await page.getByLabel('Task Name *').fill('Collect the 1099s');
  await page.getByLabel('Task type').selectOption({ label: 'Tax Preparation' });
  await page.getByLabel('Client', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Assigned to').selectOption({ index: 1 });
  await page.locator('#tf-due').fill('2027-03-02');
  await page.getByRole('button', { name: 'Add Checklist Item' }).click();
  await page.getByLabel('Checklist item 1').fill('Ask the client');
  await page.getByTestId('task-save-another').click();
  await expect(page.getByText('Task saved: Collect the 1099s. Add another.')).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await expect(page.getByLabel('Task Name *')).toHaveValue('');
  await expect(page.getByLabel('Task type')).toHaveValue('');
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Checklist item 1')).toHaveCount(0);
  await expect(page.locator('#tf-due')).toHaveValue('');
});

test('T-C08: the Actions column stays on screen while the task table scrolls sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1165, height: 900 });
  await page.goto(base);
  const table = page.getByTestId('task-table');
  const menu = table.getByRole('button', { name: /^Actions for / }).first();
  await expect(menu).toBeVisible({ timeout: 60_000 });
  const scroller = table.locator('.overflow-x-auto').first();
  const wide = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(wide).toBe(true);
  for (const left of [0, 10_000]) {
    await scroller.evaluate((el, x) => (el.scrollLeft = x), left);
    const area = (await scroller.boundingBox())!;
    const b = (await menu.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
    expect(b.x).toBeGreaterThanOrEqual(area.x);
  }
  await expect(menu.locator('xpath=ancestor::td[1]')).toHaveCSS('position', 'sticky');
});
