'use client';

import {
  CalendarX,
  CheckCircle,
  DotsThreeVertical,
  Envelope,
  Eye,
  PencilSimple,
  UserMinus,
  XCircle,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { AP } from './ap-shared';

export interface Notify {
  (message: string, tone?: 'success' | 'error'): void;
}

/** The status changes and Send Reminder, on the same record the form and the calendar use. */
export function useAppointmentActions(notify: Notify) {
  const done = (message: string) => () => notify(message);
  const failed = (error: unknown) => notify(errorMessage(error), 'error');
  const options = { invalidate: AP };
  const complete = useApiMutation((id: string) => api.appointments.complete(id), options);
  const noShow = useApiMutation((id: string) => api.appointments.noShow(id), options);
  const cancel = useApiMutation((id: string) => api.appointments.cancel(id), options);
  const confirm = useApiMutation((id: string) => api.scheduling.confirm(id), options);
  const remind = useApiMutation((id: string) => api.scheduling.sendReminder(id), options);
  return {
    complete: (id: string) =>
      complete.mutate(id, { onSuccess: done('Marked completed.'), onError: failed }),
    noShow: (id: string) =>
      noShow.mutate(id, { onSuccess: done('Marked as a no-show.'), onError: failed }),
    cancel: (id: string) =>
      cancel.mutate(id, { onSuccess: done('Appointment canceled.'), onError: failed }),
    confirm: (id: string) =>
      confirm.mutate(id, { onSuccess: done('Appointment confirmed.'), onError: failed }),
    remind: (id: string) =>
      remind.mutate(id, {
        onSuccess: (result) =>
          notify(
            result.sent > 0
              ? 'Reminder sent.'
              : 'No reminder was sent: the contact has no reachable channel.',
            result.sent > 0 ? 'success' : 'error',
          ),
        onError: failed,
      }),
    pending:
      complete.isPending ||
      noShow.isPending ||
      cancel.isPending ||
      confirm.isPending ||
      remind.isPending,
  };
}

/** The row's three icons: Edit, Reschedule and the menu of the rest. */
export function RowActions({
  id,
  name,
  actions,
  closed,
}: {
  id: string;
  name: string;
  actions: ReturnType<typeof useAppointmentActions>;
  /** Completed, canceled or no-show: only View Details is left. */
  closed?: boolean;
}) {
  const router = useRouter();
  return (
    <div className="flex items-center justify-end gap-2">
      {closed ? null : (
        <>
          <Link
            href={`/calendar/${id}/edit`}
            aria-label={`Edit ${name}`}
            title="Edit"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-divider bg-surface text-heading hover:bg-canvas"
          >
            <PencilSimple aria-hidden weight="fill" className="size-4" />
          </Link>
          <Link
            href={`/calendar/${id}/edit`}
            aria-label={`Reschedule ${name}`}
            title="Reschedule"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-divider bg-surface text-danger hover:bg-canvas"
          >
            <CalendarX aria-hidden weight="fill" className="size-4" />
          </Link>
        </>
      )}
      <KebabMenu
        label={`More actions for ${name}`}
        sections={[
          {
            items: [
              { label: 'View Details', icon: Eye, onSelect: () => router.push(`/calendar/${id}`) },
              ...(closed
                ? []
                : [
                    { label: 'Send Reminder', icon: Envelope, onSelect: () => actions.remind(id) },
                    { label: 'Confirm', icon: CheckCircle, onSelect: () => actions.confirm(id) },
                    {
                      label: 'Mark Completed',
                      icon: CheckCircle,
                      onSelect: () => actions.complete(id),
                    },
                    { label: 'Mark No-Show', icon: UserMinus, onSelect: () => actions.noShow(id) },
                    {
                      label: 'Cancel Appointment',
                      icon: XCircle,
                      danger: true,
                      onSelect: () => actions.cancel(id),
                    },
                  ]),
            ],
          },
        ]}
      />
    </div>
  );
}

interface KebabItem {
  label: string;
  icon: Icon;
  onSelect: () => void;
  danger?: boolean;
}

/** The square three-dot button of a row, opening a short list of actions (no caret, as designed). */
export function KebabMenu({
  label,
  sections,
}: {
  label: string;
  sections: { items: KebabItem[] }[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) =>
      rootRef.current && !rootRef.current.contains(event.target as Node) && setOpen(false);
    const esc = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
        className="inline-flex size-8 items-center justify-center rounded-lg border border-divider bg-surface text-heading hover:bg-canvas"
      >
        <DotsThreeVertical aria-hidden weight="bold" className="size-4" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="absolute top-full right-0 z-30 mt-1 w-56 rounded-xl border border-divider bg-surface p-2 shadow-lg"
        >
          {sections.flatMap((section) =>
            section.items.map(({ label: text, icon: Glyph, onSelect, danger }) => (
              <button
                key={text}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelect();
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-sm hover:bg-canvas ${danger ? 'text-danger' : 'text-text'}`}
              >
                <Glyph aria-hidden weight="fill" className="size-4 shrink-0" />
                {text}
              </button>
            )),
          )}
        </div>
      ) : null}
    </div>
  );
}
