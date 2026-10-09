'use client';

import {
  IntakeSignatureInput,
  type IntakeAgreement,
  type IntakeAgreementBlock,
  type IntakeFormKey,
} from '@firmivra/types';
import { Button, Checkbox, Input } from '@firmivra/ui';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { SectionPanel } from './form-blocks';

/** What the signer has entered so far; the block itself comes from R14's public agreements. */
export interface AgreementState {
  /** `${agreementId}:${key}` of each ticked acknowledgment. */
  ticked: string[];
  acceptLegal: boolean;
  printedName: string;
  typedSignature: string;
  title: string;
}

export const emptyAgreement: AgreementState = {
  ticked: [],
  acceptLegal: false,
  printedName: '',
  typedSignature: '',
  title: '',
};

const tickKey = (agreementId: string, key: string) => `${agreementId}:${key}`;

/**
 * The signature the submit sends (R14's IntakeSignatureInput), or the message to show when it is
 * not complete: every required box ticked, the Terms and Privacy accepted when the firm asks,
 * and the typed signature matching the printed name.
 */
export function agreementSignature(
  block: IntakeAgreementBlock,
  a: AgreementState,
): { signature: IntakeSignatureInput } | { error: string } {
  if (!block.ready)
    return { error: "This form can't be signed right now. Please contact the firm." };
  const missing = block.agreements.some((g) =>
    g.acknowledgments.some((k) => k.required && !a.ticked.includes(tickKey(g.agreementId, k.key))),
  );
  if (missing) return { error: 'Please tick each required box to continue.' };
  if (block.legal && !a.acceptLegal) {
    return { error: 'Please accept the Terms of Service and Privacy Policy to continue.' };
  }
  const signature: IntakeSignatureInput = {
    agreements: block.agreements.map((g) => ({
      agreementId: g.agreementId,
      version: g.version,
      bodySha256: g.bodySha256,
    })),
    acknowledgments: block.agreements.flatMap((g) =>
      g.acknowledgments
        .filter((k) => a.ticked.includes(tickKey(g.agreementId, k.key)))
        .map((k) => ({ agreementId: g.agreementId, key: k.key })),
    ),
    acceptLegal:
      block.legal && a.acceptLegal
        ? { termsVersion: block.legal.terms.version, privacyVersion: block.legal.privacy.version }
        : null,
    signer: {
      printedName: a.printedName.trim(),
      method: 'TYPED',
      typedSignature: a.typedSignature.trim(),
    },
    title: a.title.trim() || null,
  };
  const checked = IntakeSignatureInput.safeParse(signature);
  if (!checked.success) {
    return { error: checked.error.issues[0]?.message ?? 'Type your name exactly as printed.' };
  }
  return { signature };
}

const usDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
};

/**
 * The agreement text as plain text, paragraph by paragraph. React escapes it, so no HTML runs;
 * R14's `<Markdown>` (packages/ui, pending) replaces this once it is on main.
 */
function AgreementText({ body }: { body: string }) {
  // Each paragraph keyed by its text (and its count, for a repeated paragraph).
  const seen = new Map<string, number>();
  const blocks = body
    .split(/\n\s*\n/)
    .filter((b) => b.trim())
    .map((b) => {
      const n = (seen.get(b) ?? 0) + 1;
      seen.set(b, n);
      return { b, key: `${n}:${b}` };
    });
  return (
    <>
      {blocks.map(({ b, key }) => {
        const heading = /^#{1,6}\s+(.*)$/.exec(b.trim());
        return heading ? (
          <p key={key} className="mt-2 font-semibold text-heading first:mt-0">
            {heading[1]?.replace(/\*\*/g, '')}
          </p>
        ) : (
          <p key={key} className="mt-1 whitespace-pre-line">
            {b.replace(/\*\*/g, '')}
          </p>
        );
      })}
    </>
  );
}

