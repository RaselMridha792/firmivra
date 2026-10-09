'use client';

import {
  ESIGN_ERRORS,
  type SignerAdoptBody,
  type SignerEnvelope,
  type SignerField,
  type SignerState,
  type SigningClient,
} from '@firmivra/types';
import { Button, Card, Modal } from '@firmivra/ui';
import { type ReactNode, useState } from 'react';
import { FieldOverlay, type OverlayField } from '../../../../../../components/esign/field-overlay';
import { FIELD_TYPE_LABELS } from '../../../../../../components/esign/field-labels';
import { PdfPages } from '../../../../../../components/esign/pdf-pages';
import type { AdoptedMark } from '../../../../../../components/esign/signature-pad';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { type Adopted, AdoptDialog } from './adopt-dialog';
import { FieldPanel } from './field-panel';
import {
  byPosition,
  type Filled,
  finishValues,
  isFilled,
  missing,
  sameGroup,
  startValues,
} from './signer-fields';

const message = (e: unknown) => (e ? errorMessage(e, ESIGN_ERRORS) : undefined);

interface SignViewProps {
  signing: SigningClient;
  envelope: SignerEnvelope;
  onState: (state: SignerState) => void;
}

/**
 * SIGN: the document with the signer's own fields. Next takes them to each required field in
 * turn; the panel under the document fills the current one. They adopt a signature once, then
 * Finish sends every value (the API stamps the signatures and the date), or they decline.
 */
