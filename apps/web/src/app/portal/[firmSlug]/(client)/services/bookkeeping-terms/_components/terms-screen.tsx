'use client';

import { MY_BOOKKEEPING_TERMS_STATE_LABELS, type MyBookkeepingTerms } from '@firmivra/types';
import { Badge, Button, Card, Modal, Textarea } from '@firmivra/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import {
  ADD_ON_FREQUENCY,
  ANSWER_ERRORS,
  BILLING,
  FREQUENCY,
  RENEWAL,
  STATE_TONE,
  TIMING,
  dayText,
  money,
  paymentTermsText,
} from './terms-parts';

/**
 * Client Portal BK-CP3: one version of the bookkeeping terms, in the portal version the firm sent
 * (never its internal notes). The main account holder accepts a version waiting for an answer
 * (it comes into force) or declines it (it goes back to the firm); the firm is told either way.
 */
export function TermsScreen() {
  const { firmSlug, termsId } = useParams<{ firmSlug: string; termsId: string }>();
  const terms = useApiQuery(['my-bookkeeping-terms', firmSlug, 'version', termsId], () =>
    api.myBookkeepingTerms(firmSlug).get(termsId),
  );
  const [declined, setDeclined] = useState<number | null>(null);
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link
        href={`/${firmSlug}/services/bookkeeping-terms`}
        className="text-sm font-medium text-link hover:underline"
      >
        ← All Engagement Terms
      </Link>
      {declined !== null ? (
        <Card>
          <p role="status" data-testid="terms-notice" className="text-sm text-text">
            You declined version {declined}. The firm has been told and will follow up with you.
          </p>
          <Link
            href={`/${firmSlug}/services`}
            className="mt-3 inline-block text-sm font-semibold text-link hover:underline"
          >
            Back to My Services
          </Link>
        </Card>
      ) : (
        <PageState query={terms}>
          {(t) => <TermsView terms={t} slug={firmSlug} onDeclined={() => setDeclined(t.version)} />}
        </PageState>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm font-medium text-heading">{children}</dd>
    </>
  );
}

function Lines({ label, items, testId }: { label: string; items: string[]; testId: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-heading">{label}</h3>
      {items.length ? (
        <ul className="mt-1 list-disc pl-5 text-sm text-text" data-testid={testId}>
          {items.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">None listed.</p>
      )}
    </div>
  );
}

function TermsView({
  terms: t,
  slug,
  onDeclined,
}: {
  terms: MyBookkeepingTerms;
  slug: string;
  onDeclined: () => void;
}) {
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [notice, setNotice] = useState('');
  const waiting = t.state === 'AWAITING_ANSWER';
  return (
    <>
      <header className="flex flex-wrap items-start gap-3" data-testid="terms-header">
        <div className="min-w-0 flex-1">
          <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
            {t.serviceTitle}: version {t.version}
          </h1>
          <p className="text-sm text-muted">
            {t.sentAt ? `Sent ${dayText(t.sentAt)} · ` : ''}In force from {dayText(t.effectiveFrom)}
          </p>
        </div>
        <Badge tone={STATE_TONE[t.state]}>{MY_BOOKKEEPING_TERMS_STATE_LABELS[t.state]}</Badge>
      </header>
      {notice ? (
        <p
          role="status"
          data-testid="terms-notice"
          className="rounded-card bg-success-soft px-4 py-3 text-sm text-text"
        >
          {notice}
        </p>
      ) : null}

      <Card title="Your answer">
        {waiting ? (
          <div className="flex flex-col gap-3" data-testid="terms-answer">
            <p className="text-sm text-text">
              Read these terms, then accept them or decline them. Your firm is told either way.
            </p>
            {t.signature === 'WAITING' ? (
              <p className="text-sm text-text" data-testid="terms-signature">
                The agreement for these terms is waiting for your signature.{' '}
                <Link
                  href={`/${slug}/signatures`}
                  className="font-semibold text-link hover:underline"
                >
                  Sign it under Signatures
                </Link>
                , then accept.
              </p>
            ) : null}
            {t.can.accept || t.can.decline ? (
              <div className="flex flex-wrap gap-2">
                {t.can.accept ? (
                  <Button onClick={() => setAccepting(true)}>Accept Terms</Button>
                ) : null}
                {t.can.decline ? (
                  <Button variant="secondary" onClick={() => setDeclining(true)}>
                    Decline
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted">
                Only the main account holder can answer these terms.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-text" data-testid="terms-answer">
            {t.state === 'IN_FORCE'
              ? t.acceptedAt
                ? `You accepted these terms on ${dayText(t.acceptedAt)}. They are in force.`
                : 'These terms are in force.'
              : t.state === 'REPLACED'
                ? `A newer version replaced these terms${t.supersededAt ? ` on ${dayText(t.supersededAt)}` : ''}.`
                : `These terms ended${t.terminatedAt ? ` on ${dayText(t.terminatedAt)}` : ''}.`}
          </p>
        )}
      </Card>

      <Card title="Your package">
        <dl
          className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2"
          data-testid="terms-package"
        >
          <Row label="Package">{t.packageName ?? 'Not named'}</Row>
          <Row label="Start date">{dayText(t.startDate)}</Row>
          <Row label="End date">{t.endDate ? dayText(t.endDate) : 'Open-ended'}</Row>
          <Row label="Renewal">
            {RENEWAL[t.renewalType]}
            {t.renewalDate ? `, next on ${dayText(t.renewalDate)}` : ''}
          </Row>
          {t.noticeDays !== null ? <Row label="Notice period">{`${t.noticeDays} days`}</Row> : null}
        </dl>
      </Card>

      <Card title="Fees and billing">
        <dl
          className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2"
          data-testid="terms-fees"
        >
          <Row label="Monthly fee">{money(t.monthlyFeeCents)}</Row>
          <Row label="Setup fee">{money(t.setupFeeCents)}</Row>
          <Row label="Billing">{`${FREQUENCY[t.billingFrequency]}, ${TIMING[t.billingTiming]}`}</Row>
          <Row label="Payment terms">{paymentTermsText(t)}</Row>
          {t.preferredPaymentMethod ? (
            <Row label="Payment method">{t.preferredPaymentMethod}</Row>
          ) : null}
          <Row label="Autopay">{t.autopay ? 'On' : 'Off'}</Row>
          {t.lateFeeRule ? (
            <Row label="Late fee">
              {`${money(t.lateFeeRule.amountCents)} after ${t.lateFeeRule.afterDays} days past due`}
            </Row>
          ) : null}
        </dl>
        {t.additionalBilling.length ? (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-heading">Additional services</h3>
            <ul className="mt-1 text-sm text-text" data-testid="terms-additional">
              {t.additionalBilling.map((a) => (
                <li key={a.service}>
                  {a.service}: {BILLING[a.billing]}
                  {typeof a.feeCents === 'number' ? `, ${money(a.feeCents)}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {t.discounts.length ? (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-heading">Discounts and credits</h3>
            <ul className="mt-1 text-sm text-text" data-testid="terms-discounts">
              {t.discounts.map((d) => (
                <li key={d.label}>
                  {d.label}: {d.kind === 'PERCENT' ? `${d.value}%` : money(d.value)}
                  {d.startsOn ? ` from ${dayText(d.startsOn)}` : ''}
                  {d.endsOn ? ` until ${dayText(d.endsOn)}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card title="What's included">
        <div className="flex flex-col gap-4">
          <Lines label="Included" items={t.includedServices} testId="terms-included" />
          <Lines label="Not included" items={t.excludedServices} testId="terms-excluded" />
          {t.addOns.length ? (
            <Lines
              label="Add-ons"
              testId="terms-add-ons"
              items={t.addOns.map(
                (a) =>
                  `${a.name}${typeof a.feeCents === 'number' ? `: ${money(a.feeCents)}` : ''}${a.frequency ? ` ${ADD_ON_FREQUENCY[a.frequency]}` : ''}`,
              )}
            />
          ) : null}
          {t.deliverables.length ? (
            <Lines
              label="Deliverables"
              testId="terms-deliverables"
              items={t.deliverables.map((d) =>
                d.frequency ? `${d.label} (${d.frequency})` : d.label,
              )}
            />
          ) : null}
        </div>
      </Card>

      <Card title="Responsibilities">
        <div className="flex flex-col gap-4">
          <Lines label="Yours" items={t.clientResponsibilities} testId="terms-client-duties" />
          <Lines label="Your firm's" items={t.firmResponsibilities} testId="terms-firm-duties" />
        </div>
      </Card>

      {accepting ? (
        <AcceptDialog
          terms={t}
          slug={slug}
          onClose={() => setAccepting(false)}
          onDone={() => {
            setAccepting(false);
            setNotice(`You accepted version ${t.version}. The firm has been told.`);
          }}
        />
      ) : null}
      {declining ? (
        <DeclineDialog
          terms={t}
          slug={slug}
          onClose={() => setDeclining(false)}
          onDone={() => {
            setDeclining(false);
            onDeclined();
          }}
        />
      ) : null}
    </>
  );
}

function AcceptDialog({
  terms: t,
  slug,
  onClose,
  onDone,
}: {
  terms: MyBookkeepingTerms;
  slug: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const accept = useApiMutation(
    () => api.myBookkeepingTerms(slug).accept(t.id, { sentAt: t.sentAt ?? '' }),
    // The version and the list (the service card's link too).
    { invalidate: ['my-bookkeeping-terms', slug] },
  );
  return (
    <Modal
      open
      title="Accept Terms"
      subtitle={`${t.serviceTitle}, version ${t.version}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={accept.isPending}
            onClick={() => accept.mutate(undefined, { onSuccess: onDone })}
          >
            {accept.isPending ? 'Accepting…' : 'Accept'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text">
        You accept version {t.version} exactly as the firm sent it. These terms come into force from{' '}
        {dayText(t.effectiveFrom)} and replace any terms before them.
      </p>
      {accept.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(accept.error, ANSWER_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}

function DeclineDialog({
  terms: t,
  slug,
  onClose,
  onDone,
}: {
  terms: MyBookkeepingTerms;
  slug: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  // The version leaves the portal: only the list is refreshed (this page shows the outcome).
  const decline = useApiMutation(
    () =>
      api
        .myBookkeepingTerms(slug)
        .decline(t.id, { sentAt: t.sentAt ?? '', reason: reason.trim() || undefined }),
    { invalidate: ['my-bookkeeping-terms', slug, 'list'] },
  );
  return (
    <Modal
      open
      title="Decline Terms"
      subtitle={`${t.serviceTitle}, version ${t.version}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={decline.isPending}
            onClick={() => decline.mutate(undefined, { onSuccess: onDone })}
          >
            {decline.isPending ? 'Declining…' : 'Decline'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-text">
        These terms go back to your firm, who will follow up with you. Your current terms stay as
        they are.
      </p>
      <Textarea
        label="Reason (optional)"
        hint="Tell the firm what you would like changed."
        rows={4}
        maxLength={800}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {decline.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(decline.error, ANSWER_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}
