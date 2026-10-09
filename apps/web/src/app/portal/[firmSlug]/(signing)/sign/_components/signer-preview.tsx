'use client';

import { Button } from '@firmivra/ui';
import { useMemo, useState } from 'react';
import { PdfPages } from '../../../../../../components/esign/pdf-pages';
import { samplePdf } from '../../../../../../components/esign/sample-pdf';

/**
 * The signer page's parts on sample data, until the signing API (R13-api contract 2) lands: the
 * documents of a request, one at a time. The code gate and consent come first in signer flow 1.
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
    </div>
  );
}
