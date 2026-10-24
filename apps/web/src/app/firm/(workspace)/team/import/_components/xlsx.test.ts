import { describe, expect, it } from 'vitest';
import { excelDay, readXlsx } from './xlsx';

// SM7 (Staff Management review, Oct 23): Bulk Upload reads Excel files as well as CSV.

/** A zip of these files, each stored (method 0) or deflated (8). */
async function zip(files: Record<string, string>, method: 0 | 8): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const deflate = async (raw: Uint8Array) =>
    new Uint8Array(
      await new Response(
        new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw')),
      ).arrayBuffer(),
    );
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(content);
    const data = method === 8 ? await deflate(raw) : raw;
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, end] as BlobPart[]).arrayBuffer();
}

const BOOK = {
  'xl/workbook.xml':
    '<workbook xmlns:r="r"><sheets><sheet name="Staff" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':
    '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/staff.xml"/></Relationships>',
  'xl/sharedStrings.xml':
    '<sst><si><t>First Name</t></si><si><t>Last Name</t></si><si><t>Work Email</t></si>' +
    '<si><t>Hire Date</t></si><si><t>Ivy</t></si>' +
    '<si><r><t>Importfake</t></r><r><t xml:space="preserve"> &amp; Co</t></r></si>' +
    '<si><t>ivy@example.test</t></si></sst>',
  'xl/worksheets/staff.xml':
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2" t="s"><v>6</v></c><c r="D2" s="1"><v>45658</v></c></row>' +
    '<row r="3"><c r="A3" s="1"/></row>' +
    '<row r="4"><c r="A4" t="inlineStr"><is><t>Ana</t></is></c><c r="C4" t="inlineStr"><is><t>ana@example.test</t></is></c></row>' +
    '</sheetData></worksheet>',
};

describe('readXlsx', () => {
  for (const method of [0, 8] as const) {
    it(`reads the first sheet's header and rows (${method === 0 ? 'stored' : 'deflated'})`, async () => {
      const file = await readXlsx(await zip(BOOK, method));
      expect(file.headers).toEqual(['First Name', 'Last Name', 'Work Email', 'Hire Date']);
      // The empty row is skipped; a missing cell is empty.
      expect(file.rows).toEqual([
        {
          'First Name': 'Ivy',
          'Last Name': 'Importfake & Co',
          'Work Email': 'ivy@example.test',
          'Hire Date': '45658',
        },
        { 'First Name': 'Ana', 'Last Name': '', 'Work Email': 'ana@example.test', 'Hire Date': '' },
      ]);
    });
  }

  it('refuses a file that is not a zip', async () => {
    await expect(readXlsx(new TextEncoder().encode('a,b\n1,2').buffer)).rejects.toThrow(
      'This is not an Excel (.xlsx) file.',
    );
  });
});

describe('excelDay', () => {
  it('turns an Excel day number into a date and leaves other text alone', () => {
    expect(excelDay('45658')).toBe('2025-01-01');
    expect(excelDay('46327')).toBe('2026-11-01');
    expect(excelDay('2026-01-15')).toBe('2026-01-15');
    expect(excelDay('')).toBe('');
  });
});
