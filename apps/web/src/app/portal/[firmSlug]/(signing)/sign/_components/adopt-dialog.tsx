'use client';

import {
  ESIGN_ERRORS,
  type EsignInitialsInput,
  type EsignSignatureInput,
  type SignerAdoptBody,
  signatureNameKey,
} from '@firmivra/types';
import { Button, Input, Modal } from '@firmivra/ui';
import { useState } from 'react';
import { type AdoptedMark, SignaturePad } from '../../../../../../components/esign/signature-pad';
import { errorMessage } from '../../../../../../lib/errors';

const DATA_URL = 'data:image/png;base64,';

/** First letters of each part of the name, for the initials' Type tab. */
export const initialsOf = (name: string) =>
  name
    .split(/\s+/u)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
    .slice(0, 10);

function signatureBody(printedName: string, mark: AdoptedMark): EsignSignatureInput {
  return mark.method === 'TYPED'
    ? { printedName, method: 'TYPED', typedSignature: mark.text }
    : { printedName, method: mark.method, imagePng: mark.png.slice(DATA_URL.length) };
}

function initialsBody(mark: AdoptedMark): EsignInitialsInput {
  return mark.method === 'TYPED'
    ? // The API takes initials without spaces ("J.S." or "JS").
      { method: 'TYPED', text: mark.text.replace(/\s+/gu, '') }
    : { method: mark.method, imagePng: mark.png.slice(DATA_URL.length) };
}

/** What the page keeps to draw the adopted signature and initials on its fields. */
export interface Adopted {
  signature: AdoptedMark;
  initials: AdoptedMark | null;
}

interface AdoptDialogProps {
  open: boolean;
  /** The signer's name: the printed name's and the typed signature's starting text. */
  name: string;
  /** They have an INITIALS field: initials are adopted with the signature. */
  needsInitials: boolean;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onAdopt: (body: SignerAdoptBody, adopted: Adopted) => void;
}

/**
 * Adopt a signature (and initials), typed, drawn or uploaded. A typed signature is also the
 * printed name (the API checks they match); a drawn or uploaded one asks for the printed name.
 * Each opening starts fresh.
 */
export function AdoptDialog(props: AdoptDialogProps) {
  return (
    <Modal open={props.open} title="Adopt your signature" onClose={props.onClose}>
      {props.open && <AdoptForm {...props} />}
    </Modal>
  );
}

function AdoptForm({ name, needsInitials, pending, error, onClose, onAdopt }: AdoptDialogProps) {
  const [printedName, setPrintedName] = useState(name);
  const [signature, setSignature] = useState<AdoptedMark | null>(null);
  const [initials, setInitials] = useState<AdoptedMark | null>(null);
  const [problem, setProblem] = useState<string>();

  const typed = signature?.method === 'TYPED';

  function adopt() {
    if (!signature) return setProblem('Add your signature.');
    const printed = signature.method === 'TYPED' ? signature.text : printedName.trim();
    if (!signatureNameKey(printed)) return setProblem('Enter your full name.');
    if (needsInitials && !initials) return setProblem('Add your initials.');
    setProblem(undefined);
    onAdopt(
      {
        signature: signatureBody(printed, signature),
        ...(needsInitials && initials ? { initials: initialsBody(initials) } : {}),
      },
      { signature, initials: needsInitials ? initials : null },
    );
  }

  const shown = problem ?? (error ? errorMessage(error, ESIGN_ERRORS) : undefined);
  return (
    <div className="flex w-full max-w-2xl flex-col gap-5">
      <section aria-label="Signature" className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-heading">Signature</h3>
        <SignaturePad kind="signature" defaultText={name} onChange={setSignature} />
      </section>
      {!typed && (
        <Input
          label="Printed name"
          value={printedName}
          maxLength={200}
          autoComplete="name"
          onChange={(e) => setPrintedName(e.target.value)}
        />
      )}
      {needsInitials && (
        <section aria-label="Initials" className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-heading">Initials</h3>
          <SignaturePad kind="initials" defaultText={initialsOf(name)} onChange={setInitials} />
        </section>
      )}
      <p className="text-sm text-muted">
        By adopting, you agree this is your electronic signature, as binding as one on paper.
      </p>
      {shown && (
        <p role="alert" className="text-sm text-danger">
          {shown}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button onClick={adopt} disabled={pending}>
          Adopt and sign
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
