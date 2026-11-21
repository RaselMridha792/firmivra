'use client';

import { type Expiry, expiryText, useFirmTimeZone } from '../../_components/expiry';
import { toInstant } from '../../../calendar/_components/time';
import {
  ChatText,
  CheckCircle,
  EnvelopeSimple,
  FloppyDisk,
  Graph,
  type Icon,
  Info,
  PaperPlaneTilt,
  WarningCircle,
} from '@phosphor-icons/react';
import type { SendIntakeFormResult } from '@firmivra/types';
import { Button, Checkbox, tintTones } from '@firmivra/ui';
import Link from 'next/link';
import { type ReactNode, useId } from 'react';
import { Panel } from './panel';
import { reminderSkips, useReminderPlan } from './schedule-modal';
import {
  CHANNEL_LABELS,
  deliverySummary,
  formatDay,
  routeLine,
  type SendChoices,
  type SendNotice,
} from './send-model';

const ROUTE_ICONS = { EMAIL: EnvelopeSimple, SMS: ChatText, PORTAL: Graph };

const NOTE_TONES = {
  success: {
    box: 'border-success/20 bg-success-soft',
    icon: tintTones.green,
    title: 'text-success',
  },
  warning: { box: 'border-gold/30 bg-warning-soft', icon: tintTones.amber, title: 'text-warning' },
  plain: { box: 'border-border bg-subtle', icon: tintTones.grey, title: 'text-heading' },
};

/** Ready to Send, Not Ready Yet and Form Sent: a soft round icon and a coloured title. */
function Note({
  tone,
  icon: Glyph,
  title,
  children,
}: {
  tone: keyof typeof NOTE_TONES;
  icon: Icon;
  title: string;
  children: ReactNode;
}) {
  const t = NOTE_TONES[tone];
  return (
    <div className={`flex items-start gap-4 rounded-lg border p-4 ${t.box}`}>
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ${t.icon}`}>
        <Glyph aria-hidden weight="fill" className="size-6" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-muted">
        <p className={`text-base font-bold ${t.title}`}>{title}</p>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-t border-border py-2 text-sm">
      <dt className="w-28 shrink-0 text-text">{label}</dt>
      <dd className="min-w-0 flex-1 wrap-break-word text-heading">{children}</dd>
    </div>
  );
}

/** The time the mail service took the email, in the member's own time zone. */
function acceptedTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** After Send Form: the delivery result, with the way to the sent form and back to the list. */
function SentResult({
  result,
  onAnother,
}: {
  result: SendIntakeFormResult;
  onAnother: () => void;
}) {
  const { delivery, form } = result;
  const sent = delivery.status === 'SENT';
  const byEmail = delivery.channel === 'EMAIL';
  // Intake Forms Review Two 19b: what really happened, never a portal notice counted as an email.
  const outcome = sent
    ? byEmail
      ? 'Accepted by the mail service'
      : 'Sent'
    : delivery.status === 'RETRYING'
      ? 'Not accepted yet, retrying'
      : 'Not sent';
  return (
    <div className="flex flex-col gap-3" data-testid="send-result">
      <Note
        tone={sent ? 'success' : 'warning'}
        icon={sent ? CheckCircle : WarningCircle}
        title={
          sent ? 'Form Sent' : delivery.status === 'RETRYING' ? 'Email Retrying' : 'Delivery Failed'
        }
      >
        <p>
          {CHANNEL_LABELS[delivery.channel]} to {delivery.to}:{' '}
          <span className="font-semibold">{outcome}</span>
        </p>
        {byEmail && form.recipient.kind === 'CLIENT' ? (
          <p>
            Client portal notice:{' '}
            <span className="font-semibold">{delivery.portalNotice ? 'Sent' : 'Not sent'}</span>
          </p>
        ) : null}
        {byEmail && sent ? (
          <>
            <p data-testid="send-accepted">
              Accepted by the mail service
              {delivery.acceptedAt ? ` at ${acceptedTime(delivery.acceptedAt)}` : ''}
              {delivery.providerRef ? `. Mail service reference: ${delivery.providerRef}` : ''}
            </p>
            <p data-testid="send-delivered">
              Delivered: not confirmed yet. The mail service has not reported delivery, so this is
              not proof the email reached the inbox.
            </p>
          </>
        ) : null}
        {delivery.reason ? <p>{delivery.reason}</p> : null}
        <p>
          {sent
            ? byEmail
              ? `${form.form.name} now shows in Intake Forms as Not Started. Accepted means the mail service took the email; it does not prove it reached the inbox. If ${form.recipient.name} can't find it, ask them to check their spam folder, or use Resend.`
              : `${form.form.name} now shows in Intake Forms as Not Started.`
            : `The form was saved and shows in Intake Forms; open it to resend.`}
        </p>
      </Note>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium">
        <Link href={`/intake-forms/${form.id}`} className="text-link underline">
          View sent form
        </Link>
        {!sent && form.recipient.kind === 'CLIENT' ? (
          <Link href={`/clients/${form.recipient.id}`} className="text-link underline">
            Open {form.recipient.name}
          </Link>
        ) : null}
        <Link href="/intake-forms" className="text-link underline">
          Back to Intake Forms
        </Link>
      </div>
      <Button variant="secondary" onClick={onAnother}>
        Send another form
      </Button>
    </div>
  );
}

