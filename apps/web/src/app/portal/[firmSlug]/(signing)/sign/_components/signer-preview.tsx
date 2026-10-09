'use client';

import { Button } from '@firmivra/ui';
import { useMemo, useState } from 'react';
import { PdfPages } from '../../../../../../components/esign/pdf-pages';
import { samplePdf } from '../../../../../../components/esign/sample-pdf';
import { SignaturePad } from '../../../../../../components/esign/signature-pad';

/**
 * The signer page's parts on sample data, until the signing API (R13-api contract 2) lands: the
 * documents of a request, one at a time, and the adopt-a-signature pad. The code gate and consent
 * come first in signer flow 1.
 */
export function SignerPreview() {
  const documents = useMemo(
    () => [
      { label: 'Sample engagement letter', pdf: samplePdf(3) },
      { label: 'Sample tax organizer', pdf: samplePdf(2, 'Sample tax organizer') },
    ],
    [],
  );
  const [shown, setShown] = useState(0);
  const doc = documents[shown] ?? documents[0]!;
  const [signature, setSignature] = useState<string | null>(null);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 data-testid="page-title" className="text-2xl font-semibold text-heading">
        Sign documents
      </h1>
      <p className="text-sm text-muted">
        Document {shown + 1} of {documents.length}: {doc.label}
      </p>
      <PdfPages source={doc.pdf} label={doc.label} />
      <Button
        variant="secondary"
        className="self-end"
        onClick={() => setShown((shown + 1) % documents.length)}
      >
        Next document
      </Button>
      <section aria-labelledby="adopt-heading" className="flex flex-col gap-3">
        <h2 id="adopt-heading" className="text-lg font-semibold text-heading">
          Adopt your signature
        </h2>
        <SignaturePad kind="signature" onChange={setSignature} />
        <p data-testid="signature-state" className="text-sm text-muted">
          {signature ? 'Signature ready.' : 'Add your signature to continue.'}
        </p>
      </section>
    </div>
  );
}
