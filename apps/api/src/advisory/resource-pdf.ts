import { PDFDocument, type PDFFont, rgb, StandardFonts } from 'pdf-lib';

// B28 (Business Advisory review §18): an advisory resource sent to the client as a PDF. One
// portrait page with the firm's name, the resource's title, category and the library's words, the
// date it was sent and the advisory disclaimer. Nothing of the client's is on it.

const PAGE = { width: 612, height: 792, margin: 54 };
const NAVY = rgb(0.06, 0.13, 0.33);
const GREY = rgb(0.4, 0.42, 0.47);

/** The standard fonts draw WinAnsi only: anything else becomes "?" rather than failing. */
const winAnsi = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

/** `text` broken into lines of at most `width` points. */
function lines(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of winAnsi(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export interface ResourcePdfInput {
  firmName: string;
  title: string;
  category: string;
  summary: string;
  /** The firm's calendar day it was sent (YYYY-MM-DD). */
  sentOn: string;
  disclaimer: string;
}

export async function renderResourcePdf(input: ResourcePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(winAnsi(input.title));
  doc.setProducer('Firmivra');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const usable = PAGE.width - PAGE.margin * 2;
  let y = PAGE.height - PAGE.margin;
  const write = (text: string, size: number, font: PDFFont, color = NAVY, gap = 6) => {
    for (const line of lines(text, font, size, usable)) {
      y -= size;
      page.drawText(line, { x: PAGE.margin, y, size, font, color });
      y -= gap;
    }
  };
  write(input.firmName, 11, bold, GREY, 18);
  write(input.title, 22, bold, NAVY, 10);
  write(input.category, 11, regular, GREY, 22);
  write(input.summary, 12, regular, NAVY, 8);
  y -= 18;
  write(`Sent by ${input.firmName} on ${input.sentOn}.`, 10, regular, GREY, 6);
  write(input.disclaimer, 9, regular, GREY, 4);
  return doc.save();
}
