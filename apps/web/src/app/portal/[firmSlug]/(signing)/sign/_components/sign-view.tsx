'use client';

import {
  ESIGN_ERRORS,
  type SignerAdoptBody,
  type SignerEnvelope,
  type SignerField,
  type SignerState,
  type SigningClient,
} from '@firmivra/types';
import { Button, Card, Input, Modal } from '@firmivra/ui';
import { type ReactNode, useMemo, useState } from 'react';
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
  filledIds,
  finishValues,
  groupOf,
  requiredCount,
  startValues,
  toFill,
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
  const ordered = useMemo(() => [...fields].sort(byPosition), [fields]);
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
  const done = filledIds(fields, filled);
  const left = toFill(ordered, done);
  const required = requiredCount(fields);
  const needsInitials = fields.some((f) => f.type === 'INITIALS');
  // As the API checks: finishing always needs an adopted signature, with initials when they
  // have an INITIALS field.
  const needsAdopting = !adoptedOnServer || (needsInitials && !adoptedOnServer.hasInitials);
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
    const following = (list: SignerField[]) =>
      list.find((f) => ordered.indexOf(f) > after) ?? list[0];
    // The next empty required field after the current one (from the top again at the end);
    // once those are done, the empty optional ones the same way.
    const target = following(left) ?? following(toFill(ordered, done, true));
    if (target) goTo(target);
    else setNotice('Every field is filled in. Select Finish to sign.');
  }

  function select(id: string) {
    const f = fields.find((x) => x.id === id);
    if (!f) return;
    setActiveId(id);
    if (f.type === 'CHECKBOX') setValue(id, values[id] === 'true' ? 'false' : 'true');
    if (f.type === 'RADIO') choose(id);
    if ((f.type === 'SIGNATURE' || f.type === 'INITIALS') && !done.has(f.id)) {
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
      for (const o of fields)
        if (o.type === 'RADIO' && groupOf(o) === groupOf(f)) out[o.id] = 'false';
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
        // A refused Finish ("adopt first") no longer applies.
        finish.reset();
      },
    });
  }

  function submit() {
    setNotice(undefined);
    if (needsAdopting) {
      setAdopting(true);
      return;
    }
    const first = left[0];
    if (first) {
      setNotice(
        `Fill in every required field first: ${left.length} ${left.length === 1 ? 'is' : 'are'} left.`,
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
    // A radio group is answered by one option: only the chosen one shows as done.
    filled: f.type === 'RADIO' ? values[f.id] === 'true' : done.has(f.id),
  }));
  const recipients = [{ id: envelope.me.recipientId, name: envelope.me.name, colorIndex: 0 }];

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
          : envelope.autoSignaturePage
            ? 'You sign on the signature page at the end of the document.'
            : 'There is nothing for you to fill in on this document.'}
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
          {required > 0 && (
            <p data-testid="sign-progress" className="mr-auto text-sm text-muted">
              {required - left.length} of {required} required done
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
  // A data URL drawn in this browser: next/image adds nothing here. It fills the field's box
  // (the box is positioned), whatever its shape.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mark.png} alt="" className="absolute inset-0 h-full w-full object-contain" />;
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
        <Input
          label={`Reason (optional, shown to ${senderName})`}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
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
