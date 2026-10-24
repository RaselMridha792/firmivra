import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';
import {
  BILLING_INVOICE_STATUS_LABELS,
  BILLING_PAYMENT_METHOD_LABELS,
  type FirmBillingInvoice,
} from '@firmivra/types';

// Download PDF of one Firmivra invoice (Settings > Billing): the header, who it is for, the
// dates, the lines, the totals and the payments. Built from the same answer the View dialog shows.

const PAGE = { width: 612, height: 792, margin: 54 };
const LINE = 15;
const GREY = rgb(0.35, 0.35, 0.35);
const NAVY = rgb(0.04, 0.17, 0.36);

/** The standard fonts draw WinAnsi only: quotes and dashes become plain ones, anything else "?". */
export function printable(value: string): string {
  return [...value.normalize('NFKC')]
    .map((c) => {
      const cp = c.codePointAt(0) ?? 0;
      if (cp === 0x2018 || cp === 0x2019) return "'";
      if (cp === 0x201c || cp === 0x201d) return '"';
      if (cp === 0x2013 || cp === 0x2014) return '-';
      return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) ? c : '?';
    })
    .join('');
}

export const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** "Oct 18, 2026" from a UTC day. */
export const dayText = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** The invoice as a one-page (or longer) PDF. */
export async function invoicePdf(invoice: FirmBillingInvoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Firmivra invoice ${invoice.number}`);
  doc.setAuthor('Firmivra');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;

  const room = (lines = 1) => {
    if (y - lines * LINE >= PAGE.margin) return;
    page = doc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - PAGE.margin;
  };
  const draw = (
    text: string,
    x: number,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; right?: boolean } = {},
  ) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10;
    const safe = printable(text);
    const left = opts.right ? x - font.widthOfTextAtSize(safe, size) : x;
    page.drawText(safe, { x: left, y, size, font, color: opts.color ?? rgb(0, 0, 0) });
  };
  const right = PAGE.width - PAGE.margin;

  draw('Firmivra', PAGE.margin, { font: bold, size: 18, color: NAVY });
  draw(`Invoice ${invoice.number}`, right, { font: bold, size: 14, color: NAVY, right: true });
  y -= LINE * 1.6;
  draw(BILLING_INVOICE_STATUS_LABELS[invoice.status], right, { color: GREY, right: true });
  draw('Bill to', PAGE.margin, { font: bold });
  y -= LINE;
  draw(invoice.billTo.name, PAGE.margin);
  draw(`Invoice date: ${dayText(invoice.invoiceDate)}`, right, { right: true });
  y -= LINE;
  draw(invoice.billTo.email, PAGE.margin, { color: GREY });
  draw(`Due date: ${dayText(invoice.dueDate)}`, right, { right: true });
  y -= LINE;
  if (invoice.periodStart && invoice.periodEnd) {
    draw(
      `Service period: ${dayText(invoice.periodStart)} to ${dayText(invoice.periodEnd)}`,
      right,
      { right: true },
    );
    y -= LINE;
  }
  y -= LINE;

  const cols = { qty: 360, unit: 450, amount: right };
  draw('Description', PAGE.margin, { font: bold });
  draw('Qty', cols.qty, { font: bold, right: true });
  draw('Unit', cols.unit, { font: bold, right: true });
  draw('Amount', cols.amount, { font: bold, right: true });
  y -= 4;
  page.drawLine({
    start: { x: PAGE.margin, y },
    end: { x: right, y },
    thickness: 0.5,
    color: GREY,
  });
  y -= LINE;
  for (const line of invoice.lines) {
    room();
    const description =
      line.description.length > 60 ? `${line.description.slice(0, 57)}...` : line.description;
    draw(description, PAGE.margin);
    draw(String(line.quantity), cols.qty, { right: true });
    draw(money(line.unitPriceCents), cols.unit, { right: true });
    draw(money(line.amountCents), cols.amount, { right: true });
    y -= LINE;
  }
  y -= LINE / 2;
  const total = (label: string, cents: number, strong = false) => {
    room();
    draw(label, cols.unit, { right: true, font: strong ? bold : regular });
    draw(money(cents), cols.amount, { right: true, font: strong ? bold : regular });
    y -= LINE;
  };
  total('Subtotal', invoice.subtotalCents);
  if (invoice.discountCents) total('Discount', -invoice.discountCents);
  if (invoice.taxCents) total('Tax', invoice.taxCents);
  total('Total', invoice.totalCents, true);
  if (invoice.paidCents) total('Paid', -invoice.paidCents);
  if (invoice.creditedCents) total('Credited', -invoice.creditedCents);
  total('Balance due', invoice.balanceCents, true);

  if (invoice.payments.length) {
    y -= LINE;
    room(2);
    draw('Payments', PAGE.margin, { font: bold });
    y -= LINE;
    for (const p of invoice.payments) {
      room();
      draw(
        `${dayText(p.paidOn)}  ${BILLING_PAYMENT_METHOD_LABELS[p.method]}  ${money(p.amountCents)}`,
        PAGE.margin,
      );
      y -= LINE;
    }
  }
  if (invoice.notes) {
    y -= LINE;
    room(2);
    draw('Notes', PAGE.margin, { font: bold });
    y -= LINE;
    for (const text of invoice.notes.split('\n').slice(0, 20)) {
      room();
      draw(text.length > 95 ? `${text.slice(0, 92)}...` : text, PAGE.margin, { color: GREY });
      y -= LINE;
    }
  }
  return doc.save();
}
