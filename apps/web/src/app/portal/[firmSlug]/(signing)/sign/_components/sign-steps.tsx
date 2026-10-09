'use client';

import {
  ESIGN_ERRORS,
  type SignerCopy,
  type SignerCopyFile,
  type SignerEnvelope,
} from '@firmivra/types';
import { Button, Card, EmptyState } from '@firmivra/ui';
import { useEffect, useEffectEvent, useState } from 'react';
import { FieldOverlay, type OverlayField } from '../../../../../../components/esign/field-overlay';
import { PdfPages } from '../../../../../../components/esign/pdf-pages';
import { errorMessage } from '../../../../../../lib/errors';
import type { StepProps } from './signer-page';

const message = (e: unknown) => errorMessage(e, ESIGN_ERRORS);

/** Loads something from the signer API once per step; `null` while loading. */
function useLoad<T>(signing: StepProps['signing'], load: (s: StepProps['signing']) => Promise<T>) {
  const [value, setValue] = useState<{ ok: T } | { error: string } | null>(null);
  const run = useEffectEvent(() => load(signing));
  useEffect(() => {
    let active = true;
    run()
      .then((ok) => {
        if (active) setValue({ ok });
      })
      .catch((e: unknown) => {
        if (active) setValue({ error: message(e) });
      });
    return () => {
      active = false;
    };
  }, [signing]);
  return value;
}

/**
 * SIGN: the document with the signer's own fields. Adopting a signature, filling the fields,
 * finishing and declining come in signer flow 2.
 */
export function SignStep({ signing }: StepProps) {
  const loaded = useLoad(signing, (s) => s.envelope());
  if (!loaded) return <p className="text-sm text-muted">Loading the document…</p>;
  if ('error' in loaded) {
    return (
      <p role="alert" className="text-sm text-danger">
        {loaded.error}
      </p>
    );
  }
  const envelope = loaded.ok;
  const fields = envelope.fields.map((f) => toOverlay(f, envelope));
  const recipients = [{ id: envelope.me.recipientId, name: envelope.me.name, colorIndex: 0 }];
  return (
    <div className="flex flex-col gap-4">
      {envelope.message && (
        <Card title={`Message from ${envelope.senderName}`}>
          <p className="text-sm whitespace-pre-line text-text">{envelope.message}</p>
        </Card>
      )}
      <p className="text-sm text-text">
        {envelope.fields.length
          ? `You have ${envelope.fields.length} ${envelope.fields.length === 1 ? 'field' : 'fields'} to fill in, marked on the pages.`
          : 'You sign on the signature page at the end of the document.'}
      </p>
      <PdfPages
        source={envelope.packetUrl}
        label={envelope.title}
        overlay={(pageIndex) => (
          <FieldOverlay
            fields={fields}
            recipients={recipients}
            pageIndex={pageIndex}
            ownerId={envelope.me.recipientId}
          />
        )}
      />
    </div>
  );
}

/** A signer's field in the overlay's shape: all theirs, in the first recipient colour. */
function toOverlay(f: SignerEnvelope['fields'][number], envelope: SignerEnvelope): OverlayField {
  return {
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
    value: null,
    filled: false,
  };
}

/** COPY: a completed request's signed document and certificate, from the copy link. */
export function CopyStep({ signing }: StepProps) {
  const loaded = useLoad(signing, (s) => s.copy());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<SignerCopyFile | null>(null);

  async function download(file: SignerCopyFile) {
    setBusy(file);
    setError(null);
    try {
      const link = await signing.downloadCopy(file);
      window.location.assign(link.url);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) return <p className="text-sm text-muted">Loading…</p>;
  if ('error' in loaded) {
    return (
      <p role="alert" className="text-sm text-danger">
        {loaded.error}
      </p>
    );
  }
  const copy: SignerCopy = loaded.ok;
  return (
    <Card title="Your signed copy">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text">
          Everyone has signed. Completed on{' '}
          {new Date(copy.completedAt).toLocaleDateString(undefined, { dateStyle: 'long' })}.
        </p>
        <ul className="flex flex-col gap-2">
          {copy.files.map((f) => (
            <li key={f.file} className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-text">{f.fileName}</span>
              <Button
                variant="secondary"
                onClick={() => void download(f.file)}
                disabled={busy !== null}
              >
                {f.file === 'final' ? 'Download the document' : 'Download the certificate'}
              </Button>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}

/** WAITING, DONE, DECLINED and CLOSED: nothing to do here (now or any more). */
export function StatusStep({ state }: StepProps) {
  const sender = state.senderName;
  const closed: Record<string, string> = {
    COMPLETED: 'Everyone has signed. This request is complete.',
    EXPIRED: `This request has expired. Ask ${sender} to send it again if you still need to sign.`,
    VOIDED: `${sender} cancelled this request. There is nothing for you to sign.`,
    DECLINED: 'Someone declined this request, so it is closed.',
  };
  const text = {
    WAITING: {
      title: 'Not your turn yet',
      description: `Someone else signs before you. We'll email you when it's your turn.`,
    },
    DONE: {
      title: "You're done",
      description:
        "Thank you. We'll email you a link to your copy once everyone has signed. You can close this page.",
    },
    DECLINED: {
      title: 'You declined',
      description: `You declined to sign. ${sender} has been told.`,
    },
    CLOSED: {
      title: 'This request is closed',
      description:
        (state.requestStatus && closed[state.requestStatus]) ??
        'This request is closed. There is nothing more to sign.',
    },
  }[state.step as 'WAITING' | 'DONE' | 'DECLINED' | 'CLOSED'];
  return <EmptyState title={text.title} description={text.description} />;
}
