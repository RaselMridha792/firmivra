import { deflateRawSync } from 'node:zlib';
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';
import type { ReportKpi, ReportRange } from '@firmivra/types';
import type { Computed } from './engine.js';

// IP-F23 (Octavia, Oct 27): a report exported as Excel (XLSX) or PDF, alongside CSV. The files
// hold what the screen's table holds (the same columns, rows and totals); the PDF adds the title,
// range and headline figures. Nothing here reads data: it only lays out what the engine computed.

type Table = Pick<Computed, 'columns' | 'all' | 'totals'>;
type Cell = string | number | boolean | null | undefined;

export const REPORT_FILE_TYPES = {
  CSV: { ext: 'csv', contentType: 'text/csv; charset=utf-8' },
  XLSX: {
    ext: 'xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  PDF: { ext: 'pdf', contentType: 'application/pdf' },
} as const;
export type ReportFileFormat = keyof typeof REPORT_FILE_TYPES;

// ---------- Excel (XLSX) ----------

/** Characters XML 1.0 cannot hold (controls other than tab and line breaks) are dropped. */
const xmlSafe = (s: string) =>
  [...s]
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
    })
    .join('');

const xml = (s: string) =>
  xmlSafe(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A cell reference: column index (0-based) and row (1-based) to "A1". */
const ref = (col: number, row: number) => {
  let name = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return `${name}${row}`;
};

/** One cell: money as a number of dollars (style 1), numbers as numbers, the rest as text. */
function xlsxCell(value: Cell, type: string, col: number, row: number, bold = false): string {
  const r = ref(col, row);
  if (value === null || value === undefined || value === '') return `<c r="${r}"/>`;
  if (typeof value === 'number') {
    const n = type === 'MONEY' ? value / 100 : value;
    return `<c r="${r}" s="${type === 'MONEY' ? (bold ? 3 : 1) : bold ? 2 : 0}"><v>${n}</v></c>`;
  }
  // Inline strings are text, never formulas, whatever they start with.
  return `<c r="${r}" t="inlineStr"${bold ? ' s="2"' : ''}><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`;
}

function sheetXml(t: Table): string {
  const rows: string[] = [];
  rows.push(
    `<row r="1">${t.columns.map((c, i) => xlsxCell(c.label, 'TEXT', i, 1, true)).join('')}</row>`,
  );
  t.all.forEach((r, n) => {
    const row = n + 2;
    rows.push(
      `<row r="${row}">${t.columns.map((c, i) => xlsxCell(r.cells[c.key], c.type, i, row)).join('')}</row>`,
    );
  });
  if (t.totals) {
    const row = t.all.length + 2;
    rows.push(
      `<row r="${row}">${t.columns
        .map((c, i) =>
          c.key in t.totals!
            ? xlsxCell(t.totals![c.key]!, c.type, i, row, true)
            : xlsxCell(i === 0 ? 'Total' : null, 'TEXT', i, row, true),
        )
        .join('')}</row>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows.join('')}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs></styleSheet>`;

/** A workbook of one sheet named after the report (Excel allows 31 characters, no []:*?/\). */
export function toXlsx(t: Table, title: string): Buffer {
  const sheet = xml(
    title
      .replace(/[[\]:*?/\\]/g, ' ')
      .slice(0, 31)
      .trim() || 'Report',
  );
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', sheetXml(t)],
  ];
  return zip(files.map(([name, text]) => [name, Buffer.from(text, 'utf8')]));
}

// ---------- A minimal zip (deflate), enough for an XLSX ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(entries: [string, Buffer][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time and date: none
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ---------- PDF ----------

/** The standard fonts draw WinAnsi only: anything else becomes "?" rather than failing. */
const winAnsi = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

const moneyText = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const cellText = (value: Cell, type: string): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (type === 'MONEY') return moneyText(value);
    if (type === 'PERCENT') return `${value}%`;
    return value.toLocaleString('en-US');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};

const PAGE = { width: 792, height: 612, margin: 36 };
const NAVY = rgb(0.06, 0.13, 0.33);
const GREY = rgb(0.4, 0.42, 0.47);
const RULE = rgb(0.85, 0.87, 0.9);

/** Fits `text` to `width` points, cutting with "..." when it does not. */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  const t = winAnsi(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  let cut = t;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > width)
    cut = cut.slice(0, -1);
  return `${cut}...`;
}

/**
 * A landscape table: the title, the range and the headline figures, then the columns with their
 * rows and the totals, over as many pages as it takes; an empty report says there is no data.
 */
export async function toPdf(
  t: Table,
  info: { title: string; range: ReportRange; kpis: ReportKpi[]; generatedAt: Date },
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(winAnsi(info.title));
  doc.setProducer('Firmivra');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const usable = PAGE.width - PAGE.margin * 2;
  const width = t.columns.length ? usable / t.columns.length : usable;
  const right = (type: string) => type === 'MONEY' || type === 'NUMBER' || type === 'PERCENT';
  let page: PDFPage = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;

  const text = (s: string, x: number, size: number, font: PDFFont, color = NAVY) =>
    page.drawText(s, { x, y, size, font, color });
  const header = () => {
    t.columns.forEach((c, i) => {
      const label = fit(c.label, bold, 8, width - 6);
      const x =
        PAGE.margin +
        i * width +
        (right(c.type) ? width - 3 - bold.widthOfTextAtSize(label, 8) : 3);
      text(label, x, 8, bold);
    });
    y -= 6;
    page.drawLine({
      start: { x: PAGE.margin, y },
      end: { x: PAGE.width - PAGE.margin, y },
      thickness: 0.8,
      color: NAVY,
    });
    y -= 12;
  };
  const row = (cells: (c: Computed['columns'][number]) => Cell, font: PDFFont) => {
    if (y < PAGE.margin + 20) {
      page = doc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - PAGE.margin;
      header();
    }
    t.columns.forEach((c, i) => {
      const s = fit(cellText(cells(c), c.type), font, 8, width - 6);
      const x =
        PAGE.margin + i * width + (right(c.type) ? width - 3 - font.widthOfTextAtSize(s, 8) : 3);
      text(s, x, 8, font, rgb(0.1, 0.1, 0.12));
    });
    y -= 4;
    page.drawLine({
      start: { x: PAGE.margin, y },
      end: { x: PAGE.width - PAGE.margin, y },
      thickness: 0.4,
      color: RULE,
    });
    y -= 10;
  };

  text(fit(info.title, bold, 18, usable), PAGE.margin, 18, bold);
  y -= 18;
  text(
    winAnsi(
      `${info.range.label} (${info.range.from} to ${info.range.to}, ${info.range.timezone}) - generated ${info.generatedAt.toISOString().slice(0, 10)}`,
    ),
    PAGE.margin,
    9,
    regular,
    GREY,
  );
  y -= 22;
  if (info.kpis.length) {
    const kw = usable / Math.min(info.kpis.length, 4);
    info.kpis.slice(0, 4).forEach((k, i) => {
      const x = PAGE.margin + i * kw;
      page.drawText(fit(k.label, regular, 8, kw - 8), {
        x,
        y,
        size: 8,
        font: regular,
        color: GREY,
      });
      const v =
        k.value === null
          ? 'N/A'
          : typeof k.value === 'number'
            ? cellText(k.value, k.type)
            : k.value;
      page.drawText(fit(v, bold, 14, kw - 8), { x, y: y - 16, size: 14, font: bold, color: NAVY });
    });
    y -= 40;
  }
  header();
  if (t.all.length === 0) {
    text('There is no data in this range.', PAGE.margin + 3, 9, regular, GREY);
  } else {
    for (const r of t.all) row((c) => r.cells[c.key], regular);
    if (t.totals)
      row(
        (c) => (c.key in t.totals! ? t.totals![c.key]! : c === t.columns[0] ? 'Total' : null),
        bold,
      );
  }
  return Buffer.from(await doc.save());
}
