import { expect, type Page, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
/** The mock's first client, Jamie Sample, who has a W-2 PDF in Documents. */
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

/** A draft with one file and one saved signer, open on its Fields step. */
async function draft(page: Page) {
  await page.goto(app(`/firm-sign/new?clientId=${JAMIE}`));
  await page.getByLabel('Document name').fill('Synthetic Fields Draft');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/prepare$/);
  await page.getByLabel('File', { exact: true }).selectOption({ label: 'W-2_2025.pdf' });
  await page.getByRole('button', { name: 'Add file' }).click();
  await page.getByRole('link', { name: 'Next: Recipients' }).click();
  await page.getByRole('button', { name: 'Add a signer' }).click();
  const row = page.getByTestId('recipient-row').first();
  await row.getByLabel('Name').fill('Pat Example');
  await row.getByLabel('Email').fill('pat@example.com');
  await page.getByRole('button', { name: 'Save recipients' }).click();
  await page.getByRole('link', { name: 'Next: Fields' }).click();
}

const left = (el: import('@playwright/test').Locator) =>
  el.evaluate((n) => parseFloat((n as HTMLElement).style.left));

test('place, move, resize, duplicate and remove fields, then save them', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await draft(page);
  await expect(page.getByTestId('field-page')).toHaveCount(2);
  const boxes = page.getByTestId('field-box');

  await page
    .getByRole('group', { name: 'Add a field' })
    .getByRole('button', { name: 'Signature' })
    .click();
  await expect(boxes).toHaveCount(1);
  await expect(boxes.first()).toHaveAccessibleName('Signature (required), Pat Example');

  // The keyboard moves it one step right.
  const before = await left(boxes.first());
  await boxes.first().focus();
  await page.keyboard.press('ArrowRight');
  expect(await left(boxes.first())).toBeCloseTo(before + 1, 5);

  // Alt and an arrow make it wider.
  const width = await boxes.first().evaluate((n) => parseFloat((n as HTMLElement).style.width));
  await page.keyboard.press('Alt+ArrowRight');
  await expect
    .poll(() => boxes.first().evaluate((n) => parseFloat((n as HTMLElement).style.width)))
    .toBeCloseTo(width + 1, 5);

  // Dragging moves it with the pointer.
  const box = (await boxes.first().boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 110, box.y + 60, { steps: 5 });
  await page.mouse.up();
  expect(await left(boxes.first())).toBeGreaterThan(before + 5);

  // D duplicates; Delete removes the copy.
  await boxes.first().focus();
  const moved = await left(boxes.first());
  await page.keyboard.press('d');
  await expect(boxes).toHaveCount(2);
  // The copy takes the keyboard: moving it leaves the original where it was.
  await page.keyboard.press('ArrowRight');
  expect(await left(boxes.first())).toBeCloseTo(moved, 5);
  expect(await left(boxes.nth(1))).toBeCloseTo(moved + 1, 5);
  await page.keyboard.press('Delete');
  await expect(boxes).toHaveCount(1);
  expect(await left(boxes.first())).toBeCloseTo(moved, 5);

  await page
    .getByRole('group', { name: 'Add a field' })
    .getByRole('button', { name: 'Date signed' })
    .click();
  await expect(boxes).toHaveCount(2);
  await page.getByRole('button', { name: 'Save fields' }).click();
  await expect(page.getByRole('link', { name: 'Next: Settings' })).toBeVisible();

  // What was saved is what the request now holds.
  const steps = page.getByRole('navigation', { name: 'Steps' });
  await steps.getByRole('link', { name: 'Documents' }).click();
  await steps.getByRole('link', { name: 'Fields' }).click();
  await expect(boxes).toHaveCount(2);
});

test('a phone shows what is placed instead of the editor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await draft(page);
  await expect(page.getByText('Use a tablet or a computer to place or move fields.')).toBeVisible();
});