function AgreementCard({
  firmSlug,
  agreement,
  value,
  onChange,
}: {
  firmSlug: string;
  agreement: IntakeAgreement;
  value: AgreementState;
  onChange: (value: AgreementState) => void;
}) {
  const [pdfError, setPdfError] = useState('');
  async function download() {
    setPdfError('');
    try {
      const link = await api
        .publicAgreements(firmSlug)
        .downloadPdf(agreement.agreementId, agreement.version);
      window.location.assign(link.url);
    } catch {
      setPdfError("The PDF couldn't be opened. Please try again.");
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-heading">{agreement.title}</p>
        {agreement.pdf.available && (
          <Button
            variant="outline"
            onClick={() => void download()}
            className="text-xs! sm:min-h-7!"
          >
            <Download aria-hidden="true" className="size-4" />
            Download original (PDF)
          </Button>
        )}
      </div>
      {agreement.effectiveDate && (
        <p className="text-xs text-muted">Effective {usDate(agreement.effectiveDate)}</p>
      )}
      {pdfError && (
        <p role="alert" className="text-xs text-danger">
          {pdfError}
        </p>
      )}
      <div
        tabIndex={0}
        role="region"
        aria-label={agreement.title}
        className="max-h-56 overflow-y-auto rounded-control border border-folder-border bg-folder-surface p-3 text-xs"
      >
        <AgreementText body={agreement.bodyMarkdown} />
      </div>
      {agreement.acknowledgments.map((k) => {
        const id = tickKey(agreement.agreementId, k.key);
        return (
          <div key={k.key}>
            <Checkbox
              label={`${k.label}${k.required ? ' *' : ''}`}
              className="gap-2! text-xs! sm:min-h-6!"
              checked={value.ticked.includes(id)}
              onChange={(event) =>
                onChange({
                  ...value,
                  ticked: event.target.checked
                    ? [...value.ticked, id]
                    : value.ticked.filter((t) => t !== id),
                })
              }
            />
            {k.text && k.text !== k.label && (
              <p className="ml-6 whitespace-pre-line text-xs text-muted">{k.text}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The review step's agreements and signature (R14): the firm's current agreements for this form,
 * each with its required boxes and the PDF original, the Terms and Privacy acceptance when the
 * firm has published both, and the typed signature.
 */
export function AgreementPanel({
  firmSlug,
  block,
  failed,
  onRetry,
  form,
  value,
  onChange,
  error,
}: {
  firmSlug: string;
  block: IntakeAgreementBlock | undefined;
  failed: boolean;
  onRetry: () => void;
  form: IntakeFormKey;
  value: AgreementState;
  onChange: (value: AgreementState) => void;
  error: string;
}) {
  const [today] = useState(() => usDate(new Date().toISOString().slice(0, 10)));
  if (!block && failed) {
    return (
      <SectionPanel title="Agreement and Signature" className="mt-3">
        <p role="alert" className="text-sm text-danger">
          The agreement couldn&apos;t be loaded.
        </p>
        <Button variant="outline" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      </SectionPanel>
    );
  }
  if (!block) {
    return (
      <SectionPanel title="Agreement and Signature" className="mt-3">
        <p className="text-xs text-muted" role="status">
          Loading the agreement…
        </p>
      </SectionPanel>
    );
  }
  if (!block.ready) {
    return (
      <SectionPanel title="Agreement and Signature" className="mt-3">
        <p role="alert" className="text-sm text-danger">
          This form isn&apos;t available yet. Your answers are saved: please contact the firm.
        </p>
      </SectionPanel>
    );
  }
  return (
    <SectionPanel
      title="Agreement and Signature"
      subtitle="Please read the agreement, then sign below."
      className="mt-3"
    >
      <div className="space-y-4">
        {block.agreements.map((a) => (
          <AgreementCard
            key={a.agreementId}
            firmSlug={firmSlug}
            agreement={a}
            value={value}
            onChange={onChange}
          />
        ))}
        {block.legal && (
          <Checkbox
            label="I accept the Terms of Service and Privacy Policy. *"
            className="gap-2! text-xs! sm:min-h-6!"
            checked={value.acceptLegal}
            onChange={(event) => onChange({ ...value, acceptLegal: event.target.checked })}
          />
        )}
        <div className="grid gap-2 sm:grid-cols-2 [&_label]:text-xs">
          <Input
            label="Printed Name *"
            autoComplete="name"
            value={value.printedName}
            onChange={(event) => onChange({ ...value, printedName: event.target.value })}
          />
          <Input
            label="Signature (type your name exactly as printed) *"
            value={value.typedSignature}
            onChange={(event) => onChange({ ...value, typedSignature: event.target.value })}
            className="font-display text-lg italic"
          />
          {form !== 'ANNUAL_TAX' && (
            <Input
              label="Title or Position"
              autoComplete="organization-title"
              value={value.title}
              onChange={(event) => onChange({ ...value, title: event.target.value })}
            />
          )}
          <div className="text-xs">
            <p className="font-medium text-firm-primary">Date</p>
            <p className="mt-1">{today}</p>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </SectionPanel>
  );
}
