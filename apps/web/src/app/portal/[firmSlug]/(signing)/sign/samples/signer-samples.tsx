'use client';

import { Button } from '@firmivra/ui';
import { useMemo, useState } from 'react';
import {
  FieldOverlay,
  type OverlayField,
  type OverlayRecipient,
} from '../../../../../../components/esign/field-overlay';
import { PdfPages } from '../../../../../../components/esign/pdf-pages';
import { samplePdf, scannedSamplePdf } from '../../../../../../components/esign/sample-pdf';
import { SignaturePad } from '../../../../../../components/esign/signature-pad';

/** Synthetic recipients and fields for the first sample (no signing session needed). */
const RECIPIENTS: OverlayRecipient[] = [
  { id: 'r-jordan', name: 'Jordan Sample', colorIndex: 0 },
  { id: 'r-riley', name: 'Riley Sample', colorIndex: 1 },
];
const sampleField = (
  id: string,
  recipientId: string | null,
  type: OverlayField['type'],
  x: number,
  y: number,
  w = 0.3,
): OverlayField => ({
  id,
  recipientId,
  type,
  pageIndex: 0,
  x,
  y,
  w,
  h: 0.05,
  required: type !== 'TEXT',
  label: null,
  value: null,
  filled: false,
});
const FIELDS: OverlayField[] = [
  sampleField('f-sign-jordan', 'r-jordan', 'SIGNATURE', 0.18, 0.78),
  sampleField('f-date-jordan', 'r-jordan', 'DATE_SIGNED', 0.62, 0.78, 0.2),
  sampleField('f-sign-riley', 'r-riley', 'SIGNATURE', 0.18, 0.86),
  { ...sampleField('f-fee-sender', null, 'TEXT', 0.62, 0.86, 0.2), value: 'Fee: $450' },
  { ...sampleField('f-ref-riley', 'r-riley', 'TEXT', 0.18, 0.7), label: 'Spouse name' },
];

/**
 * The signer page's parts on sample data, for checking them without a signing link: the documents
 * of a request, one at a time, with their fields, and the adopt-a-signature pad.
 */
export function SignerSamples() {
  const documents = useMemo(
    () => [
      { label: 'Sample engagement letter', pdf: samplePdf(3) },
      { label: 'Sample tax organizer', pdf: samplePdf(2, 'Sample tax organizer') },
      { label: 'Sample scanned form', pdf: scannedSamplePdf() },
    ],
    [],
  );
  const [shown, setShown] = useState(0);
  const doc = documents[shown] ?? documents[0]!;
  const [signature, setSignature] = useState<string | null>(null);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 data-testid="page-title" className="text-2xl font-semibold text-heading">
        Signing samples
      </h1>
      <p className="text-sm text-muted">
        Document {shown + 1} of {documents.length}: {doc.label}
      </p>
      <PdfPages
        source={doc.pdf}
        label={doc.label}
        // The sample fields belong to the first document; the signer here is Jordan.
        overlay={
          shown === 0
            ? (pageIndex) => (
                <FieldOverlay
                  fields={FIELDS}
                  recipients={RECIPIENTS}
                  pageIndex={pageIndex}
                  ownerId="r-jordan"
                />
              )
            : undefined
        }
      />
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