export function SignView({ signing, envelope, onState }: SignViewProps) {
  const { fields } = envelope;
  const ordered = [...fields].sort(byPosition);
  const [values, setValues] = useState(() => startValues(fields));
  const [attachments, setAttachments] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.flatMap((f) => (f.attachmentName ? [[f.id, f.attachmentName]] : []))),
  );
  const [adoptedOnServer, setAdoptedOnServer] = useState(
    envelope.adopted ? { hasInitials: envelope.adopted.hasInitials } : null,
  );
  // Drawn on the fields; after a reload the API has the signature but this page does not.
  const [marks, setMarks] = useState<Adopted | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [notice, setNotice] = useState<string>();
  // What DATE_SIGNED fields show until the API stamps the real date.
  const [today] = useState(() => new Date().toLocaleDateString(undefined, { dateStyle: 'medium' }));

  const filled: Filled = { values, attachments, adopted: adoptedOnServer };
  const toFill = missing(fields, filled);
  const required = fields.filter((f) => f.required && f.type !== 'DATE_SIGNED');
  const needsInitials = fields.some((f) => f.type === 'INITIALS');
  const signs = envelope.autoSignaturePage || fields.some((f) => f.type === 'SIGNATURE');
  const active = fields.find((f) => f.id === activeId) ?? null;

  const adopt = useApiMutation((body: SignerAdoptBody) => signing.adopt(body));
  const finish = useApiMutation(() => signing.finish({ values: finishValues(fields, filled) }));

  function goTo(field: SignerField) {
    setActiveId(field.id);
    // Scroll once this render has marked the box as the current one.
    requestAnimationFrame(() => {
      const box = document.querySelector<HTMLElement>(`[data-field="${field.id}"]`);
      box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      box?.focus({ preventScroll: true });
    });
  }

  function next() {
    setNotice(undefined);
    const after = ordered.findIndex((f) => f.id === activeId);
    // The next required field still empty after the current one, or the first from the top.
    const target =
      toFill.find((f) => ordered.indexOf(f) > after) ??
      toFill[0] ??
      ordered.find((f) => ordered.indexOf(f) > after && !isFilled(f, fields, filled));
    if (target) goTo(target);
    else setNotice('Every field is filled in. Select Finish to sign.');
  }

  function select(id: string) {
    const f = fields.find((x) => x.id === id);
    if (!f) return;
    setActiveId(id);
    if (f.type === 'CHECKBOX') setValue(id, values[id] === 'true' ? 'false' : 'true');
    if (f.type === 'RADIO') choose(id);
    if ((f.type === 'SIGNATURE' || f.type === 'INITIALS') && !isFilled(f, fields, filled)) {
      setAdopting(true);
    }
  }

  function setValue(id: string, value: string) {
    setValues((v) => ({ ...v, [id]: value }));
  }

  function choose(id: string) {
    const f = fields.find((x) => x.id === id);
    if (!f) return;
    setValues((v) => {
      const out = { ...v };
      for (const o of fields) if (o.type === 'RADIO' && sameGroup(o, f)) out[o.id] = 'false';
      out[id] = 'true';
      return out;
    });
  }

  function onAdopt(body: SignerAdoptBody, adopted: Adopted) {
    adopt.mutate(body, {
      onSuccess: (e) => {
        setAdoptedOnServer(e.adopted ? { hasInitials: e.adopted.hasInitials } : null);
        setMarks(adopted);
        setAdopting(false);
      },
    });
  }

  function submit() {
    setNotice(undefined);
    if (signs && !adoptedOnServer) {
      setAdopting(true);
      return;
    }
    const first = toFill[0];
    if (first) {
      setNotice(
        `Fill in every required field first: ${toFill.length} ${toFill.length === 1 ? 'is' : 'are'} left.`,
      );
      goTo(first);
      return;
    }
    finish.mutate(undefined, {
      onSuccess: onState,
      onError: (err) => {
        if (errorCode(err) === 'SIGNATURE_REQUIRED') setAdopting(true);
      },
    });
  }

  const overlayFields: OverlayField[] = fields.map((f) => ({
    id: f.id,
    recipientId: envelope.me.recipientId,
    type: f.type,
    pageIndex: f.pageIndex,
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h,
    required: f.required,
    label: f.label,
    value: textValue(f, values, attachments),
    filled: isFilled(f, fields, filled),
  }));
  const recipients = [{ id: envelope.me.recipientId, name: envelope.me.name, colorIndex: 0 }];
  const done = required.length - toFill.length;

  return (
    <div className="flex flex-col gap-4">
      {envelope.message && (
        <Card title={`Message from ${envelope.senderName}`}>
          <p className="text-sm whitespace-pre-line text-text">{envelope.message}</p>
        </Card>
      )}
      <p className="text-sm text-text">
        {fields.length
          ? `You have ${fields.length} ${fields.length === 1 ? 'field' : 'fields'} to fill in, marked on the pages. Select Next to go to each one.`
          : 'You sign on the signature page at the end of the document.'}
      </p>
      <PdfPages
        source={envelope.packetUrl}
        purpose="sign"
        label={envelope.title}
        overlay={(pageIndex) => (
          <FieldOverlay
            fields={overlayFields}
            recipients={recipients}
            pageIndex={pageIndex}
            ownerId={envelope.me.recipientId}
            activeId={activeId}
            onSelect={select}
            display={(f) => fieldMark(f, marks, today)}
          />
        )}
      />
      {/* Stays in view while they scroll: the current field, progress and the actions. */}
      <div
        data-testid="sign-bar"
        className="sticky bottom-0 z-10 flex flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-lg"
      >
        {active && (
          <section aria-label={`Field: ${active.label || FIELD_TYPE_LABELS[active.type]}`}>
            <FieldPanel
              field={active}
              fields={fields}
              filled={filled}
              signing={signing}
              onValue={setValue}
              onRadio={choose}
              onAttachment={(id, name) => setAttachments((a) => ({ ...a, [id]: name }))}
              onAdopt={() => setAdopting(true)}
            />
          </section>
        )}
        {(notice ?? message(finish.error)) && (
          <p role="alert" className="text-sm text-danger">
            {notice ?? message(finish.error)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {required.length > 0 && (
            <p data-testid="sign-progress" className="mr-auto text-sm text-muted">
              {done} of {required.length} required done
            </p>
          )}
          {fields.length > 0 && (
            <Button variant="secondary" onClick={next}>
              Next
            </Button>
          )}
          {envelope.autoSignaturePage && (
            <Button variant="secondary" onClick={() => setAdopting(true)}>
              {adoptedOnServer ? 'Change signature' : 'Adopt signature'}
            </Button>
          )}
          <Button onClick={submit} disabled={finish.isPending}>
            Finish
          </Button>
          <Button variant="ghost" onClick={() => setDeclining(true)}>
            Decline to sign
          </Button>
        </div>
      </div>
      <AdoptDialog
        open={adopting}
        name={envelope.me.name}
        needsInitials={needsInitials}
        pending={adopt.isPending}
        error={adopt.error}
        onClose={() => setAdopting(false)}
        onAdopt={onAdopt}
      />
      <DeclineDialog
        open={declining}
        signing={signing}
        senderName={envelope.senderName}
        onClose={() => setDeclining(false)}
        onState={onState}
      />
    </div>
  );
}

/** A field's typed value for the overlay (and its label), or null. */
function textValue(
  f: SignerField,
  values: Record<string, string>,
  attachments: Record<string, string>,
): string | null {
  if (f.type === 'ATTACHMENT') return attachments[f.id] ?? null;
  if (['SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'CHECKBOX', 'RADIO'].includes(f.type)) return null;
  return values[f.id]?.trim() || null;
}

/**
 * What a filled field shows on the page (the signature, a tick, the text), or null to keep its
 * name. A plain function, not a component: FieldOverlay needs the null to show the name.
 */
function fieldMark(f: OverlayField, marks: Adopted | null, today: string): ReactNode {
  if (f.type === 'SIGNATURE' || f.type === 'INITIALS') {
    if (!f.filled) return null;
    const mark = f.type === 'SIGNATURE' ? marks?.signature : marks?.initials;
    return mark ? <Mark mark={mark} /> : <span className="text-text italic">Signed</span>;
  }
  if (f.type === 'DATE_SIGNED') {
    return <span className="text-muted">{today}</span>;
  }
  if (f.type === 'CHECKBOX' || f.type === 'RADIO') {
    return f.filled ? (
      <span aria-hidden="true" className="text-text">
        {f.type === 'CHECKBOX' ? '✓' : '●'}
      </span>
    ) : null;
  }
  return f.value ? <span className="text-text">{f.value}</span> : null;
}

function Mark({ mark }: { mark: AdoptedMark }) {
  if (mark.method === 'TYPED') {
    return <span className="font-display text-base text-heading italic">{mark.text}</span>;
  }
  // A data URL drawn in this browser: next/image adds nothing here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mark.png} alt="" className="h-full w-full object-contain" />;
}

/** Decline: the reason goes to the sender. The request is then declined for everyone. */
function DeclineDialog({
  open,
  signing,
  senderName,
  onClose,
  onState,
}: {
  open: boolean;
  signing: SigningClient;
  senderName: string;
  onClose: () => void;
  onState: (state: SignerState) => void;
}) {
  const [reason, setReason] = useState('');
  const decline = useApiMutation((text: string) => signing.decline(text ? { reason: text } : {}));
  return (
    <Modal open={open} title="Decline to sign" onClose={onClose}>
      <div className="flex w-full max-w-xl flex-col gap-4">
        <p className="text-sm text-text">
          If you decline, nobody can sign these documents and {senderName} is told. This can&apos;t
          be undone.
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor="decline-reason" className="text-sm font-medium text-text">
            Reason (optional, shown to {senderName})
          </label>
          <textarea
            id="decline-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-control border border-border bg-surface px-3 py-2 text-base text-text focus-visible:outline-2 focus-visible:outline-focus"
          />
        </div>
        {decline.error && (
          <p role="alert" className="text-sm text-danger">
            {message(decline.error)}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => decline.mutate(reason.trim(), { onSuccess: onState })}
            disabled={decline.isPending}
          >
            Decline to sign
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Keep the documents
          </Button>
        </div>
      </div>
    </Modal>
  );
}
