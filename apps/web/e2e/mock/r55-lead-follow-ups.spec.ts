import { expect, test } from '@playwright/test';

// R55, L8 (Octavia's Leads review of Oct 20): a lead's follow-up steps. Add New Lead takes several;
// the Lead Workspace's Next Action / Follow-Up card lists them, adds one, edits one, completes one
// and removes one. In mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const lead = `${app}/leads/0199c0c0-0a00-7000-8000-000000000001`;

test('the Next Action card adds, edits, completes and removes steps', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${lead}/tasks`);
  const card = page.getByTestId('card-follow-up');
  const steps = card.getByTestId('follow-up-steps').getByRole('listitem');
  // The seeded next action is the first step.
  await expect(steps).toHaveCount(1);

  await card.getByLabel('Action Type').selectOption('SMS');
  await card.locator('#fu-date').fill('2027-01-05');
  await card.getByRole('button', { name: '+ Add Follow-Up' }).click();
  await expect(card.getByText('Follow-up added.')).toBeVisible();
  await expect(steps).toHaveCount(2);

  const sms = steps.filter({ hasText: 'SMS' });
  await sms.getByRole('button', { name: 'Edit follow-up' }).click();
  await card.getByLabel('Notes').fill('Ask for the W-2 copy');
  await card.getByRole('button', { name: 'Save Step' }).click();
  await expect(card.getByText('Follow-up changed.')).toBeVisible();
  await expect(sms).toContainText('Ask for the W-2 copy');

  await sms.getByRole('button', { name: 'Complete follow-up' }).click();
  await expect(card.getByText('Follow-up completed and logged.')).toBeVisible();
  await expect(steps.last()).toContainText('Done');
  await expect(steps.last().getByRole('button')).toHaveCount(0);
  await card.screenshot({ path: 'test-results/r55-lead-follow-ups-1440.png' });

  await steps.first().getByRole('button', { name: 'Remove follow-up' }).click();
  await expect(card.getByText('Follow-up removed.')).toBeVisible();
  await expect(steps).toHaveCount(1);
  await expect(card).toContainText('No follow-up is scheduled.');
});

test('Add New Lead saves several follow-up steps', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/leads`);
  await page.getByRole('button', { name: 'Add New Lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill('Rowan');
  await dialog.getByLabel('Last name').fill('Stepfake');
  await dialog.getByRole('textbox', { name: 'Email' }).fill('rowan.stepfake@example.test');
  const add = dialog.getByRole('button', { name: '+ Add Follow-Up' });
  await add.click();
  await add.click();
  await add.click();
  const one = dialog.getByRole('group', { name: 'Follow-up 1' });
  await one.getByLabel('Date').fill('2027-02-01');
  const two = dialog.getByRole('group', { name: 'Follow-up 2' });
  await two.getByLabel('Action type').selectOption('EMAIL');
  await two.getByLabel('Date').fill('2027-02-08');
  await dialog.getByRole('button', { name: 'Remove follow-up 3' }).click();
  await expect(dialog.getByRole('group', { name: /Follow-up \d/ })).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Save Lead' }).click();
  await expect(dialog).toHaveCount(0);

  await page
    .getByRole('table', { name: 'Leads' })
    .getByRole('link', { name: /Rowan Stepfake/ })
    .click();
  const card = page.getByTestId('card-follow-up');
  await expect(card.getByTestId('follow-up-steps').getByRole('listitem')).toHaveCount(2);
  await expect(page.getByTestId('figure-next-follow-up')).toContainText('Call');
});
