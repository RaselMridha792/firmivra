import { expect, test } from '@playwright/test';

// R56: Octavia's Dashboard Review Two, the rows still open after the check (F: checks, not in the
// repo), in mock mode as an Owner. The mock keeps its data in the page. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('§9: a task’s page shows its reminder history: who it reaches, when it goes next, what went out', async ({
  page,
}) => {
  await page.goto(app('/tasks/0199c0f0-0a10-7000-8000-000000000001'));
  const history = page.getByTestId('reminder-history');
  await expect(history).toBeVisible({ timeout: 60_000 });
  await expect(history.getByTestId('reminder-recipients')).toContainText('Goes to:');
  await expect(history.getByTestId('reminder-recipients')).toContainText('never the client');
  await expect(history.getByTestId('reminder-recipients')).toContainText('America/New_York');
  // The reminder that went out: when, to whom, the bell read, the email sent with its id.
  const sent = history.getByTestId('reminder-sent').getByRole('listitem').first();
  await expect(sent).toContainText('Bell: read');
  await expect(sent).toContainText('Email:');
  await expect(sent).toContainText('Sent');
  await expect(sent).toContainText('ID mock-0100');
});
