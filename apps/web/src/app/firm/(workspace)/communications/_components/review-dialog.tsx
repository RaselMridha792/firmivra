'use client';

import type { AudienceSummary, CommunicationDetail } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { CheckCircle, Warning, XCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { HtmlFrame } from '../../templates/_components/html-preview';
import { CommsHelp } from './communications-help';
import {
  COMM_ERRORS,
  COMM_KEY,
  channelOf,
  dateTimeText,
  EXCLUSION_REASON,
  MISSING_CHANNEL,
  plain,
  quiet,
} from './communications-shared';

/** Review & Send: the final checks, the exact count, and the one explicit confirmation. */
export function ReviewDialog({
  detail,
  scheduledFor,
  onClose,
  onDone,
}: {
  detail: CommunicationDetail;
  /** ISO time when the user chose "Schedule", otherwise send now. */
  scheduledFor: string | null;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const review = useApiQuery([...COMM_KEY, 'review', detail.id, detail.etag], () =>
    api.communications.review(detail.id),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [key] = useState(() => crypto.randomUUID());
  const r = review.data;
  const count = r?.audience.finalCount ?? 0;
  const act = scheduledFor ? 'Schedule' : 'Send';
  return (
    <Modal
      open
      title="Review & Send"
      subtitle={detail.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back to editing
          </Button>
          <Button
            disabled={busy || !r?.canSend}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                const body = { idempotencyKey: key, expectedFinalCount: count, etag: detail.etag };
                if (scheduledFor)
                  await api.communications.schedule(detail.id, { ...body, scheduledFor });
                else await api.communications.send(detail.id, body);
                onDone(detail.id);
              } catch (e) {
                setError(errorMessage(e, COMM_ERRORS));
                setBusy(false);
              }
            }}
          >
            {act} to {count} {count === 1 ? 'recipient' : 'recipients'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="review-dialog">
        <p className="-mt-5 flex items-center gap-2 text-sm text-muted">
          Check it once more before it goes out. <CommsHelp area="review" />
        </p>
        {review.isPending ? <p className={quiet}>Checking…</p> : null}
        {review.isError ? <p className={quiet}>The review is not available right now.</p> : null}
        {r ? (
          <>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted">Type</dt>
              <dd className="text-heading">{channelOf(r.channel).label}</dd>
              <dt className="text-muted">From</dt>
              <dd className="text-heading">{r.sender?.label ?? 'Client portal'}</dd>
              {r.subject !== null ? (
                <>
                  <dt className="text-muted">Subject</dt>
                  <dd className="text-heading">{r.subject || '—'}</dd>
                </>
              ) : null}
              <dt className="text-muted">Recipients</dt>
              <dd className="text-heading" data-testid="review-count">
                {r.audience.finalCount} of {r.audience.selectedCount} selected
              </dd>
              <dt className="text-muted">When</dt>
              <dd className="text-heading">
                {scheduledFor ? dateTimeText(scheduledFor) : 'Immediately'}
              </dd>
            </dl>
            <LeftOut audience={r.audience} channel={r.channel} />
            <ul className="flex flex-col gap-1" aria-label="Checks" data-testid="review-checks">
              {r.checks.map((c, i) => {
                const Glyph =
                  c.severity === 'OK' ? CheckCircle : c.severity === 'WARN' ? Warning : XCircle;
                return (
                  <li
                    key={i}
                    className={`flex items-start gap-2 text-sm ${c.severity === 'OK' ? 'text-success' : c.severity === 'WARN' ? 'text-warning' : 'text-danger'}`}
                  >
                    <Glyph aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
                    <span>{c.message}</span>
                  </li>
                );
              })}
            </ul>
            {r.channel === 'SMS' ? (
              <div
                className="max-h-40 overflow-auto rounded-lg border border-divider bg-surface p-3 text-sm whitespace-pre-wrap text-heading"
                data-testid="review-preview"
              >
                {plain(r.preview.body)}
              </div>
            ) : (
              <HtmlFrame
                html={r.preview.body}
                title="Message preview"
                className="h-48"
                testId="review-preview"
              />
            )}
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * C19 (Communications Review 2): who is included and who is left out, with each reason in the
 * channel's words (an announcement's missing channel is no portal access), the duplicates and
 * those without consent too.
 */
function LeftOut({
  audience: a,
  channel,
}: {
  audience: AudienceSummary;
  channel: CommunicationDetail['channel'];
}) {
  const reasons = [
    [EXCLUSION_REASON['UNSUBSCRIBED'], a.autoExcluded.unsubscribed],
    [EXCLUSION_REASON['INVALID'], a.autoExcluded.invalid],
    [MISSING_CHANNEL[channel], a.autoExcluded.missingChannel],
    [EXCLUSION_REASON['DUPLICATE'], a.autoExcluded.duplicate],
    [EXCLUSION_REASON['NO_CONSENT'], a.autoExcluded.ineligible],
    ['Chosen by hand', a.manualExcludedCount],
  ] as const;
  const shown = reasons.filter(([, n]) => n > 0);
  const total = shown.reduce((sum, [, n]) => sum + n, 0);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-heading" data-testid="review-included">
        Included: {a.finalCount}
      </p>
      {total > 0 ? (
        <div className="rounded-lg bg-warning-soft p-3 text-warning" data-testid="review-excluded">
          <p className="font-medium">Left out: {total}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {shown.map(([label, n]) => (
              <li key={label}>
                {label}: {n}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
