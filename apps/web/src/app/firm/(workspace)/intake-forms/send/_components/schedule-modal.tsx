'use client';

import { intakeAlertWords, intakeDurationWords } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import Link from 'next/link';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { Loading } from './panel';

/**
 * The firm's reminder times (Intake Form Settings), in words. A send keeps only whether reminders
 * are on (its own switch): its times are always the firm's.
 */
function Timing() {
  const settings = useApiQuery(['intake-forms', 'send', 'settings'], () =>
    api.intakeForms.settings(),
  );
  if (settings.isPending) return <Loading rows={3} />;
  const n = settings.data?.notifications;
  if (!n)
    return (
      <p className="rounded-lg bg-subtle p-4 text-sm text-muted">
        Your firm&apos;s reminder times could not be loaded right now.
      </p>
    );
  const after = (m: number | null) =>
    m === null
      ? 'None (reminders are off in the settings)'
      : `${intakeDurationWords(m)} after sending`;
  const rows: [string, string][] = [
    ['First reminder', after(n.firstReminderAfterMinutes)],
    ['Final reminder', after(n.finalReminderAfterMinutes)],
    [
      'Expiration alert',
      n.expirationAlertMinutes === null
        ? 'None'
        : `${intakeAlertWords(n.expirationAlertMinutes)} before it expires`,
    ],
  ];
  return (
    <dl data-testid="send-schedule" className="flex flex-col divide-y divide-divider text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 py-2">
          <dt className="text-heading">{label}</dt>
          <dd className="text-right font-semibold text-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** View Schedule: when reminders go out for this form, which are the firm's times. */
export function ScheduleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      title="Reminder Schedule"
      subtitle="When reminders go out while the form is still open."
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      }
    >
      {open ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Every form follows your firm&apos;s reminder times, and reminders stop once the form is
            submitted. Turn them off for this form with Send Reminders.
          </p>
          <Timing />
          <Link
            href="/intake-forms/settings"
            className="w-fit text-sm font-semibold text-link hover:underline"
          >
            Change the times in Intake Form Settings
          </Link>
        </div>
      ) : null}
    </Modal>
  );
}
