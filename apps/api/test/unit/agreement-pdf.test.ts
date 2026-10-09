import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { inspectAgreementPdf } from '../../src/agreements/agreement-files.service.js';

async function pdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save();
}

describe('inspectAgreementPdf', () => {
  it('takes a PDF of 1 to 200 pages', async () => {
    expect(await inspectAgreementPdf(await pdf(1))).toBeNull();
    expect(await inspectAgreementPdf(await pdf(200))).toBeNull();
  });

  it('refuses more pages, other files and broken PDFs', async () => {
    expect(await inspectAgreementPdf(await pdf(201))).toBe('TOO_MANY_PAGES');
    expect(await inspectAgreementPdf(new TextEncoder().encode('hello'))).toBe('NOT_A_PDF');
    expect(await inspectAgreementPdf(new TextEncoder().encode('%PDF-1.7 broken'))).toBe(
      'NOT_A_PDF',
    );
  });
});
