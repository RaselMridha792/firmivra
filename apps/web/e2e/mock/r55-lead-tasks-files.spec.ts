import { expect, test } from '@playwright/test';

// R55, Leads Review Two (Octavia, Nov 8) R2 2 and R2 4: Add Task opens Create Task on the lead with
// a way back and saves the lead's own task; Upload Document opens on the lead and adds the file to
// it. In mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const LEAD = '0199c0c0-0a00-7000-8000-000000000001';

test('Add Task opens on the lead, saves its task and returns to it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/leads/${LEAD}/tasks`);
  await page.getByTestId('card-open-tasks').getByRole('link', { name: 'Add Task' }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/new\\?leadId=${LEAD}$`));
  const form = page.getByTestId('lead-task-create');
  await expect(form.getByTestId('lead-task-for')).toContainText('Avery Lawson');
  await expect(form.getByRole('link', { name: 'Back to Avery Lawson' })).toBeVisible();

  // Required fields first.
  await form.getByRole('button', { name: 'Save Task' }).click();
  await expect(form).toContainText('Enter the task name');
  await expect(form).toContainText('Choose a due date');

  await form.getByLabel('Task name *').fill('Call about the extension');
  await form.getByLabel('Due date *').fill('2030-02-03');
  await form.getByRole('button', { name: 'Save Task' }).click();
  await expect(page).toHaveURL(new RegExp(`/leads/${LEAD}/tasks$`));
  const card = page.getByTestId('card-open-tasks');
  await expect(card).toContainText('Call about the extension');

  // Ticked off from the card.
  await card.getByRole('checkbox', { name: 'Mark Call about the extension done' }).click();
  await expect(card).not.toContainText('Call about the extension');
});

test('Upload Document from the lead adds the file to that lead', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/leads/${LEAD}/documents`);
  await page.getByTestId('card-documents').getByRole('link', { name: 'Upload Document' }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/upload\\?leadId=${LEAD}$`));
  const upload = page.getByTestId('lead-upload');
  await expect(upload.getByRole('radio', { name: /Lead/ })).toBeChecked();
  await expect(upload).toContainText('Avery Lawson');

  await page.locator('input[type="file"]').setInputFiles({
    name: 'engagement-letter.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic\n%%EOF\n'),
  });
  await upload.getByRole('button', { name: 'Upload Document' }).click();
  await expect(upload.getByRole('status')).toContainText('added to Avery Lawson');

  await upload.getByRole('button', { name: 'Back to Avery Lawson' }).click();
  await expect(page).toHaveURL(new RegExp(`/leads/${LEAD}/documents$`));
  const documents = page.getByTestId('card-documents');
  await expect(documents).toContainText('engagement-letter.pdf');
  await expect(documents).toContainText('Added by Morgan Avery');
});
