import { expect, test, type Page } from '@playwright/test';

// R60, Octavia's Oct 28 Communications review, the segments block (playwright.mock.config.ts, as
// an Owner; the mock answers as the API): CM-F13 Last Refreshed, CM-F14 Owner, CM-F15 all or any
// of the rules, CM-F16 the live count with who matches, CM-F17 a saved segment's rules edited,
// CM-F18 a list's people added and removed.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/communications`;
test.use({ viewport: { width: 1440, height: 1000 } });

const segments = async (page: Page) => {
  await page.goto(base);
  await page.getByRole('tab', { name: 'Segments & Lists' }).click();
  await expect(page.getByTestId('segments-panel')).toContainText('All Clients');
};
const row = (page: Page, name: string) =>
  page.getByTestId('segments-panel').getByRole('row', { name: new RegExp(name) });

test('the list shows Owner and Last Refreshed; a rename keeps Last Refreshed (CM-F13, F14)', async ({
  page,
}) => {
  await segments(page);
  const panel = page.getByTestId('segments-panel');
  await expect(panel.getByRole('columnheader', { name: 'Owner' })).toBeVisible();
  await expect(panel.getByRole('columnheader', { name: 'Last Refreshed' })).toBeVisible();
  const payroll = row(page, 'Payroll Clients');
  const before = await payroll.getByRole('cell').nth(5).innerText();
  await page.getByRole('button', { name: 'Actions for Payroll Clients' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const dialog = page.getByTestId('segment-dialog');
  await dialog.getByLabel('Description (optional)').fill('Only the words changed');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Segment' }).click();
  await expect(page.getByText('Segment saved.').filter({ visible: true })).toBeVisible();
  await expect(payroll.getByRole('cell').nth(5)).toHaveText(before);
});

test('Match any widens the rules, the count says who matches, and the edit is kept (CM-F15 to F17)', async ({
  page,
}) => {
  await segments(page);
  await page.getByRole('button', { name: 'Actions for Payroll Clients' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const dialog = page.getByTestId('segment-dialog');
  const count = dialog.getByTestId('segment-count');
  await expect(dialog.getByTestId('criteria')).toContainText('where all of these are true');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  // The second rule needs a value to count.
  const value = dialog.getByLabel('Value').nth(1);
  if (await value.evaluate((el) => el.tagName === 'SELECT')) await value.selectOption({ index: 1 });
  else await value.fill('GA');
  const matching = async () => {
    await expect(count).toContainText(/people match right now \(at /);
    return Number(/(\d+) people match/.exec(await count.innerText())?.[1]);
  };
  const all = await matching();
  await dialog.getByLabel('Match').selectOption('OR');
  await expect(dialog.getByTestId('criteria')).toContainText('where any of these are true');
  await expect.poll(matching).toBeGreaterThan(all);
  await expect(dialog.getByTestId('segment-sample')).toContainText('For example:');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Segment' }).click();
  await expect(page.getByText('Segment saved.').filter({ visible: true })).toBeVisible();

  await page.getByRole('button', { name: 'Actions for Payroll Clients' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page.getByTestId('segment-dialog').getByLabel('Match')).toHaveValue('OR');
  await expect(
    page.getByTestId('segment-dialog').getByRole('button', { name: /^Remove rule/ }),
  ).toHaveCount(2);
});

test("a list's people are added and removed, then saved (CM-F18)", async ({ page }) => {
  await segments(page);
  await page.getByRole('button', { name: 'New Segment' }).click();
  const dialog = page.getByTestId('segment-dialog');
  await dialog.getByLabel('Name').fill('Open house invites');
  await dialog.getByLabel('Kind').selectOption('STATIC');
  const picks = dialog.getByTestId('list-picker').getByRole('checkbox');
  await picks.nth(0).check();
  await picks.nth(1).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(row(page, 'Open house invites')).toContainText('2');

  await page.getByRole('button', { name: 'Open house invites', exact: true }).click();
  const members = page.getByTestId('members-dialog');
  const list = members.getByRole('list', { name: 'Members' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await list
    .getByRole('button', { name: /^Remove / })
    .first()
    .click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  const add = members.getByTestId('add-people');
  await add.getByRole('button', { name: /^Add / }).filter({ hasText: 'Add' }).nth(2).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('dialog').getByRole('button', { name: 'Save Members' }).click();
  await expect(
    page.getByText('Open house invites saved: 2 members.').filter({ visible: true }),
  ).toBeVisible();
  await expect(row(page, 'Open house invites').getByRole('cell').nth(5)).not.toHaveText('—');
});
