'use client';

import {
  Button,
  Card,
  IconTile,
  Modal,
  PageHeader,
  Tabs,
  Textarea,
  Toast,
  type KpiTone,
} from '@firmivra/ui';
import {
  ArrowLeft,
  CaretLeft,
  CaretRight,
  ShieldCheck,
  ShieldWarning,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import {
  adminAuditSecurity,
  type AuditEventDetail,
  type AvailableAction,
  type ResponseAction,
  type Severity,
} from '../../../../../../../mocks/admin-audit-security';
import {
  AlertBadge,
  Breadcrumbs,
  CATEGORY_LABELS,
  formatShortStamp,
  LinkButton,
  Loaded,
  OutcomeBadge,
  SeverityBadge,
} from '../../../_components/audit-parts';
import { QuickInfo, RecommendedActions, RiskIndicators } from './event-rail';
import {
  ActionsTakenTab,
  AffectedDataTab,
  CopyButton,
  OverviewTab,
  RelatedTab,
  TimelineTab,
} from './event-sections';

/**
 * Audit / Security Event Detail (S02; firmivra-security-event-details.jpg and
 * firmivra-audit-security-event-dashboard.jpg; docx §3, Page B): one event's whole record, its
 * related events and the response actions. The event itself never changes: an action works on
 * the user, session or integration and writes its own linked audit event.
 */

type DetailTab = 'overview' | 'affected' | 'timeline' | 'related' | 'actions';
const TAB_IDS: readonly DetailTab[] = ['overview', 'affected', 'timeline', 'related', 'actions'];

const TILE_TONES: Record<Severity, KpiTone> = {
  INFO: 'blue',
  LOW: 'green',
  MEDIUM: 'amber',
  HIGH: 'red',
  CRITICAL: 'red',
};

/** What each response action does, shown before it runs (high-impact actions confirm first). */
const CONSEQUENCES: Record<ResponseAction, string> = {
  RESET_PASSWORD: 'The user must choose a new password at their next sign-in.',
  UNLOCK_ACCOUNT: 'The user can sign in again right away.',
  FORCE_LOGOUT: 'Every active session of this user ends now, on all devices.',
  MARK_REVIEWED: 'The event is marked as reviewed, and an open alert on it is resolved.',
  SEND_ALERT: 'Super Admins get a security alert about this event, in the app and by email.',
  SUSPEND_USER:
    'The user is suspended and signed out everywhere until someone reactivates the account.',
  RESET_MFA: 'The user must set up multi-factor authentication again at their next sign-in.',
  DISABLE_INTEGRATION:
    'The integration stops working for the firm until someone turns it on again.',
};

function Neighbor({
  id,
  label,
  next,
}: {
  id: string | null | undefined;
  label: string;
  next?: boolean;
}) {
  const content = (
    <>
      {next ? null : <CaretLeft aria-hidden weight="bold" className="size-4" />}
      {label}
      {next ? <CaretRight aria-hidden weight="bold" className="size-4" /> : null}
    </>
  );
  return id ? (
    <LinkButton href={`/audit-security/events/${id}`}>{content}</LinkButton>
  ) : (
    <Button variant="secondary" disabled>
      {content}
    </Button>
  );
}

function Summary({ query }: { query: UseQueryResult<AuditEventDetail> }) {
  return (
    <Card data-testid="event-summary" className="p-5!">
      <Loaded query={query} rows={3}>
        {({ event }) => (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <IconTile
                icon={
                  event.severity === 'INFO' || event.severity === 'LOW'
                    ? ShieldCheck
                    : ShieldWarning
                }
                tone={TILE_TONES[event.severity]}
              />
              <div className="min-w-0">
                <h2 data-testid="event-title" className="text-2xl font-bold text-heading">
                  {event.title}
                </h2>
                <p className="text-sm text-text">{event.summary}</p>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text">
                  Event ID: <span data-testid="event-reference">{event.reference}</span>
                  <CopyButton value={event.reference} label="Copy event ID" />
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-start gap-1.5 text-sm text-text sm:items-end sm:text-right">
              <SeverityBadge severity={event.severity} suffix="Severity" />
              <time dateTime={event.at}>{formatShortStamp(event.at, true)}</time>
              <span>
                {CATEGORY_LABELS[event.category]} · {event.firm.name}
              </span>
              <span className="flex flex-wrap gap-2 sm:justify-end">
                <OutcomeBadge outcome={event.outcome} />
                {event.alertState ? <AlertBadge state={event.alertState} /> : null}
              </span>
            </div>
          </div>
        )}
      </Loaded>
    </Card>
  );
}

export function EventDetail({ eventId }: { eventId: string }) {
  const detail = useApiQuery(['admin-audit-security', 'event', eventId], () =>
    adminAuditSecurity.event(eventId),
  );
  const [tab, setTab] = useState<DetailTab>('overview');
  const [confirming, setConfirming] = useState<AvailableAction | null>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const respond = useApiMutation(
    (input: { action: ResponseAction; reason: string }) =>
      adminAuditSecurity.respond({ eventId, ...input }),
    { invalidate: ['admin-audit-security'] },
  );

  function ask(action: AvailableAction) {
    respond.reset();
    setReason('');
    setNotice(null);
    setConfirming(action);
  }

  function confirm() {
    if (!confirming) return;
    const { action, label } = confirming;
    respond.mutate(
      { action, reason },
      {
        onSuccess: () => {
          setConfirming(null);
          setNotice(`${label}: done. A new audit event linked to this one was recorded.`);
        },
      },
    );
  }

  const data = detail.data;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title="Event Details"
        subtitle="View complete information about this security event."
        above={
          <Breadcrumbs
            items={[
              { label: 'Audit & Security', href: '/audit-security' },
              { label: 'Audit Logs', href: '/audit-security' },
              { label: 'Event Details' },
            ]}
          />
        }
        actions={
          <>
            <LinkButton href="/audit-security">
              <ArrowLeft aria-hidden weight="bold" className="size-4" />
              Back to Audit Logs
            </LinkButton>
            <Neighbor id={data?.previousId} label="Previous Event" />
            <Neighbor id={data?.nextId} label="Next Event" next />
          </>
        }
      />

      {notice ? <Toast message={notice} onDismiss={() => setNotice(null)} /> : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-5 xl:items-start">
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-3">
          <Summary query={detail} />
          <Tabs
            label="Event sections"
            variant="underline"
            value={tab}
            onChange={(id) => setTab(TAB_IDS.find((item) => item === id) ?? 'overview')}
            items={[
              { id: 'overview', label: 'Overview', content: <OverviewTab query={detail} /> },
              {
                id: 'affected',
                label: 'Affected Data',
                content: <AffectedDataTab query={detail} />,
              },
              { id: 'timeline', label: 'Timeline', content: <TimelineTab query={detail} /> },
              {
                id: 'related',
                label: 'Related Events',
                content: <RelatedTab query={detail} />,
              },
              {
                id: 'actions',
                label: 'Actions Taken',
                content: <ActionsTakenTab query={detail} eventId={eventId} />,
              },
            ]}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-2">
          <RiskIndicators query={detail} />
          <RecommendedActions query={detail} onAction={ask} />
          <QuickInfo query={detail} onRelated={() => setTab('related')} />
        </div>
      </div>

      <Modal
        open={confirming !== null}
        title={confirming?.label ?? 'Confirm'}
        subtitle={data ? `${data.event.reference} · ${data.event.title}` : undefined}
        onClose={() => setConfirming(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={respond.isPending}>
              {respond.isPending ? 'Working…' : (confirming?.label ?? 'Confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-sm text-text">
          <p>{confirming ? CONSEQUENCES[confirming.action] : null}</p>
          <p className="text-muted">
            This is recorded in the audit log as a new event linked to this one. The original event
            does not change.
          </p>
          <Textarea
            label="Reason (optional)"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(change) => setReason(change.target.value)}
          />
          {respond.isError ? (
            <p role="alert" className="text-danger">
              {errorMessage(respond.error)}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
