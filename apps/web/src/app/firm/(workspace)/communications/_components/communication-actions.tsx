'use client';

import type { CommunicationRow } from '@firmivra/types';
import { ActionMenu, type ActionMenuItem, Button, Input, Modal } from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  CalendarBlank,
  Copy,
  DotsThreeVertical,
  Eye,
  FileText,
  PencilSimple,
  Pause,
  Play,
  Prohibit,
  Timer,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { COMM_ERRORS, COMM_KEY, hrefOf } from './communications-shared';

export type Notice = (text: string, tone: 'success' | 'error') => void;

/** Runs one action, refreshes every Communications list, and reports in a toast that outlives the row. */
export function useAct(onNotice: Notice) {
  const qc = useQueryClient();
  return async <T,>(work: () => Promise<T>, done: string): Promise<T | undefined> => {
    try {
      const result = await work();
      await qc.invalidateQueries({ queryKey: [...COMM_KEY] });
      onNotice(done, 'success');
      return result;
    } catch (e) {
      onNotice(errorMessage(e, COMM_ERRORS), 'error');
      return undefined;
    }
  };
}

const localInput = (iso: string | null) => {
  const d = iso ? new Date(iso) : new Date(Date.now() + 86_400_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** Move a scheduled communication to another time. */
export function RescheduleDialog({
  row,
  onClose,
  onNotice,
}: {
  row: Pick<CommunicationRow, 'id' | 'name' | 'scheduledFor'>;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [when, setWhen] = useState(() => localInput(row.scheduledFor));
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title="Reschedule"
      subtitle={row.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !when}
            onClick={async () => {
              setBusy(true);
              const current = await api.communications.get(row.id);
              const ok = await act(
                () =>
                  api.communications.reschedule(row.id, {
                    scheduledFor: new Date(when).toISOString(),
                    etag: current.etag,
                  }),
                'Rescheduled.',
              );
              setBusy(false);
              if (ok) onClose();
            }}
          >
            Reschedule
          </Button>
        </>
      }
    >
      <Input
        label="New send time"
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
      />
    </Modal>
  );
}

export function SaveTemplateDialog({
  id,
  name,
  onClose,
  onNotice,
}: {
  id: string;
  name: string;
  onClose: () => void;
  onNotice: Notice;
}) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title="Save as Template"
      subtitle="The message is copied into the Templates library. The original is not changed."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !value.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api.communications.saveAsTemplate(id, { name: value.trim() });
                onNotice('Saved to Templates.', 'success');
                onClose();
              } catch (e) {
                onNotice(errorMessage(e, COMM_ERRORS), 'error');
                setBusy(false);
              }
            }}
          >
            Save Template
          </Button>
        </>
      }
    >
      <Input label="Template name" value={value} onChange={(e) => setValue(e.target.value)} />
    </Modal>
  );
}

function ConfirmDialog({
  title,
  text,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  confirm: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              onClose();
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text">{text}</p>
    </Modal>
  );
}

/** The actions of one communication, by its status. */
export function CommunicationMenu({
  row,
  onNotice,
  canManage = true,
}: {
  row: CommunicationRow;
  onNotice: Notice;
  canManage?: boolean;
}) {
  const router = useRouter();
  const act = useAct(onNotice);
  const [dialog, setDialog] = useState<'reschedule' | 'cancel' | 'archive' | 'template'>();
  const open: ActionMenuItem = {
    label:
      row.opens === 'COMPOSER'
        ? 'Edit Draft'
        : row.status === 'SCHEDULED'
          ? 'View Schedule'
          : 'View Results',
    icon: row.opens === 'COMPOSER' ? PencilSimple : Eye,
    onSelect: () => router.push(hrefOf(row)),
  };
  const items: ActionMenuItem[] = [open];
  if (canManage) {
    if (row.status === 'SCHEDULED')
      items.push({
        label: 'Reschedule',
        icon: CalendarBlank,
        onSelect: () => setDialog('reschedule'),
      });
    if (row.status === 'SCHEDULED' || row.status === 'SENDING')
      items.push({
        label: 'Pause',
        icon: Pause,
        onSelect: () => void act(() => api.communications.pause(row.id), 'Paused.'),
      });
    if (row.status === 'PAUSED')
      items.push({
        label: 'Resume',
        icon: Play,
        onSelect: () => void act(() => api.communications.resume(row.id), 'Resumed.'),
      });
    if (row.status === 'SCHEDULED' || row.status === 'PAUSED')
      items.push({
        label: 'Cancel Send',
        icon: Prohibit,
        danger: true,
        onSelect: () => setDialog('cancel'),
      });
    if (row.channel === 'ANNOUNCEMENT' && row.status === 'SENT' && !row.archived)
      items.push({
        label: 'Expire Now',
        icon: Timer,
        onSelect: () => void act(() => api.communications.expire(row.id), 'Expired.'),
      });
    items.push({
      label: 'Duplicate',
      icon: Copy,
      onSelect: () =>
        void act(() => api.communications.duplicate(row.id), 'Copied to a new draft.').then((c) => {
          if (c) router.push(`/communications/${c.id}/edit`);
        }),
    });
    items.push({
      label: 'Save as Template',
      icon: FileText,
      onSelect: () => setDialog('template'),
    });
    items.push(
      row.archived
        ? {
            label: 'Restore',
            icon: ArrowCounterClockwise,
            onSelect: () => void act(() => api.communications.restore(row.id), 'Restored.'),
          }
        : {
            label: 'Archive',
            icon: Archive,
            danger: true,
            onSelect: () => setDialog('archive'),
          },
    );
  }
  return (
    <>
      <ActionMenu
        label={`Actions for ${row.name}`}
        trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
        sections={[{ items }]}
        align="right"
      />
      {dialog === 'reschedule' ? (
        <RescheduleDialog row={row} onClose={() => setDialog(undefined)} onNotice={onNotice} />
      ) : null}
      {dialog === 'template' ? (
        <SaveTemplateDialog
          id={row.id}
          name={row.name}
          onClose={() => setDialog(undefined)}
          onNotice={onNotice}
        />
      ) : null}
      {dialog === 'cancel' ? (
        <ConfirmDialog
          title="Cancel this send?"
          text="Nothing will be sent. You can duplicate it later to start again."
          confirm="Cancel Send"
          onConfirm={() => act(() => api.communications.cancel(row.id), 'Cancelled.')}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
      {dialog === 'archive' ? (
        <ConfirmDialog
          title="Archive this communication?"
          text="It moves out of the lists. You can restore it from the archive."
          confirm="Archive"
          onConfirm={() => act(() => api.communications.archive(row.id), 'Archived.')}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
    </>
  );
}
