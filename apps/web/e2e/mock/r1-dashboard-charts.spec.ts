import { expect, type Page, test } from '@playwright/test';

// Dashboard Review 2 (R1): C2 and V3 (a revenue bar shows its value on hover and focus and opens
// the payments of its days), C4 (a Service Breakdown segment or legend line shows its amount and
// opens that service's payments) and R2 NEW3 to NEW5 (Custom keeps the title and the dropdown on
// one row, with whole From and To pairs below). Mock mode, the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function dashboard(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(app('/'));
  await expect(page.getByTestId('revenue-bar').first()).toBeAttached({ timeout: 60_000 });
}

test('a revenue bar shows its value on hover and opens the payments of its days', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await dashboard(page);
  const revenue = page.getByRole('region', { name: 'Revenue Overview' });
  const bar = revenue.getByTestId('revenue-bar').first();
  await bar.hover();
  await expect(bar.getByRole('tooltip')).toBeVisible();
  await expect(bar.getByRole('tooltip')).toContainText('$');
  const link = bar.getByRole('link');
  await expect(link).toHaveAccessibleName(/^.+: \$[\d,]+\. Open the payments$/);
  await expect(link).toHaveAttribute(
    'href',
    /^\/invoices\/payments\?start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}&back=dashboard$/,
  );
  const href = (await link.getAttribute('href'))!;
  const [, start, end] = /start=([\d-]+)&end=([\d-]+)/.exec(href)!;
  await link.click();
  await expect(page.getByTestId('all-payments')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel('From', { exact: true })).toHaveValue(start!);
  await expect(page.getByLabel('To', { exact: true })).toHaveValue(end!);
  await expect(page.getByTestId('back-to-dashboard')).toBeVisible();
});

test("a service's line shows its amount and opens that service's payments", async ({ page }) => {
  test.setTimeout(120_000);
  await dashboard(page);
  const services = page.getByRole('region', { name: 'Service Breakdown' });
  const line = services.getByRole('link').first();
  await line.hover();
  await expect(services.getByTestId('service-center')).not.toContainText('Total Revenue');
  await line.focus();
  await expect(line).toHaveAttribute(
    'href',
    /^\/invoices\/payments\?start=[\d-]+&end=[\d-]+&service=([0-9a-f-]{36}|NONE)&back=dashboard$/,
  );
  await line.click();
  await expect(page.getByTestId('service-filter')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: "Show every service's payments" }).click();
  await expect(page.getByTestId('service-filter')).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`Custom keeps each title beside its dropdown, with whole date pairs below, at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await dashboard(page, width);
    for (const name of ['Client Pipeline', 'Revenue Overview', 'Service Breakdown']) {
      const widget = page.getByRole('region', { name });
      const select = widget.getByRole('combobox', { name: `${name} period` });
      await select.selectOption({ label: 'Custom' });
      const heading = widget.getByRole('heading', { name, level: 2 });
      const [h, s] = [(await heading.boundingBox())!, (await select.boundingBox())!];
      // The dropdown is on the title's row: their middles line up.
      expect(Math.abs(h.y + h.height / 2 - (s.y + s.height / 2)), name).toBeLessThan(12);
      const dates = widget.getByTestId('custom-dates');
      const from = dates.getByLabel('From');
      const fromLabel = dates.getByText('From', { exact: true });
      const to = dates.getByLabel('To');
      const toLabel = dates.getByText('To', { exact: true });
      const [fl, fi, tl, ti] = await Promise.all(
        [fromLabel, from, toLabel, to].map(async (l) => (await l.boundingBox())!),
      );
      // Below the title, each label on its own field's line, right before it.
      expect(fi!.y, name).toBeGreaterThan(h.y + h.height - 1);
      for (const [label, input] of [
        [fl!, fi!],
        [tl!, ti!],
      ] as const) {
        expect(Math.abs(label.y + label.height / 2 - (input.y + input.height / 2))).toBeLessThan(8);
        expect(input.x - (label.x + label.width)).toBeGreaterThanOrEqual(0);
        expect(input.x - (label.x + label.width)).toBeLessThan(24);
      }
      if (width >= 1440)
        expect(Math.abs(fi!.y - ti!.y), `${name}: pairs side by side`).toBeLessThan(4);
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    await page
      .getByRole('region', { name: 'Revenue Overview' })
      .screenshot({ path: `e2e/screenshots/r1-dashboard-charts/revenue-custom-${width}.png` });
  });
}
