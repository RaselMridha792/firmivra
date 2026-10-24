import { expect, test } from '@playwright/test';

// R55, Staff Management review (Oct 23) SM1 and SM7: Bulk Upload reads Excel files as well as CSV,
// maps the template's own headers, says which columns and values it takes, and a file with no
// row to import gets its errors instead of "Something went wrong". In mock mode as the Owner.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/team/import`;
const shots = 'e2e/mock/r55-screenshots/team-import';

/** A minimal .xlsx: one sheet, inline strings and an Excel date cell, stored (not deflated). */
function xlsx(rows: (string | number)[][]): Buffer {
  const cell = (v: string | number, ref: string) =>
    typeof v === 'number'
      ? `<c r="${ref}"><v>${v}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
  const sheet =
    '<worksheet><sheetData>' +
    rows
      .map(
        (r, i) =>
          `<row r="${i + 1}">${r.map((v, j) => cell(v, `${String.fromCharCode(65 + j)}${i + 1}`)).join('')}</row>`,
      )
      .join('') +
    '</sheetData></worksheet>';
  const files: [string, string][] = [['xl/worksheets/sheet1.xml', sheet]];
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const n = Buffer.from(name);
    const data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    parts.push(local, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

test('reads an Excel file, maps its columns and previews it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(url);
  await expect(page.getByText('Employee ID is optional; when given')).toBeVisible();
  await expect(page.getByText('Hire Date: year-month-day')).toBeVisible();
  await page.screenshot({ path: `${shots}/upload-guidance.png`, fullPage: true });
  await page.locator('input[type=file]').setInputFiles({
    name: 'staff.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: xlsx([
      ['firstName', 'lastName', 'email', 'role', 'department', 'hireDate', 'employeeId'],
      ['Ana', 'Park', 'ana.park@example.test', 'Staff', 'Tax', 45658, ''],
    ]),
  });
  const map = page.getByTestId('import-map');
  await expect(map).toContainText('staff.xlsx: 1 row');
  // The template's own headers are mapped.
  for (const field of ['firstName', 'email', 'hireDate', 'employeeId'])
    await expect(map.getByLabel(field, { exact: true })).toHaveValue(field);
  await map.getByRole('button', { name: 'Validate & Preview' }).click();
  const preview = page.getByTestId('import-preview');
  await expect(preview).toContainText('1New staff to create');
  await expect(preview.getByRole('button', { name: 'Import 1 Staff' })).toBeEnabled();
});

test('a file with no row to import lists its errors and imports nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(url);
  await page.locator('input[type=file]').setInputFiles({
    name: 'staff.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'First Name,Last Name,Work Email,Role,Department\nBen,Cole,not-an-email,Staff,Tax\n',
    ),
  });
  await page.getByTestId('import-map').getByRole('button', { name: 'Validate & Preview' }).click();
  const preview = page.getByTestId('import-preview');
  await expect(preview).toContainText('No row can be imported yet.');
  await expect(preview).toContainText('Enter a valid work email');
  await expect(preview.getByRole('button', { name: /^Import/ })).toBeDisabled();
  await page.screenshot({ path: `${shots}/nothing-to-import.png`, fullPage: true });
});

test('a damaged Excel file is refused plainly', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await page.locator('input[type=file]').setInputFiles({
    name: 'staff.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('not a zip'),
  });
  await expect(
    page.getByText('This file could not be read. Save it as Excel (.xlsx) or CSV and try again.'),
  ).toBeVisible();
});