/** Step 5: the live summary, Ready to Send, Send me a copy, Send Form and Save as Draft. */
export function ReviewPanel({
  choices,
  formName,
  missing,
  myEmail,
  onSendMeCopy,
  onEditSchedule,
  onSend,
  onDraft,
  sending,
  drafting,
  notice,
  result,
  onAnother,
}: {
  choices: SendChoices;
  formName: string | undefined;
  /** What is left to do before sending, in words ("choose a form"). */
  missing: string[];
  myEmail: string;
  onSendMeCopy: (on: boolean) => void;
  onEditSchedule: () => void;
  onSend: () => void;
  onDraft: () => void;
  sending: boolean;
  drafting: boolean;
  notice: SendNotice | undefined;
  result: SendIntakeFormResult | undefined;
  onAnother: () => void;
}) {
  const summaryId = useId();
  const timeZone = useFirmTimeZone();
  const c = choices;
  const ready = missing.length === 0;
  return (
    <Panel
      step={5}
      title="Review & Send"
      subtitle="Review the details before sending."
      testId="send-review"
      grow
    >
      <section aria-labelledby={summaryId} className="rounded-lg bg-table-head px-4 pt-4 pb-2">
        <h3 id={summaryId} className="pb-3 text-lg font-bold text-heading">
          Form Summary
        </h3>
        <dl data-testid="send-summary">
          <Row label="Form Name">{formName ?? 'Not selected'}</Row>
          <Row label="Recipient">{c.recipient?.name ?? 'Not selected'}</Row>
          <Row label="Delivery Method">{deliverySummary(c.recipient, c.channel)}</Row>
          <Row label="Due Date">{c.dueOn ? formatDay(c.dueOn) : 'Not set'}</Row>
          <Row label="Expiration">{expirySummary(c.expiry, timeZone)}</Row>
          <Row label="Assigned To">{c.assignee?.name ?? 'Not assigned'}</Row>
          <Row label="Reminders">
            {c.reminders ? (
              <>
                Enabled{' '}
                <button
                  type="button"
                  aria-label="View reminder schedule"
                  onClick={onEditSchedule}
                  className="font-normal text-link underline"
                >
                  (View)
                </button>
                <ReminderSkips formId={c.formId} expiry={c.expiry} />
              </>
            ) : (
              'Off'
            )}
          </Row>
          <Row label="Client Can Save">{c.allowSave ? 'Yes' : 'No'}</Row>
        </dl>
      </section>
      {result ? (
        <SentResult result={result} onAnother={onAnother} />
      ) : (
        <>
          {ready ? (
            <Note tone="success" icon={ROUTE_ICONS[c.channel]} title="Ready to Send">
              <p>{routeLine(c.recipient, c.channel)}</p>
            </Note>
          ) : (
            <Note tone="plain" icon={Info} title="Not Ready Yet">
              <p>To send, {missing.join(', ')}.</p>
            </Note>
          )}
          {c.channel === 'EMAIL' ? (
            <div className="flex flex-col">
              <Checkbox
                label="Send me a copy of the email"
                checked={c.sendMeCopy}
                onChange={(event) => onSendMeCopy(event.target.checked)}
              />
              {c.sendMeCopy && myEmail ? (
                <p className="pl-8 text-xs text-muted">The copy goes to {myEmail}.</p>
              ) : null}
            </div>
          ) : null}
          {notice ? (
            <p
              role={notice.tone === 'error' ? 'alert' : 'status'}
              className={`text-sm ${notice.tone === 'error' ? 'text-danger' : 'text-success'}`}
            >
              {notice.text}
              {notice.link ? (
                <>
                  {' '}
                  <Link href={notice.link.href} className="font-medium text-link underline">
                    {notice.link.label}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          <div className="flex flex-col gap-3">
            <Button className="h-14 w-full" onClick={onSend} disabled={sending}>
              <PaperPlaneTilt aria-hidden weight="fill" className="size-6" />
              <span className="text-lg font-semibold">{sending ? 'Sending…' : 'Send Form'}</span>
            </Button>
            <Button
              variant="outline"
              className="h-14 w-full"
              onClick={onDraft}
              disabled={drafting || sending}
            >
              <FloppyDisk aria-hidden weight="fill" className="size-6 text-heading" />
              <span className="text-lg font-semibold text-heading">
                {drafting ? 'Saving…' : 'Save as Draft'}
              </span>
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

/** Review Two 10c: a reminder this send would skip says so before sending. */
function ReminderSkips({ formId, expiry }: { formId: string; expiry: Expiry }) {
  const preview = useReminderPlan({ formId, expiry });
  const lines = preview ? reminderSkips(preview.plan) : [];
  if (lines.length === 0) return null;
  return (
    <span data-testid="reminder-skips" className="mt-1 block text-xs font-normal text-warning">
      {lines.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
    </span>
  );
}

/** EXPIRY-01: the summary's Expiration, with its exact time and zone when one is chosen. */
function expirySummary(e: Expiry, timeZone: string | undefined): string {
  if (e.mode === 'DEFAULT') return 'The form’s default';
  if (e.mode === 'NONE') return 'Never expires';
  if (!e.date || !timeZone) return 'Not set';
  return expiryText(toInstant(e.date, e.time || '23:59', timeZone), timeZone);
}
