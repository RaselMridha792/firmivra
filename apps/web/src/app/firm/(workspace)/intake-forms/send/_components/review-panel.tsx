'use client';

import {
  ChatText,
  CheckCircle,
  EnvelopeSimple,
  FloppyDisk,
  Info,
  PaperPlaneTilt,
  TreeStructure,
  WarningCircle,
} from '@phosphor-icons/react';
import type { SendIntakeFormResult } from '@firmivra/types';
import { Button, Callout, Checkbox } from '@firmivra/ui';
import Link from 'next/link';
import { type ReactNode, useId } from 'react';
import { Panel } from './panel';
import {
  CHANNEL_LABELS,
  deliverySummary,
  formatDay,
  routeLine,
  type SendChoices,
} from './send-model';

const ROUTE_ICONS = { EMAIL: EnvelopeSimple, SMS: ChatText, PORTAL: TreeStructure };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-t border-border py-2.5 text-sm">
      <dt className="w-32 shrink-0 text-text">{label}</dt>
      <dd className="min-w-0 flex-1 wrap-break-word font-medium text-heading">{children}</dd>
    </div>
  );
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
  return (
    <div className="flex flex-col gap-3" data-testid="send-result">
      <Callout
        surface={sent ? 'success' : 'warning'}
        tone={sent ? 'green' : 'amber'}
        icon={sent ? CheckCircle : WarningCircle}
        title={sent ? 'Form Sent' : 'Delivery Failed'}
      >
        <p>
          {CHANNEL_LABELS[delivery.channel]} to {delivery.to}:{' '}
          <span className="font-semibold">{sent ? 'Sent' : 'Failed'}</span>
        </p>
        <p>
          {sent
            ? `${form.form.name} now shows in Intake Forms as Not Started.`
            : 'The form was saved but not delivered. Open it to resend.'}
        </p>
      </Callout>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium">
        <Link href={`/intake-forms/${form.id}`} className="text-link underline">
          View sent form
        </Link>
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
  notice: { text: string; tone: 'success' | 'error' } | undefined;
  result: SendIntakeFormResult | undefined;
  onAnother: () => void;
}) {
  const summaryId = useId();
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
          <Row label="Expiration Date">{c.expiresOn ? formatDay(c.expiresOn) : 'Not set'}</Row>
          <Row label="Assigned To">{c.assignee?.name ?? 'Not assigned'}</Row>
          <Row label="Reminders">
            {c.reminders ? (
              <>
                Enabled{' '}
                <button
                  type="button"
                  aria-label="Edit reminder schedule"
                  onClick={onEditSchedule}
                  className="font-normal text-link underline"
                >
                  (Edit)
                </button>
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
            <Callout
              surface="success"
              tone="green"
              icon={ROUTE_ICONS[c.channel]}
              title="Ready to Send"
            >
              {routeLine(c.recipient, c.channel)}
            </Callout>
          ) : (
            <Callout surface="plain" tone="grey" icon={Info} title="Not Ready Yet">
              To send, {missing.join(', ')}.
            </Callout>
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
