import { expect, test } from '@playwright/test';

// R1, Clients batch B (Clients Review 2, R55's independent check): the Client ID on the list and
// the profile, and the search hint that names it and says how to type a phone (N8-06). Mock mode
// as the Owner; client 1 is Jamie Sample, CL-10001. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test.describe.configure({ timeout: 180_000 });

test('§3 and N8-06: the Client ID shows on the list and the profile; the hint names it and the phone rule', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients'));
  await expect(page.getByTestId('client-search-hint')).toHaveText(
    'Search by name, email, company or Client ID (CL-10024). Phone: type numbers only, e.g. 5551234567.',
    { timeout: 60_000 },
  );
  await expect(
    page.getByTestId('client-id').filter({ hasText: 'Client ID CL-10001' }).first(),
  ).toBeVisible();

  await page.goto(app(`/clients/${JAMIE}`));
  await expect(page.getByTestId('client-id')).toHaveText('Client ID CL-10001', {
    timeout: 60_000,
  });
});
