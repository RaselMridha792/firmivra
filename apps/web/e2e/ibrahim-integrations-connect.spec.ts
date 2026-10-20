import { expect, test } from '@playwright/test';

test('seeded owner opens the real provider definition without authorizing an external account', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('http://app.localhost:3000/sign-in');
  await page.getByRole('button', { name: /owner@lvp\.test/ }).click();
  await expect(page.getByTestId('firm-name')).toHaveText('LVP Accounting & Taxes');
  const definition = page.waitForResponse(
    (response) =>
      response.url().endsWith('/business/integrations/providers/microsoft365') &&
      response.request().method() === 'GET',
  );
  await page.goto('http://app.localhost:3000/integrations/microsoft365/connect');
  expect((await definition).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Microsoft 365', exact: true })).toBeVisible();
  for (const section of ['connect', 'configure', 'permissions', 'complete'])
    await expect(page.getByTestId(`setup-${section}`)).toBeVisible();
  await expect(page.getByTestId('page-error')).toHaveCount(0);
});
