// Q28 A-X10 part 2: in the portal's Business Advisory, the resources the firm sent include the
// firm's own: a link one opens in a new tab, and one with an uploaded file downloads it (the file
// is offered only once its virus scan is clean). A built-in one sent as a PDF still downloads as
// before. Mock mode, as client Jamie. Synthetic data.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test("A-X10: the firm's own resources show their link or their file", async ({ page }) => {
  await page.goto(portal('/lvp/services/advisory'));
  const resources = page.getByTestId('advisory-resource');
  const link = resources.filter({ hasText: 'Local Grant Programs (sample)' });
  await expect(link).toContainText('Small-business grants offered near you', { timeout: 60_000 });
  const open = link.getByRole('link', { name: /Open link/ });
  await expect(open).toHaveAttribute('href', 'https://example.com/grants');
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link.getByRole('button', { name: /Download/ })).toHaveCount(0);

  const withFile = resources.filter({ hasText: 'First Hire Checklist (sample)' });
  await expect(withFile.getByRole('link', { name: /Open link/ })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await withFile
    .getByRole('button', {
      name: 'Download First Hire Checklist (sample): First hire checklist.pdf',
    })
    .click();
  expect((await download).suggestedFilename()).toBe('First hire checklist.pdf');

  // A built-in one: no link or file of its own; the one sent as a PDF still downloads.
  const builtIn = resources.filter({ hasText: 'Funding Readiness Checklist' });
  await expect(builtIn.getByRole('link', { name: /Open link/ })).toHaveCount(0);
  await expect(builtIn.getByRole('button')).toHaveCount(0);
  const pdf = page.waitForEvent('download');
  await resources
    .filter({ hasText: 'Cash Flow Basics' })
    .getByRole('button', { name: 'Download Cash Flow Basics (PDF)' })
    .click();
  expect((await pdf).suggestedFilename()).toBe('cash-flow-basics.pdf');

  await page.setViewportSize({ width: 375, height: 900 });
  await expect(withFile.getByRole('button', { name: /Download/ })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
