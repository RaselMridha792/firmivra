'use client';

import {
  intakeAlertWords,
  intakeDurationWords,
  type IntakeReminderPlan,
  intakeReminderPlan,
  intakeReminderSkipWords,
} from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import Link from 'next/link';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { toInstant } from '../../../calendar/_components/time';
import { defaultExpiry, type Expiry, expiryText, useFirmTimeZone } from '../../_components/expiry';
import { Loading } from './panel';

/** The expiration a send would get: the time chosen, none, or the form's default days. */
function expiryOf(
  e: Expiry,
  formDays: number | null | undefined,
  timeZone: string,
  now: Date,
): Date | null | undefined {
  if (e.mode === 'NONE') return null;
  if (e.mode === 'AT')
    return e.date ? new Date(toInstant(e.date, e.time || '23:59', timeZone)) : undefined;
  if (formDays === undefined) return undefined;
  if (formDays === null) return null;
  return new Date(defaultExpiry(formDays, timeZone, now));
}

/**
 * Review Two 10c: this form's two reminders if it were sent now, from the firm's times and the
 * expiration chosen, in order (intakeReminderPlan, the rule the schedule job follows). Undefined
 * while the times, the form or the time zone are still loading.
 */
export function useReminderPlan(c: {
  formId: string;
  expiry: Expiry;
}): { plan: IntakeReminderPlan; timeZone: string } | undefined {
  const timeZone = useFirmTimeZone();
  const settings = useApiQuery(['intake-forms', 'send', 'settings'], () =>
    api.intakeForms.settings(),
  );
  const form = useApiQuery(['intake-forms', 'send', 'form', c.formId], () =>
    c.formId ? api.intakeForms.form(c.formId) : Promise.resolve(null),
  );
  const n = settings.data?.notifications;
  if (!n || !timeZone) return undefined;
  const now = new Date();
  const formDays = form.data ? form.data.settings.expiresAfterDays : undefined;
  const expiresAt = expiryOf(c.expiry, formDays, timeZone, now);
  if (expiresAt === undefined) return undefined;
  return {
    plan: intakeReminderPlan({
      sentAt: now,
      expiresAt,
      firstMinutes: n.firstReminderAfterMinutes,
      finalMinutes: n.finalReminderAfterMinutes,
    }),
    timeZone,
  };
}

/** The reminders this form would skip, in the words its History will use. */
export function reminderSkips(plan: IntakeReminderPlan): string[] {
  return [
    plan.firstSkipped ? intakeReminderSkipWords('FIRST', plan.firstSkipped) : null,
    plan.finalSkipped ? intakeReminderSkipWords('FINAL', plan.finalSkipped) : null,
  ].filter((line): line is string => line !== null);
}

/** This form's reminder times (or why one is skipped), under the firm's times. */
function ThisForm({ formId, expiry }: { formId: string; expiry: Expiry }) {
  const preview = useReminderPlan({ formId, expiry });
  if (!preview) return null;
  const { plan, timeZone } = preview;
  const when = (at: Date | null, skipped: string | null, off: string) =>
    skipped ?? (at ? expiryText(at.toISOString(), timeZone) : off);
  const rows: [string, string][] = [
    [
      'First reminder',
      when(
        plan.firstAt,
        plan.firstSkipped ? intakeReminderSkipWords('FIRST', plan.firstSkipped) : null,
        'None',
      ),
    ],
    [
      'Final reminder',
      when(
        plan.finalAt,
        plan.finalSkipped ? intakeReminderSkipWords('FINAL', plan.finalSkipped) : null,
        'None (the form never expires, or the final reminder is off)',
      ),
    ],
  ];
  return (
    <section aria-label="This form's reminders" className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold text-heading">If you send it now</h3>
      <dl
        data-testid="send-schedule-form"
        className="flex flex-col divide-y divide-divider text-sm"
      >
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-2">
            <dt className="text-heading">{label}</dt>
            <dd className="text-right font-semibold text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

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
  const off = 'None (reminders are off in the settings)';
  const after = (m: number | null) =>
    m === null ? off : `${intakeDurationWords(m)} after sending`;
  // Review Two 10c: the final reminder counts back from the expiry.
  const before = (m: number | null) =>
    m === null ? off : `${intakeDurationWords(m)} before it expires`;
  const rows: [string, string][] = [
    ['First reminder', after(n.firstReminderAfterMinutes)],
    ['Final reminder', before(n.finalReminderAfterMinutes)],
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
export function ScheduleModal({
  open,
  onClose,
  formId,
  expiry,
}: {
  open: boolean;
  onClose: () => void;
  /** The form and expiration chosen, for this form's own times (10c). */
  formId: string;
  expiry: Expiry;
}) {
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
            submitted. A form with no expiration gets the first reminder only. Turn them off for
            this form with Send Reminders.
          </p>
          <Timing />
          <ThisForm formId={formId} expiry={expiry} />
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
