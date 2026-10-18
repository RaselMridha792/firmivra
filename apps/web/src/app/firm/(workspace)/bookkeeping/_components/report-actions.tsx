'use client';

import type { BookkeepingReportRow } from '@firmivra/types';
import { ActionMenu, type ActionMenuItem, Button, Input, Modal, Select } from '@firmivra/ui';
import {
  ArrowUUpLeft,
  CheckCircle,
  DotsThreeVertical,
  PaperPlaneTilt,
  Play,
  UploadSimple,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { useAct, type Notice } from './bookkeeping-actions';
import { BK_KEY, dayText, quiet } from './bookkeeping-shared';

/** Delivery links the published report the client sees (the workspace's reports). */
function DeliverDialog({
  row,
  engagementId,
  onClose,
  onNotice,
}: {
  row: BookkeepingReportRow;
  engagementId: string | null;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const owner = useApiQuery([...BK_KEY, 'engagement', row.bookkeepingClientId], () =>
    engagementId ? Promise.resolve(null) : api.bookkeeping.getClient(row.bookkeepingClientId),
  );
  const eid = engagementId ?? owner.data?.engagementId ?? null;
  const published = useApiQuery([...BK_KEY, 'published', eid ?? 'none'], () =>
    eid ? api.workspaces.reports(eid, { status: 'PUBLISHED', limit: 50 }) : Promise.resolve(null),
  );
  const [pick, setPick] = useState('');
  const items = published.data?.items ?? [];
  return (
    <Modal
      open
      title="Deliver to the Client"
      subtitle={`${row.name} · ${row.periodLabel}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!pick}
            onClick={async () => {
              await act(
                () => api.bookkeeping.deliverReport(row.id, { engagementReportId: pick }),
                'Delivered.',
              );
              onClose();
            }}
          >
            Deliver
          </Button>
        </>
      }
    >
      <div data-testid="deliver-dialog">
        {items.length === 0 ? (
          <p className={quiet}>
            {published.isPending
              ? 'Loading…'
              : 'There is no published report for this client yet. Publish one in the client workspace first.'}
          </p>
        ) : (
          <Select
            label="Published report"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            options={[
              { value: '', label: 'Choose…' },
              ...items.map((r) => ({
                value: r.id,
                label: `${r.title}${r.periodLabel ? ` · ${r.periodLabel}` : ''}`,
              })),
            ]}
          />
        )}
      </div>
    </Modal>
  );
}

function NoteDialog({
  title,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string;
  confirm: string;
  onConfirm: (note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm(note.trim());
              onClose();
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

/** The moves of one report: start, send for review, send back, approve, deliver. */
export function ReportMenu({
  row,
  engagementId,
  onNotice,
  canManage = true,
}: {
  row: BookkeepingReportRow;
  engagementId: string | null;
  onNotice: Notice;
  canManage?: boolean;
}) {
  const act = useAct(onNotice);
  const [dialog, setDialog] = useState<'back' | 'deliver'>();
  const items: ActionMenuItem[] = [];
  if (row.status === 'NOT_STARTED')
    items.push({
      label: 'Start Report',
      icon: Play,
      onSelect: () => void act(() => api.bookkeeping.startReport(row.id), 'Report started.'),
    });
  if (row.status === 'IN_PROGRESS')
    items.push({
      label: 'Send for Review',
      icon: PaperPlaneTilt,
      onSelect: () => void act(() => api.bookkeeping.submitReport(row.id), 'Sent for review.'),
    });
  if (canManage && (row.status === 'IN_REVIEW' || row.status === 'APPROVED'))
    items.push({ label: 'Send Back', icon: ArrowUUpLeft, onSelect: () => setDialog('back') });
  if (canManage && row.status === 'IN_REVIEW')
    items.push({
      label: 'Approve',
      icon: CheckCircle,
      onSelect: () => void act(() => api.bookkeeping.approveReport(row.id), 'Approved.'),
    });
  if (canManage && row.status === 'APPROVED')
    items.push({
      label: 'Deliver to Client',
      icon: UploadSimple,
      onSelect: () => setDialog('deliver'),
    });
  if (items.length === 0)
    return (
      <span className="text-xs text-muted">
        {row.status === 'DELIVERED' && row.deliveredAt
          ? `Delivered ${dayText(row.deliveredAt.slice(0, 10))}`
          : '—'}
      </span>
    );
  return (
    <>
      <ActionMenu
        label={`Actions for ${row.name}`}
        trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
        sections={[{ items }]}
        align="right"
      />
      {dialog === 'back' ? (
        <NoteDialog
          title="Send the report back"
          confirm="Send Back"
          onClose={() => setDialog(undefined)}
          onConfirm={async (note) =>
            void (await act(
              () => api.bookkeeping.sendReportBack(row.id, note ? { note } : {}),
              'Sent back.',
            ))
          }
        />
      ) : null}
      {dialog === 'deliver' ? (
        <DeliverDialog
          row={row}
          engagementId={engagementId}
          onClose={() => setDialog(undefined)}
          onNotice={onNotice}
        />
      ) : null}
    </>
  );
}
