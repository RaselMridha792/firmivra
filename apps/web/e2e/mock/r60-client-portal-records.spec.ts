// R60, Frame 1's record tabs and Communications (instructions 7 to 9): each lists the client's
// own records, and Messages shows read and unread. Mock mode, as an Owner.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test("the record tabs list the client's records, and Messages shows unread counts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 1200 });
  for (const tab of ['messages', 'appointments', 'tax-returns', 'invoices']) {
    await page.goto(app(`/client-portal?client=${JAMIE}&tab=${tab}`));
    const card = page.getByTestId(`portal-${tab}`);
    await expect(card.locator('li, tbody tr').first()).toBeVisible({ timeout: 60_000 });
  }
  await page.goto(app(`/client-portal?client=${JAMIE}&tab=messages`));
  await expect(
    page
      .getByTestId('portal-messages')
      .getByText(/^(\d+ unread|Read)$/)
      .first(),
  ).toBeVisible({ timeout: 60_000 });
});
