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

/**
 * A synthetic JPEG 2000 picture (160x80, a dark block on light grey), the way scanners and some
 * tax software store page images. pdf.js decodes it with its openjpeg wasm.
 */
const SAMPLE_JPX =
  '/0//UQApAAAAAACgAAAAUAAAAAAAAAAAAAAAoAAAAFAAAAAAAAAAAAABBwEB/1IADAAAAAEABQQEAAH/XAATQEBISFBISFBISFBISFBISFD/ZAAlAAFDcmVhdGVkIGJ5IE9wZW5KUEVHIHZlcnNpb24gMi41LjT/kAAKAAAAAAI6AAH/k9+AkAsMo1A6iI7nsIHliL/lA3Rcf8/APj7QuH2hQCURRsiNgB5hq55OsdUhfwyC1N94gByPhaTvGp61iEevZccUv8/AVn4EsPtEwBhvfFPidPZ5t43hn36To1IjSjObaRr6/q9/W+VvO3OhZhIAHmPNijCPPLAM0zRHL/JaJVnEzR/ZqH8V2mGrxIa8it8/mAaMdzh39OO/x9pZH2nkD5ywH7RKgXWpk5FjFTFnnzVRcPj3XaUf4BhDW/a96rX7Z7fFBakiVpQfjKIEqqci8d/+4XMY7kj9efG6jtXu/075Bl6OF29OzaO0SLKMKt0a+6/01mZQoSl9HjgAa8iraIUF7G8K0Z+0gg8dzfZeB4r9b6OeET3oZB6TYxNnVbRkx9pdH2o8PtEgmOH7ffvhXtOjEV0Nb1Pbh23y+NIAwhDRvQgi6tWXfgb97qVcPkb5UT7ll1NeeZpaaZrvpq4DejnFFtMCgUxG3wQzfZCGO8IYAAAwjfcMTpXwIbD5uo0bABbUwTi5kIpPUiz9sAHvyVAAAAAoicgcAAAAAAAvmR+GCH8j8XLa2VcQIX3EwWNV4/aK/tFMftIv2ieD9QP+oHDPNb6NYpekEK8OkD4UkvHzDmibk1+TTBUX7xLZhbioTnyIrLghPlKsX89IYTvxKkV4BvlrROyz0LMkDSyZtqKwSAAGEg+FgDBhWueMIn4G0zw1FKUOTwGeZAgpeFyPzvqCx397P5Jetd8Nmb//2Q==';

/**
 * A synthetic one-page "scan": the page is a JPEG 2000 picture, so it draws only when pdf.js can
 * load its image decoders. For mock mode and tests; never real client data.
 */
export function scannedSamplePdf(): Uint8Array {
  const image = Uint8Array.from(atob(SAMPLE_JPX), (c) => c.charCodeAt(0));
  const draw = 'q 468 0 0 234 72 486 cm /Im1 Do Q';
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? new TextEncoder().encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: string | (string | Uint8Array)[]) => {
    offsets[n - 1] = length;
    push(`${n} 0 obj\n`);
    for (const p of typeof body === 'string' ? [body] : body) push(p);
    push('\nendobj\n');
  };
  push('%PDF-1.5\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(
    3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /XObject << /Im1 5 0 R >> >> >>',
  );
  obj(4, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  obj(5, [
    `<< /Type /XObject /Subtype /Image /Width 160 /Height 80 /Filter /JPXDecode ` +
      `/Length ${image.length} >>\nstream\n`,
    image,
    '\nendstream',
  ]);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  push(offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join(''));
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const pdf = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    pdf.set(p, at);
    at += p.length;
  }
  return pdf;
}
