// IP-F23 (Octavia, Oct 27): the Excel and PDF builders of a report export.
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { cellText, crc32, toPdf, toXlsx, zip } from '../../src/reports/report-formats.js';

const table = {
  columns: [
    { key: 'client', label: 'Client', type: 'TEXT' as const, locked: true, sortable: true },
    { key: 'amount', label: 'Amount', type: 'MONEY' as const, locked: false, sortable: true },
  ],
  all: [
    { cells: { client: '=HYPERLINK("http://evil.test") <Fake & Co>', amount: 12_345 }, links: [] },
    { cells: { client: 'Ünïcode “quoted” — name', amount: null }, links: [] },
  ],
  totals: { amount: 12_345 },
};

function entries(bytes: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    const size = bytes.readUInt32LE(at + 18);
    const nameLength = bytes.readUInt16LE(at + 26);
    const start = at + 30 + nameLength + bytes.readUInt16LE(at + 28);
    const data = inflateRawSync(bytes.subarray(start, start + size));
    expect(crc32(data)).toBe(bytes.readUInt32LE(at + 14));
    out.set(bytes.subarray(at + 30, at + 30 + nameLength).toString('utf8'), data.toString('utf8'));
    at = start + size;
  }
  return out;
}

describe('crc32 and zip', () => {
  it('match the standard check value and read back', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    const z = zip([['a.txt', Buffer.from('hello')]]);
    expect(entries(z).get('a.txt')).toBe('hello');
  });
});

describe('toXlsx', () => {
  it('writes text as text (never a formula), money as dollars, and the totals', () => {
    const sheet = entries(toXlsx(table as never, 'Revenue: Q1 [2026]')).get(
      'xl/worksheets/sheet1.xml',
    )!;
    expect(sheet).toContain('=HYPERLINK(&quot;http://evil.test&quot;) &lt;Fake &amp; Co&gt;');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('<c r="B2" s="1"><v>123.45</v></c>');
    expect(sheet).toContain('<c r="B3"/>');
    expect(sheet).toContain('Total');
    const book = entries(toXlsx(table as never, 'Revenue: Q1 [2026]')).get('xl/workbook.xml')!;
    expect(book).toContain('name="Revenue  Q1  2026"');
  });
});

describe('toPdf', () => {
  it('makes a document with the title, empty or not, whatever the characters', async () => {
    const range = {
      from: '2026-01-01',
      to: '2026-12-31',
      timezone: 'America/New_York',
      label: 'This Year',
    };
    const kpis = [
      {
        key: 'amount',
        label: 'Total Amount',
        type: 'MONEY' as const,
        value: 12_345,
        previous: null,
        deltaPercent: null,
        definition: null,
      },
    ];
    const doc = await PDFDocument.load(
      await toPdf(table as never, {
        title: 'Revenue “Summary”',
        range,
        kpis,
        generatedAt: new Date(),
      }),
    );
    expect(doc.getTitle()).toBe('Revenue "Summary"');
    expect(doc.getPageCount()).toBe(1);
    const empty = await PDFDocument.load(
      await toPdf({ ...table, all: [], totals: null } as never, {
        title: 'Empty',
        range,
        kpis: [],
        generatedAt: new Date(),
      }),
    );
    expect(empty.getPageCount()).toBe(1);
  });

  it('runs onto more pages when the rows do not fit', async () => {
    const many = { ...table, all: Array.from({ length: 120 }, () => table.all[0]!) };
    const doc = await PDFDocument.load(
      await toPdf(many as never, {
        title: 'Long',
        range: { from: '2026-01-01', to: '2026-01-31', timezone: 'UTC', label: 'January' },
        kpis: [],
        generatedAt: new Date(),
      }),
    );
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});

describe('cellText', () => {
  it('shows money, numbers and yes or no in words', () => {
    expect(cellText(-1_050, 'MONEY')).toBe('-$10.50');
    expect(cellText(1234, 'NUMBER')).toBe('1,234');
    expect(cellText(true, 'TEXT')).toBe('Yes');
    expect(cellText(null, 'TEXT')).toBe('');
  });
});
