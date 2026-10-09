import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import type { CertificateInput } from './engine.types.js';
import { embedNoto, printable } from './pdf-finalize.js';

// The completion certificate and audit trail (R18 step 8). Built only from ids, names, methods,
// times, network details and hashes: never a field value or the document's content. The same
// input gives the same bytes (fixed metadata, pdf-lib's seeded font names, no clock).

const PAGE = { width: 612, height: 792, margin: 54 } as const;
const INK = rgb(0.08, 0.1, 0.2);
const MUTED = rgb(0.35, 0.38, 0.45);
const RULE = rgb(0.8, 0.82, 0.86);

/** Event names as the certificate prints them. */
const EVENT_LABEL = (type: string) =>
  type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ');

/** Lines of `text` that fit `width` at `size`, broken at spaces, or anywhere in a long word. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of printable(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    for (const char of word) {
      if (line && font.widthOfTextAtSize(line + char, size) > width) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** Writes top to bottom, adding pages as needed. */
class Writer {
  private page!: PDFPage;
  private y = 0;

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
  ) {
    this.newPage();
  }

  private newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
  }

  private room(height: number) {
    if (this.y - height < PAGE.margin) this.newPage();
  }

  heading(text: string, size = 16) {
    this.room(size + 14);
    this.y -= size;
    this.page.drawText(printable(text), {
      x: PAGE.margin,
      y: this.y,
      size,
      font: this.font,
      color: INK,
    });
    this.y -= 10;
  }

  /** A label on the left and its value, wrapped, on the right. */
  row(label: string, value: string, size = 9) {
    const valueX = PAGE.margin + 130;
    const lines = wrap(value, this.font, size, PAGE.width - PAGE.margin - valueX);
    this.room(lines.length * (size + 3) + 2);
    this.page.drawText(label, {
      x: PAGE.margin,
      y: this.y - size,
      size,
      font: this.font,
      color: MUTED,
    });
    for (const line of lines) {
      this.y -= size + 3;
      this.page.drawText(line, { x: valueX, y: this.y, size, font: this.font, color: INK });
    }
    this.y -= 2;
  }

  /** One line of columns at fixed x offsets; each cell is cut to its column. */
  columns(cells: string[], xs: number[], size = 8, color = INK) {
    this.room(size + 4);
    this.y -= size + 4;
    cells.forEach((cell, i) => {
      const width = (xs[i + 1] ?? PAGE.width - PAGE.margin) - xs[i]! - 6;
      const [first = ''] = wrap(cell, this.font, size, width);
      this.page.drawText(first, { x: xs[i]!, y: this.y, size, font: this.font, color });
    });
  }

  rule() {
    this.room(10);
    this.y -= 6;
    this.page.drawLine({
      start: { x: PAGE.margin, y: this.y },
      end: { x: PAGE.width - PAGE.margin, y: this.y },
      thickness: 0.5,
      color: RULE,
    });
    this.y -= 4;
  }
}

/** What the certificate says, in order; certificate() lays it out. */
export type CertificateBlock =
  | { kind: 'heading'; text: string; size: number }
  | { kind: 'row'; label: string; value: string }
  | { kind: 'columns'; cells: string[]; muted?: boolean }
  | { kind: 'rule' };

export function certificateBlocks(input: CertificateInput): CertificateBlock[] {
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: input.timeZone,
    dateStyle: 'medium',
    timeStyle: 'long',
  });
  // Some ICU versions put a narrow no-break space before AM/PM: print a plain one.
  const at = (date: Date | null) =>
    date ? time.format(date).replace(/[\u202f\u00a0]/g, ' ') : 'Not recorded';
  const heading = (text: string, size: number): CertificateBlock => ({
    kind: 'heading',
    text,
    size,
  });
  const row = (label: string, value: string): CertificateBlock => ({ kind: 'row', label, value });
  const rule: CertificateBlock = { kind: 'rule' };
  const { request } = input;
  return [
    heading('Certificate of completion', 20),
    row('Document', request.title),
    row('Request ID', request.id),
    row('Firm', request.firmName),
    row('Sent', at(request.sentAt)),
    row('Completed', at(request.completedAt)),
    row('Original SHA-256', input.originalSha256),
    row('Signed PDF SHA-256', input.finalSha256),
    rule,
    heading('Signers', 13),
    ...input.signers.flatMap((signer) => [
      row('Name', signer.name),
      row('Email', signer.email ?? 'None'),
      row('Role', signer.role),
      row('Verified by', signer.authMethod),
      row(
        'E-sign consent',
        signer.consentVersion === null ? 'Not recorded' : `Version ${signer.consentVersion}`,
      ),
      row('Viewed', at(signer.viewedAt)),
      row('Signed', at(signer.signedAt)),
      row('IP address', signer.ip ?? 'Not recorded'),
      row('User agent', signer.userAgent ?? 'Not recorded'),
      rule,
    ]),
    heading('Audit trail', 13),
    { kind: 'columns', cells: ['Time', 'Event', 'By', 'Verified by'], muted: true },
    ...input.events.map((event): CertificateBlock => ({
      kind: 'columns',
      cells: [at(event.at), EVENT_LABEL(event.type), event.actor, event.authMethod ?? ''],
    })),
  ];
}

/** The certificate and audit-trail pages as one PDF. */
export async function certificate(input: CertificateInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const { request } = input;
  doc.setTitle(`Certificate of completion: ${printable(request.title)}`);
  doc.setProducer('Firmivra Firm Sign');
  doc.setCreator('Firmivra Firm Sign');
  doc.setCreationDate(request.completedAt);
  doc.setModificationDate(request.completedAt);

  const out = new Writer(doc, await embedNoto(doc));
  const xs = [PAGE.margin, PAGE.margin + 150, PAGE.margin + 270, PAGE.margin + 420];
  for (const block of certificateBlocks(input)) {
    if (block.kind === 'heading') out.heading(block.text, block.size);
    else if (block.kind === 'row') out.row(block.label, block.value);
    else if (block.kind === 'columns') out.columns(block.cells, xs, 8, block.muted ? MUTED : INK);
    else out.rule();
  }
  return doc.save({ useObjectStreams: false });
}
