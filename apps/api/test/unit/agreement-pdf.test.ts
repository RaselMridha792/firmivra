import { PDFDocument, PDFName } from 'pdf-lib';
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

  it('refuses a page tree that lists the same node twice, quickly', async () => {
    const doc = await PDFDocument.load(await pdf(1));
    const ctx = doc.context;
    let node = doc.getPage(0).ref;
    for (let depth = 0; depth < 22; depth++) {
      node = ctx.register(ctx.obj({ Type: 'Pages', Kids: [node, node], Count: 2 ** (depth + 1) }));
    }
    doc.catalog.set(PDFName.of('Pages'), node);
    const bytes = await doc.save();
    expect(bytes.byteLength).toBeLessThan(5_000);
    const started = Date.now();
    expect(await inspectAgreementPdf(bytes)).toBe('NOT_A_PDF');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
