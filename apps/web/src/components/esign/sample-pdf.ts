/**
 * A synthetic text-only PDF with `pages` pages, for mock mode and tests. Never real client data.
 */
export function samplePdf(pages: number, title = 'Sample engagement letter'): Uint8Array {
  const objs: string[] = ['', ''];
  const add = (s: string) => objs.push(s);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (let i = 1; i <= pages; i++) {
    const text = [
      `BT /F1 20 Tf 72 720 Td (${title}) Tj ET`,
      `BT /F1 12 Tf 72 690 Td (Page ${i} of ${pages}. Synthetic text for testing only.) Tj ET`,
      `BT /F1 12 Tf 72 140 Td (Signature: ______________________   Date: __________) Tj ET`,
    ].join('\n');
    const content = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      ),
    );
  }
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
