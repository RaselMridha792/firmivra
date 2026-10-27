'use client';

import { INTAKE_STATUS_LABELS, type IntakeSummary, type TaxReturnDetail } from '@firmivra/types';
import { Badge, Textarea } from '@firmivra/ui';
import { ClipboardText } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { OriginLink } from '../../../../../../components/origin-link';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { Dialog, useAct, useManager, type Notice } from '../../_components/return-actions';
import { Panel, textButton } from '../../_components/review-panels';
import { TR_KEY, quiet } from '../../_components/tr-shared';

/** What may be sent back to the client for a correction (R11's rule). */
const CORRECTABLE: IntakeSummary['status'][] = ['SUBMITTED', 'UNDER_REVIEW', 'COMPLETED'];
/** The day an instant falls on, here ("Oct 20, 2026"). */
const onDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const TONE: Partial<Record<IntakeSummary['status'], 'success' | 'warning' | 'info' | 'neutral'>> = {
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  COMPLETED: 'success',
  NEEDS_CORRECTION: 'warning',
};

/**
 * Intake Form (Octavia's TX-F11): the client's intake forms for this return, matched by the
 * return's engagement or by its tax year, never a fixed year. Open shows every submitted answer,
 * with Back to this tab (SH1's OriginLink); Request Correction sends the form back to the client
 * (Owner and Admin). An intake stays an intake: it is never turned into an uploaded document.
 */
export function IntakeFormCard({
  detail,
  onNotice,
}: {
  detail: TaxReturnDetail;
  onNotice: Notice;
}) {
  const manager = useManager();
  const [correcting, setCorrecting] = useState<IntakeSummary | null>(null);
  const q = useApiQuery([...TR_KEY, 'intakes', detail.client.id], () =>
    api.intakes.listForClient(detail.client.id),
  );
  const forms = (q.data ?? []).filter(
    (i) =>
      i.status !== 'ARCHIVED' &&
      (i.engagement.id === detail.engagement?.id || i.engagement.taxYear === detail.taxYear),
  );
  return (
    <Panel title="Intake Form" icon={ClipboardText} testId="intake-form">
      {q.isError ? (
        <p role="alert" className={quiet}>
          Intake forms are not available right now.
        </p>
      ) : q.isPending ? (
        <p className={quiet}>Loading…</p>
      ) : forms.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className={quiet}>No intake form for {detail.taxYear} yet.</p>
          <OriginLink href="/intake-forms/send" className={textButton}>
            Send an Intake Form
          </OriginLink>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-divider">
          {forms.map((i) => (
            <li key={i.id} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-heading">{i.service.name}</span>
                <Badge tone={TONE[i.status] ?? 'neutral'}>{INTAKE_STATUS_LABELS[i.status]}</Badge>
              </div>
              <p className="text-sm text-muted">
                {i.engagement.title}
                {i.submittedAt ? ` · submitted ${onDay(i.submittedAt)}` : ''}
                {i.version > 1 ? ` · version ${i.version}` : ''}
              </p>
              {i.status === 'NEEDS_CORRECTION' && i.correctionNote ? (
                <p className="text-sm text-text wrap-anywhere">
                  Correction requested: “{i.correctionNote}”
                </p>
              ) : null}
              <div className="flex flex-wrap gap-4">
                <OriginLink href={`/intake-forms/${i.id}`} className={textButton}>
                  Open
                  <span className="sr-only"> {i.service.name}</span>
                </OriginLink>
                {manager && CORRECTABLE.includes(i.status) ? (
                  <button type="button" className={textButton} onClick={() => setCorrecting(i)}>
                    Request Correction
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {correcting ? (
        <CorrectionDialog
          detail={detail}
          intake={correcting}
          onClose={() => setCorrecting(null)}
          onNotice={onNotice}
        />
      ) : null}
    </Panel>
  );
}

/** Request Correction: the note goes to the client with the form, which opens for them again. */
function CorrectionDialog({
  detail,
  intake,
  onClose,
  onNotice,
}: {
  detail: TaxReturnDetail;
  intake: IntakeSummary;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const done = await act(
      () => api.intakeForms.requestRevision(intake.id, { note: note.trim() }),
      `${detail.client.name} gets the form back with your note.`,
    );
    setBusy(false);
    if (done) {
      await queryClient.invalidateQueries({ queryKey: [...TR_KEY, 'intakes'] });
      onClose();
    }
  };
  return (
    <Dialog
      title="Request Correction"
      subtitle={`${intake.service.name} · ${intake.engagement.title}`}
      confirm="Send to Client"
      busy={busy}
      disabled={!note.trim()}
      onConfirm={() => void send()}
      onClose={onClose}
      testId="correction-dialog"
    >
      <Textarea
        label="What to correct (the client sees this)"
        value={note}
        maxLength={2000}
        onChange={(e) => setNote(e.target.value)}
      />
    </Dialog>
  );
}
