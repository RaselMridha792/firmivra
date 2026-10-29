import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';
import type { Invoice } from '@firmivra/types';

// IP-F09 (Octavia, Oct 27): an invoice as a PDF, the firm's Download PDF. What the client is
// billed: the firm, the client, the number and dates, the lines and the amounts, and what is
// still to pay. Firm-only things (notes, history, the "client sees" status) are never on it.

/** The standard fonts draw WinAnsi only: anything else becomes "?" rather than failing. */
const winAnsi = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const dayText = (d: string | null) =>
  d
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`))
    : '-';

const PAGE = { width: 612, height: 792, margin: 48 };
const NAVY = rgb(0.06, 0.13, 0.33);
const GREY = rgb(0.4, 0.42, 0.47);
const INK = rgb(0.1, 0.1, 0.12);
const RULE = rgb(0.85, 0.87, 0.9);

const STATUS: Record<Invoice['status'], string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  OPEN: 'Open',
  PAID: 'Paid',
  CANCELED: 'Canceled',
};

function fit(text: string, font: PDFFont, size: number, width: number): string {
  const t = winAnsi(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  let cut = t;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > width)
    cut = cut.slice(0, -1);
  return `${cut}...`;
}

export async function renderInvoicePdf(invoice: Invoice, firmName: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(winAnsi(`Invoice ${invoice.number}`));
  doc.setAuthor(winAnsi(firmName));
  doc.setProducer('Firmivra');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const write = (s: string, x: number, size: number, font: PDFFont, color = INK) =>
    page.drawText(s, { x, y, size, font, color });
  const writeRight = (s: string, xEnd: number, size: number, font: PDFFont, color = INK) =>
    write(s, xEnd - font.widthOfTextAtSize(s, size), size, font, color);

  write(fit(firmName, bold, 16, 300), PAGE.margin, 16, bold, NAVY);
  writeRight('INVOICE', right, 22, bold, NAVY);
  y -= 26;
  writeRight(winAnsi(invoice.number), right, 11, bold);
  y -= 30;

  write('Billed to', PAGE.margin, 9, regular, GREY);
  const facts: [string, string][] = [
    ['Status', STATUS[invoice.status]],
    ['Issued', dayText(invoice.issuedAt)],
    ['Due', dayText(invoice.dueOn)],
  ];
  facts.forEach(([label, value], i) => {
    const yy = y - i * 14;
    page.drawText(label, { x: right - 170, y: yy, size: 9, font: regular, color: GREY });
    const v = winAnsi(value);
    page.drawText(v, {
      x: right - bold.widthOfTextAtSize(v, 10),
      y: yy,
      size: 10,
      font: bold,
      color: INK,
    });
  });
  y -= 14;
  write(fit(invoice.client.displayName, bold, 12, 300), PAGE.margin, 12, bold);
  if (invoice.service) {
    y -= 14;
    write(fit(invoice.service.title, regular, 10, 300), PAGE.margin, 10, regular, GREY);
  }
  y -= 46;

  // The lines.
  const cols = { item: PAGE.margin, qty: right - 210, unit: right - 120, amount: right };
  const header = () => {
    write('Description', cols.item, 9, bold, NAVY);
    writeRight('Qty', cols.qty + 30, 9, bold, NAVY);
    writeRight('Unit price', cols.unit + 50, 9, bold, NAVY);
    writeRight('Amount', cols.amount, 9, bold, NAVY);
    y -= 6;
    page.drawLine({
      start: { x: PAGE.margin, y },
      end: { x: right, y },
      thickness: 0.8,
      color: NAVY,
    });
    y -= 14;
  };
  header();
  for (const line of invoice.lines) {
    if (y < PAGE.margin + 140) {
      page = doc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - PAGE.margin;
      header();
    }
    write(fit(line.description, regular, 10, cols.qty - cols.item - 30), cols.item, 10, regular);
    writeRight(String(line.quantity), cols.qty + 30, 10, regular);
    writeRight(money(line.unitAmountCents), cols.unit + 50, 10, regular);
    writeRight(money(line.amountCents), cols.amount, 10, regular);
    y -= 6;
    page.drawLine({
      start: { x: PAGE.margin, y },
      end: { x: right, y },
      thickness: 0.4,
      color: RULE,
    });
    y -= 14;
  }

  // The amounts.
  y -= 6;
  const totals: (readonly [string, number, boolean])[] = [
    ['Subtotal', invoice.subtotalCents, false],
    ...(invoice.discountCents > 0 ? [['Discount', -invoice.discountCents, false] as const] : []),
    ['Total', invoice.totalCents, true],
    ...(invoice.amountPaidCents > 0 ? [['Paid', -invoice.amountPaidCents, false] as const] : []),
    ['Balance due', invoice.balanceDueCents, true],
  ];
  for (const [label, cents, strong] of totals) {
    const font = strong ? bold : regular;
    page.drawText(label, { x: right - 200, y, size: 10, font, color: strong ? NAVY : GREY });
    writeRight(money(cents), right, strong ? 11 : 10, font);
    y -= 18;
  }
  if (invoice.status === 'CANCELED') {
    y -= 10;
    write('This invoice was canceled.', PAGE.margin, 10, bold, rgb(0.7, 0.1, 0.1));
  }
  return doc.save();
}
