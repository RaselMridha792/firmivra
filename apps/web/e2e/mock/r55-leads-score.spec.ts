import { expect, test } from '@playwright/test';

// R55, Leads checklist "lead scoring" (v1, packages/types/src/leads/score.ts): the lead's Overview
// shows its score, the label and "Why this score", the parts that gave the points. Mock mode as the
// Owner; the mock computes the score with the API's own function. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const lead = (n: number) =>
  `http://app.localhost:${port}/leads/0199c0c0-0a00-7000-8000-${String(n).padStart(12, '0')}`;

test('the Overview shows the lead score, its label and why', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Selma Shields: a referral with an appointment scheduled, email and phone, two services.
  await page.goto(lead(4));
  await expect(page.getByTestId('lead-name')).toHaveText('Selma Shields');
  const figure = page.getByTestId('figure-lead-score');
  await expect(figure.getByRole('paragraph')).toHaveText('60');
  await expect(figure).toContainText('Medium');
  const why = figure.getByRole('list', { name: 'Why this score' });
  await expect(why).toBeHidden();
  await figure.getByText('Why this score').click();
  await expect(why.getByRole('listitem')).toHaveText([
    'Email and phone on file+16',
    'Interested in a service+4',
    'Source: Referral+15',
    'Stage: Appointment Scheduled+25',
  ]);
});
