import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';
import {
  INTAKE_STATUS_LABELS,
  type IntakeField,
  type IntakeFormDefinition,
  type IntakeStatus,
  shownIntakeKeys,
} from '@firmivra/types';

// Export PDF of one assigned form: the header, then each shown question of each step with its
// answer. SSN and EIN answers arrive masked (`{ last4 }`); file uploads show the file names only.

export interface IntakePdfInput {
  definition: IntakeFormDefinition;
  answers: Record<string, unknown>;
  files: { fileName: string; intakeSlot: string | null }[];
  header: {
    title: string;
    recipient: string;
    status: IntakeStatus;
    sentAt: string | null;
    submittedAt: string | null;
  };
}

const PAGE = { width: 612, height: 792, margin: 54 };
const SIZE = { title: 16, heading: 12, text: 10 };
const LINE = 14;
const GREY = rgb(0.35, 0.35, 0.35);

/** The standard fonts draw WinAnsi only: anything else becomes "?" rather than failing. */
const printable = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function optionLabel(f: IntakeField, code: unknown): string {
  if ('options' in f && Array.isArray(f.options)) {
    return f.options.find((o) => o.value === code)?.label ?? String(code);
  }
  return String(code);
}

/** One answer as text lines ([] for no answer). */
function answerLines(f: IntakeField, value: unknown, files: string[]): string[] {
  if (f.type === 'upload') {
    const note =
      (value as { notAvailable?: boolean } | undefined)?.notAvailable === true
        ? ['Not available']
        : [];
    return [...files, ...note];
  }
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value) && value.length === 0) return [];
  switch (f.type) {
    case 'ssn':
      return [`***-**-${(value as { last4?: string }).last4 ?? '****'}`];
    case 'ein':
      return [`**-***${(value as { last4?: string }).last4 ?? '****'}`];
    case 'currency':
      return typeof value === 'number' ? [money(value)] : [String(value)];
    case 'yesNo':
    case 'checkbox':
      return [value === true ? 'Yes' : 'No'];
    case 'radio':
    case 'select':
      return [optionLabel(f, value)];
    case 'checkboxes':
    case 'state':
      return [(Array.isArray(value) ? value : [value]).map((v) => optionLabel(f, v)).join(', ')];
    case 'grid': {
      const out: string[] = [];
      for (const r of f.rows) {
        const cells = (value as Record<string, Record<string, unknown> | null>)[r.key];
        if (!cells) continue;
        const parts = f.columns
          .filter((c) => cells[c.key] !== null && cells[c.key] !== undefined && cells[c.key] !== '')
          .map((c) => {
            const v = cells[c.key];
            return `${c.label}: ${c.type === 'currency' && typeof v === 'number' ? money(v) : String(v)}`;
          });
        if (parts.length) out.push(`${r.label}: ${parts.join('; ')}`);
      }
      return out;
    }
    case 'group': {
      const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      return rows.flatMap((row, i) => [
        `${f.itemLabel} ${String(i + 1)}`,
        ...f.fields.flatMap((sub) =>
          answerLines(sub, row[sub.key], []).map((line) => `  ${sub.label}: ${line}`),
        ),
      ]);
    }
    default:
      return [String(value)];
  }
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.newPage();
  }

  private newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
  }

  /** Words wrapped to the page width. */
  private wrap(text: string, size: number, font: PDFFont, indent: number): string[] {
    const width = PAGE.width - PAGE.margin * 2 - indent;
    const lines: string[] = [];
    for (const paragraph of printable(text).split(/\r?\n/)) {
      let line = '';
      for (const word of paragraph.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) {
          line = next;
          continue;
        }
        if (line) lines.push(line);
        // A word wider than the line is cut.
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
          let n = rest.length;
          while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
          lines.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        line = rest;
      }
      lines.push(line);
    }
    return lines;
  }

  text(value: string, opts: { size?: number; bold?: boolean; indent?: number; grey?: boolean }) {
    const size = opts.size ?? SIZE.text;
    const font = opts.bold ? this.bold : this.font;
    const indent = opts.indent ?? 0;
    for (const line of this.wrap(value, size, font, indent)) {
      if (this.y < PAGE.margin + LINE) this.newPage();
      this.page.drawText(line, {
        x: PAGE.margin + indent,
        y: this.y,
        size,
        font,
        ...(opts.grey ? { color: GREY } : {}),
      });
      this.y -= size + 4;
    }
  }

  gap(n = 6) {
    this.y -= n;
  }
}

/** The PDF's bytes. */
export async function renderIntakePdf(input: IntakePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(printable(input.header.title));
  doc.setProducer('Firmivra');
  const w = new Writer(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
  );
  const h = input.header;
  w.text(h.title, { size: SIZE.title, bold: true });
  w.gap(4);
  w.text(`Recipient: ${h.recipient}`, {});
  w.text(`Status: ${INTAKE_STATUS_LABELS[h.status] ?? h.status}`, {});
  if (h.sentAt) w.text(`Sent: ${h.sentAt.slice(0, 10)}`, {});
  w.text(h.submittedAt ? `Submitted: ${h.submittedAt.slice(0, 10)}` : 'Not submitted yet', {});
  w.gap(10);

  const shown = shownIntakeKeys(input.definition, input.answers);
  const filesBySlot = new Map<string, string[]>();
  for (const f of input.files) {
    if (!f.intakeSlot) continue;
    filesBySlot.set(f.intakeSlot, [...(filesBySlot.get(f.intakeSlot) ?? []), f.fileName]);
  }
  for (const step of input.definition.steps) {
    if (!shown.steps.has(step.key)) continue;
    w.text(step.title, { size: SIZE.heading, bold: true });
    w.gap(2);
    for (const section of step.sections) {
      const fields = section.fields.filter((f) => shown.fields.has(f.key) && f.type !== 'info');
      if (fields.length === 0) continue;
      if (section.title && section.title !== step.title) w.text(section.title, { bold: true });
      for (const f of fields) {
        w.text(f.label, { grey: true, indent: 8 });
        const lines = answerLines(f, input.answers[f.key], filesBySlot.get(f.key) ?? []);
        for (const line of lines.length ? lines : ['No answer']) w.text(line, { indent: 16 });
        w.gap(2);
      }
    }
    w.gap(8);
  }
  return doc.save();
}
