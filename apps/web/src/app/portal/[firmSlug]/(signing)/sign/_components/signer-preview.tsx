'use client';

import { useMemo } from 'react';
import { PdfPages } from '../../../../../../components/esign/pdf-pages';
import { samplePdf } from '../../../../../../components/esign/sample-pdf';

/**
 * The signer page's parts on sample data, until the signing API (R13-api contract 2) lands: the
 * document. The code gate and consent come first in signer flow 1.
 */
export function SignerPreview() {
  const pdf = useMemo(() => samplePdf(3), []);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 data-testid="page-title" className="text-2xl font-semibold text-heading">
        Sign documents
      </h1>
      <PdfPages source={pdf} label="Sample engagement letter" />
    </div>
  );
}
