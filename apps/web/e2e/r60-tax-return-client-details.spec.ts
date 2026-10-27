import { expect, test } from '@playwright/test';

// Octavia's TX-F01 (Oct 26 review): Client Details on a client's tax return keeps a long email and
// address inside its card at every supported width, instead of running behind Document Checklist.
// Real API, LVP's seeded 2023 return (packages/db seed-data `lvp2023`), as the Owner.
test.describe.configure({ timeout: 240_000 });

const port = process.env['WEB_PORT'] ?? '3000';
const app = (path: string) => `http://app.localhost:${port}${path}`;
const RETURN = '00000000-0000-4000-9100-000000000001';

test('a long email and address stay inside Client Details at 1440, 1024 and 375 px', async ({
  page,
}) => {
  await page.goto(app('/sign-in'));
  await page.getByRole('button', { name: /owner@lvp\.test/ }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  for (const width of [1440, 1024, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(app(`/tax-returns/${RETURN}`));
    const card = page.getByTestId('client-details');
    await expect(card.locator('dd').first()).toBeVisible({ timeout: 120_000 });
    // Her case: an email and a street with no place to break, longer than the card is wide.
    const inside = await card.evaluate((el) => {
      const values = [...el.querySelectorAll('dd')];
      const email = values[2];
      const address = values[4];
      if (email)
        email.textContent = 'a.very.long.fake.client.address.for.wrapping@example-domain.test';
      if (address) address.textContent = '17171717 Extraordinarilylongstreetnameforthetest Trail';
      const box = el.getBoundingClientRect();
      return values.every(
        (dd) =>
          dd.getBoundingClientRect().right <= box.right + 0.5 &&
          dd.scrollWidth <= dd.clientWidth + 0.5,
      );
    });
    expect([width, inside]).toEqual([width, true]);
  }
});
