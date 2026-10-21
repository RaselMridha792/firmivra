'use client';

import type { TaxReturnDetail, TaxReturnWorkflowStatus } from '@firmivra/types';
import { ActionMenu, Avatar, Badge, Tabs, Toast } from '@firmivra/ui';
import {
  ArrowLeft,
  CalendarBlank,
  CalendarPlus,
  ChatCircleDots,
  CheckCircle,
  ClockCounterClockwise,
  FileArrowUp,
  IdentificationBadge,
  ListChecks,
  UserCircle,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import {
  AssignDialog,
  DetailsDialog,
  StatusDialog,
  isBackward,
  useAct,
  type Notice,
} from '../../_components/return-actions';
import {
  ApprovalsPanel,
  EfilePanel,
  Panel,
  SignaturesPanel,
  SummaryPanel,
  ValidationPanel,
  textButton,
} from '../../_components/review-panels';
import {
  BLOCKER_LABEL,
  FILING_STATUS_LABEL,
  STATUS_LABEL,
  TR_KEY,
  card,
  dayText,
  money,
  outlined,
  primary,
  quiet,
  returnTitle,
  shortName,
} from '../../_components/tr-shared';
import { UnavailableReturn } from '../../_components/unavailable';
import {
  ActivityPanel,
  ChecklistPanel,
  DocumentChecklist,
  NotesPanel,
  ReturnDocumentsPanel,
  UpcomingTasks,
  WorkflowStepper,
} from '../../_components/work-panels';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'documents', label: 'Intake & Documents' },
  { id: 'preparation', label: 'Preparation' },
  { id: 'review', label: 'Review' },
  { id: 'signatures', label: 'E-Signatures' },
  { id: 'efile', label: 'E-File' },
  { id: 'payments', label: 'Payments & Refunds' },
  { id: 'notes', label: 'Notes' },
  { id: 'activity', label: 'Activity' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** The workflow's next step from here: the primary button of the action bar. */
const NEXT: Partial<
  Record<TaxReturnWorkflowStatus, { to: TaxReturnWorkflowStatus; label: string }>
> = {
  WAITING_ON_CLIENT: { to: 'IN_PREPARATION', label: 'Resume Preparation' },
  IN_PREPARATION: { to: 'READY_FOR_REVIEW', label: 'Mark as Ready for Review' },
  READY_FOR_REVIEW: { to: 'READY_FOR_SIGNATURE', label: 'Mark Ready for Signature' },
  READY_FOR_SIGNATURE: { to: 'READY_TO_FILE', label: 'Mark as Ready to File' },
  ACCEPTED: { to: 'CLOSED', label: 'Close Return' },
};
const daysUntil = (day: string) =>
  Math.round((Date.parse(`${day}T12:00:00Z`) - Date.now()) / 86_400_000);

/**
 * /tax-returns/{id} (Frame 2, Client Tax Return Workspace): the client and return header, the
 * deadline, extension, people, filing status and prior-year cards, nine tabs, and the action bar.
 */
export function ReturnWorkspace({ returnId }: { returnId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (
    TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview'
  ) as TabId;
  const q = useApiQuery([...TR_KEY, 'detail', returnId], () =>
    api.taxReturnWorkspace.get(returnId),
  );
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const notice: Notice = (text, tone) => setMessage({ text, tone });
  const r = q.data;
  const setTab = (id: string) =>
    router.replace(`/tax-returns/${returnId}${id === 'overview' ? '' : `?tab=${id}`}`, {
      scroll: false,
    });

  if (q.isError) {
    return (
      <div className="flex flex-col gap-4" data-testid="return-workspace">
        <Crumbs />
        <UnavailableReturn error={q.error} frame={2} onRetry={() => void q.refetch()} />
        <BackLink />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="return-workspace">
      <Crumbs detail={r} />
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {r ? (
        <Header detail={r} onNotice={notice} />
      ) : (
        <div className={`${card} h-32 animate-pulse`} aria-label="Loading" />
      )}
      {r ? <InfoCards detail={r} onNotice={notice} /> : null}
      {r ? (
        <div className="min-w-0 [&_[role=tablist]]:justify-between [&_[role=tab]]:text-base">
          <Tabs
            label="Return sections"
            variant="underline"
            value={tab}
            onChange={setTab}
            items={TABS.map((t) => ({
              id: t.id,
              label: t.label,
              ...(t.id === tab
                ? { content: <TabBody tab={tab} detail={r} onNotice={notice} /> }
                : {}),
            }))}
          />
        </div>
      ) : null}
      {r ? <ActionBar detail={r} onNotice={notice} /> : <BackLink />}
    </div>
  );
}

function Crumbs({ detail }: { detail?: TaxReturnDetail }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-2 text-heading">
        <li>
          <Link href="/tax-returns" className="text-link hover:underline">
            Tax Returns
          </Link>
        </li>
        {detail ? (
          <>
            <li aria-hidden>›</li>
            <li>
              <Link href={`/clients/${detail.client.id}`} className="text-link hover:underline">
                {detail.client.name}
              </Link>
            </li>
            <li aria-hidden>›</li>
            <li aria-current="page">
              {detail.taxYear} {returnTitle(detail)}
            </li>
          </>
        ) : null}
      </ol>
    </nav>
  );
}

const BackLink = () => (
  <div>
    <Link href="/tax-returns" className={outlined}>
      <ArrowLeft aria-hidden weight="bold" className="size-5" /> Back to Returns
    </Link>
  </div>
);

/** The client, masked ID and contact; the year, return and status boxes on the right. */
function Header({ detail, onNotice }: { detail: TaxReturnDetail; onNotice: Notice }) {
  const router = useRouter();
  const act = useAct(onNotice);
  const client = useApiQuery([...TR_KEY, 'client', detail.client.id], () =>
    api.clients.get(detail.client.id),
  );
  const siblings = useApiQuery([...TR_KEY, 'siblings', detail.client.id], () =>
    api.taxReturns.listForClient(detail.client.id),
  );
  const [statusTo, setStatusTo] = useState<TaxReturnWorkflowStatus>();
  const years = [...new Set((siblings.data ?? []).map((s) => s.taxYear))].sort((a, b) => b - a);
  const sameYear = (siblings.data ?? []).filter((s) => s.taxYear === detail.taxYear);
  const archived = !!client.data?.archivedAt;
  const box = 'flex min-w-36 flex-col gap-1 rounded-xl border border-divider bg-surface px-3 py-2';
  const select =
    'min-h-10 rounded-control border border-divider bg-surface px-2 text-base text-heading';
  const change = (to: TaxReturnWorkflowStatus) => {
    if (isBackward(detail.workflowStatus, to)) setStatusTo(to);
    else
      void act(
        () => api.taxReturnWorkspace.changeStatus(detail.id, { workflowStatus: to }),
        `Moved to ${STATUS_LABEL[to]}.`,
      );
  };
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <Avatar name={detail.client.name} size="xl" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
              {detail.client.name}
            </h1>
            <Badge tone={archived ? 'neutral' : 'success'} icon={CheckCircle}>
              {archived ? 'Archived Client' : 'Active Client'}
            </Badge>
          </div>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-action">
            <span>
              {detail.client.accountType === 'BUSINESS' ? 'EIN' : 'SSN'}:{' '}
              {detail.client.maskedId ?? 'not on file'}
            </span>
            <span aria-hidden className="text-muted">
              |
            </span>
            <span>{detail.client.email ?? 'No email'}</span>
            <span aria-hidden className="text-muted">
              |
            </span>
            <span>{detail.client.phone ?? 'No phone'}</span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className={box}>
          <span className="text-sm font-medium text-heading">Tax Year</span>
          <select
            className={select}
            value={detail.taxYear}
            onChange={(e) => {
              const other =
                (siblings.data ?? []).find(
                  (s) => s.taxYear === Number(e.target.value) && !s.quarter,
                ) ?? (siblings.data ?? []).find((s) => s.taxYear === Number(e.target.value));
              if (other) router.push(`/tax-returns/${other.id}`);
            }}
          >
            {(years.length ? years : [detail.taxYear]).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className={box}>
          <span className="text-sm font-medium text-heading">Return Type</span>
          <select
            className={select}
            value={detail.id}
            onChange={(e) => router.push(`/tax-returns/${e.target.value}`)}
          >
            {(sameYear.length ? sameYear : [detail]).map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === detail.id
                  ? `${returnTitle(detail)} (${detail.formType ?? '—'})`
                  : `${s.formType ?? 'Return'}${s.quarter ? ` Q${s.quarter}` : ''}`}
              </option>
            ))}
          </select>
        </label>
        <label className={`${box} min-w-48`}>
          <span className="text-sm font-medium text-heading">Status</span>
          <select
            className={`${select} bg-warning-soft font-medium text-warning`}
            value={detail.workflowStatus}
            onChange={(e) => change(e.target.value as TaxReturnWorkflowStatus)}
            disabled={!detail.canMoveTo.length}
          >
            {[detail.workflowStatus, ...detail.canMoveTo].map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {statusTo ? (
        <StatusDialog
          row={{ ...detail, client: detail.client }}
          onClose={() => setStatusTo(undefined)}
          onNotice={onNotice}
        />
      ) : null}
    </header>
  );
}

function InfoCard({
  icon: Glyph,
  title,
  children,
}: {
  icon: typeof CalendarBlank;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className={`${card} flex min-w-0 items-start gap-2.5 p-3`}>
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-action"
      >
        <Glyph weight="fill" className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className="font-medium text-heading">{title}</span>
        {children}
      </span>
    </li>
  );
}

/** Filing deadline, extension, preparer, reviewer, filing status and the prior year's return. */
function InfoCards({ detail, onNotice }: { detail: TaxReturnDetail; onNotice: Notice }) {
  const [dialog, setDialog] = useState<'assign' | 'details'>();
  const docs = useApiQuery([...TR_KEY, 'documents', detail.id], () =>
    api.taxReturnWorkspace.documents(detail.id),
  );
  const siblings = useApiQuery([...TR_KEY, 'siblings', detail.client.id], () =>
    api.taxReturns.listForClient(detail.client.id),
  );
  const prior = (siblings.data ?? []).find((s) => s.taxYear === detail.taxYear - 1 && !s.quarter);
  const extension = (docs.data ?? []).find((d) => d.kind === 'EXTENSION');
  const left = detail.dueOn ? daysUntil(detail.dueOn) : null;
  const person = (m: TaxReturnDetail['preparer']) =>
    m ? (
      <span className="flex items-center gap-2">
        <Avatar name={m.name} size="sm" />
        <span className="text-heading" title={m.name}>
          {shortName(m)}
        </span>
      </span>
    ) : (
      <button type="button" className={textButton} onClick={() => setDialog('assign')}>
        Assign
      </button>
    );
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6" data-testid="info-cards">
      <InfoCard icon={CalendarBlank} title="Filing Deadline">
        {detail.dueOn ? (
          <>
            <span className="text-base font-bold whitespace-nowrap text-heading">
              {dayText(detail.dueOn)}
            </span>
            <span className="whitespace-nowrap">
              <Badge tone={left! < 0 ? 'danger' : left! <= 14 ? 'warning' : 'success'}>
                {left! < 0 ? `${-left!} days overdue` : `${left} days remaining`}
              </Badge>
            </span>
          </>
        ) : (
          <button type="button" className={textButton} onClick={() => setDialog('details')}>
            Set due date
          </button>
        )}
      </InfoCard>
      <InfoCard icon={FileArrowUp} title="Extension">
        <span className="text-muted">{extension ? 'Form on file' : 'Not Filed'}</span>
        <Link href={`/tax-returns/${detail.id}?tab=documents`} className={textButton}>
          {extension ? 'View Form' : 'File Extension'}
        </Link>
      </InfoCard>
      <InfoCard icon={UsersThree} title="Assigned Preparer">
        {person(detail.preparer)}
      </InfoCard>
      <InfoCard icon={IdentificationBadge} title="Assigned Reviewer">
        {person(detail.reviewer)}
      </InfoCard>
      <InfoCard icon={UserCircle} title="Filing Status">
        <span className="text-lg font-bold text-heading">
          {detail.filingStatus
            ? FILING_STATUS_LABEL[detail.filingStatus]
            : detail.filingType === 'BUSINESS'
              ? 'Business'
              : 'Not set'}
        </span>
        {detail.filingType === 'INDIVIDUAL' && !detail.quarter ? (
          <button
            type="button"
            className={`${textButton} text-left`}
            onClick={() => setDialog('details')}
          >
            Update
          </button>
        ) : null}
      </InfoCard>
      <InfoCard icon={ClockCounterClockwise} title="Prior Year">
        {prior ? (
          <>
            <span className="flex flex-wrap items-center gap-x-2">
              <span className="text-lg font-bold text-heading">{prior.taxYear}</span>
              <Badge
                tone={prior.status === 'IN_PROGRESS' ? 'warning' : 'success'}
                icon={CheckCircle}
              >
                {prior.status === 'IN_PROGRESS'
                  ? 'In Progress'
                  : prior.status === 'REJECTED'
                    ? 'Rejected'
                    : 'Filed'}
              </Badge>
            </span>
            <Link href={`/tax-returns/${prior.id}`} className={textButton}>
              View Return
            </Link>
          </>
        ) : (
          <span className="text-muted">
            {siblings.isPending ? 'Loading…' : `No ${detail.taxYear - 1} return`}
          </span>
        )}
      </InfoCard>
      {dialog === 'assign' ? (
        <AssignDialog row={detail} onClose={() => setDialog(undefined)} onNotice={onNotice} />
      ) : null}
      {dialog === 'details' ? (
        <DetailsDialog row={detail} onClose={() => setDialog(undefined)} onNotice={onNotice} />
      ) : null}
    </ul>
  );
}

function TabBody({
  tab,
  detail,
  onNotice,
}: {
  tab: TabId;
  detail: TaxReturnDetail;
  onNotice: Notice;
}) {
  const two = 'grid min-w-0 gap-4 xl:grid-cols-2';
  switch (tab) {
    case 'overview':
      return <Overview detail={detail} onNotice={onNotice} />;
    case 'documents':
      return (
        <div className={two}>
          <DocumentChecklist detail={detail} />
          <ReturnDocumentsPanel detail={detail} onNotice={onNotice} />
        </div>
      );
    case 'preparation':
      return (
        <div className={two}>
          <ChecklistPanel
            detail={detail}
            section="PREPARATION"
            title="Preparation Checklist"
            onNotice={onNotice}
          />
          <div className="flex flex-col gap-4">
            <ReturnDocumentsPanel detail={detail} onNotice={onNotice} kinds={['DRAFT_RETURN']} />
            <NotesPanel detail={detail} onNotice={onNotice} limit={3} />
          </div>
        </div>
      );
    case 'review':
      return (
        <div className="flex flex-col gap-4">
          <div className={two}>
            <ChecklistPanel
              detail={detail}
              section="REVIEW"
              title="Reviewer Checklist"
              onNotice={onNotice}
            />
            <ApprovalsPanel detail={detail} onNotice={onNotice} />
          </div>
          <ValidationPanel detail={detail} onNotice={onNotice} />
          <div>
            <Link href={`/tax-returns/${detail.id}/review`} className={outlined}>
              Open Review, E-File &amp; Filing Status
            </Link>
          </div>
        </div>
      );
    case 'signatures':
      return (
        <div className={two}>
          <SignaturesPanel detail={detail} onNotice={onNotice} />
          <ReturnDocumentsPanel detail={detail} onNotice={onNotice} kinds={['SIGNATURE_FORM']} />
        </div>
      );
    case 'efile':
      return (
        <div className={two}>
          <EfilePanel detail={detail} onNotice={onNotice} />
          <ReturnDocumentsPanel
            detail={detail}
            onNotice={onNotice}
            kinds={['FILED_RETURN', 'ACKNOWLEDGMENT']}
          />
        </div>
      );
    case 'payments':
      return (
        <div className={two}>
          <div className="flex flex-col gap-4">
            <SummaryPanel detail={detail} onNotice={onNotice} />
            {detail.estimate ? <EstimatePanel detail={detail} onNotice={onNotice} /> : null}
          </div>
          <div className="flex flex-col gap-4">
            <ReturnDocumentsPanel
              detail={detail}
              onNotice={onNotice}
              kinds={['VOUCHER', 'PAYMENT_PROOF', 'EXTENSION']}
            />
            <p className={quiet}>
              A filing extension does not extend the payment due date. Refund timing comes only from
              the IRS or the state; it is never promised here.
            </p>
          </div>
        </div>
      );
    case 'notes':
      return <NotesPanel detail={detail} onNotice={onNotice} />;
    case 'activity':
      return <ActivityPanel detail={detail} />;
  }
}

/** The Overview tab: progress, the client's details, the document checklist, tasks and activity. */
function Overview({ detail, onNotice }: { detail: TaxReturnDetail; onNotice: Notice }) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Panel
          title="Return Progress"
          testId="return-progress"
          action={
            <Link href={`/tax-returns/${detail.id}/review`} className={textButton}>
              View Workflow
            </Link>
          }
        >
          <WorkflowStepper status={detail.workflowStatus} frame={2} />
          {detail.statusReason ? <p className={quiet}>“{detail.statusReason}”</p> : null}
          {detail.blockers.length ? (
            <ul className="flex flex-wrap gap-2 text-xs" aria-label="Before Ready to File">
              {detail.blockers.map((b) => (
                <li key={b} className="rounded bg-warning-soft px-2 py-1 text-text">
                  {BLOCKER_LABEL[b]}
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <ClientDetails detail={detail} onNotice={onNotice} />
          <DocumentChecklist detail={detail} limit={10} />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <UpcomingTasks detail={detail} onNotice={onNotice} />
        <ActivityPanel detail={detail} limit={4} />
      </div>
    </div>
  );
}

/** Client Details: from the client record (Edit opens it), with the newest internal note. */
function ClientDetails({ detail, onNotice }: { detail: TaxReturnDetail; onNotice: Notice }) {
  const q = useApiQuery([...TR_KEY, 'client', detail.client.id], () =>
    api.clients.get(detail.client.id),
  );
  const c = q.data;
  const p = c?.profile;
  const address = p?.address;
  const rows: [string, ReactNode][] = c
    ? [
        [
          'Full Name',
          [p?.firstName, p?.middleName, p?.lastName].filter(Boolean).join(' ') ||
            p?.businessName ||
            c.displayName,
        ],
        ...(c.accountType === 'INDIVIDUAL'
          ? [
              [
                'Date of Birth',
                p?.dateOfBirth
                  ? dayText(p.dateOfBirth)
                  : p?.dateOfBirthUnavailable
                    ? 'Unavailable'
                    : '—',
              ] as [string, ReactNode],
            ]
          : [['Entity Type', p?.entityType ?? '—'] as [string, ReactNode]]),
        ['Email', c.email ?? '—'],
        ['Phone', c.phone ?? '—'],
        [
          'Address',
          address?.line1
            ? `${address.line1}${address.line2 ? `, ${address.line2}` : ''}
${[address.city, address.state].filter(Boolean).join(', ')} ${address.postalCode ?? ''}`.trim()
            : '—',
        ],
      ]
    : [];
  return (
    <Panel
      title="Client Details"
      icon={UserCircle}
      testId="client-details"
      action={
        <Link href={`/clients/${detail.client.id}`} className={textButton}>
          Edit
        </Link>
      }
    >
      {q.isError ? (
        <p role="alert" className={quiet}>
          The client's details are not available right now.
        </p>
      ) : !c ? (
        <p className={quiet}>Loading…</p>
      ) : (
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-heading">{k}</dt>
              <dd className="border-b border-divider pb-2 break-words whitespace-pre-line text-text">
                {v}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <NotesPanelPreview detail={detail} onNotice={onNotice} />
    </Panel>
  );
}

function NotesPanelPreview({ detail }: { detail: TaxReturnDetail; onNotice: Notice }) {
  const query = detail.engagement ? { engagementId: detail.engagement.id } : {};
  const q = useApiQuery([...TR_KEY, 'notes', detail.client.id, query], () =>
    api.clientNotes.list(detail.client.id, query),
  );
  const note = q.data?.[0];
  return (
    <div>
      <h3 className="mb-1 font-semibold text-heading">Notes</h3>
      <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-text">
        {q.isError
          ? 'Notes are not available right now.'
          : note
            ? note.body
            : q.isPending
              ? 'Loading…'
              : 'No internal notes yet.'}
      </p>
    </div>
  );
}

/** The quarterly estimate: amount, status, paid date (Edit Return Details changes them). */
function EstimatePanel({ detail, onNotice }: { detail: TaxReturnDetail; onNotice: Notice }) {
  const [edit, setEdit] = useState(false);
  const e = detail.estimate!;
  return (
    <Panel
      title={`Estimated Payment, Q${detail.quarter}`}
      icon={ListChecks}
      testId="estimate"
      action={
        <button type="button" className={textButton} onClick={() => setEdit(true)}>
          Edit
        </button>
      }
    >
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-heading">Amount</dt>
        <dd>{e.amountCents === null ? 'Not entered' : money(e.amountCents)}</dd>
        <dt className="text-heading">Due</dt>
        <dd>{detail.dueOn ? dayText(detail.dueOn) : '—'}</dd>
        <dt className="text-heading">Status</dt>
        <dd>
          {e.overdue ? (
            <Badge tone="danger">Overdue</Badge>
          ) : (
            (e.status ?? 'NOT_STARTED')
              .replaceAll('_', ' ')
              .toLowerCase()
              .replace(/^./, (x) => x.toUpperCase())
          )}
        </dd>
        <dt className="text-heading">Paid on</dt>
        <dd>{e.paidOn ? dayText(e.paidOn) : '—'}</dd>
      </dl>
      {edit ? (
        <DetailsDialog row={detail} onClose={() => setEdit(false)} onNotice={onNotice} />
      ) : null}
    </Panel>
  );
}

/** Back to Returns, Client Portal, Send Message, Create Appointment and the next workflow step. */
function ActionBar({ detail, onNotice }: { detail: TaxReturnDetail; onNotice: Notice }) {
  const router = useRouter();
  const act = useAct(onNotice);
  const [back, setBack] = useState<TaxReturnWorkflowStatus>();
  const next = NEXT[detail.workflowStatus];
  const goEfile =
    detail.workflowStatus === 'READY_TO_FILE' ||
    detail.workflowStatus === 'TRANSMITTED' ||
    detail.workflowStatus === 'REJECTED';
  const blocked = next?.to === 'READY_TO_FILE' && detail.blockers.length > 0;
  const others = detail.canMoveTo.filter((s) => s !== next?.to);
  const button =
    'inline-flex min-h-11 items-center gap-2 rounded-control border border-action bg-surface px-4 font-medium text-action hover:bg-accent-soft';
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4"
      data-testid="action-bar"
    >
      <Link href="/tax-returns" className={button}>
        <ArrowLeft aria-hidden weight="bold" className="size-5" /> Back to Returns
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/clients/${detail.client.id}/documents`} className={button}>
          <UsersThree aria-hidden weight="fill" className="size-5" /> Client Portal
        </Link>
        <Link href={`/clients/${detail.client.id}/messages`} className={button}>
          <ChatCircleDots aria-hidden weight="fill" className="size-5" /> Send Message
        </Link>
        <Link href="/calendar/new" className={button}>
          <CalendarPlus aria-hidden weight="fill" className="size-5" /> Create Appointment
        </Link>
        <span className="inline-flex">
          {goEfile ? (
            <button
              type="button"
              className={`${primary} rounded-r-none`}
              onClick={() => router.push(`/tax-returns/${detail.id}/review#efile`)}
            >
              <CheckCircle aria-hidden weight="bold" className="size-5" /> Open E-File &amp; Filing
              Status
            </button>
          ) : next ? (
            <button
              type="button"
              className={`${primary} rounded-r-none`}
              disabled={blocked}
              title={blocked ? detail.blockers.map((b) => BLOCKER_LABEL[b]).join('\n') : undefined}
              onClick={() =>
                void act(
                  () => api.taxReturnWorkspace.changeStatus(detail.id, { workflowStatus: next.to }),
                  `Moved to ${STATUS_LABEL[next.to]}.`,
                )
              }
            >
              <CheckCircle aria-hidden weight="bold" className="size-5" /> {next.label}
            </button>
          ) : (
            <button type="button" className={`${primary} rounded-r-none`} disabled>
              <CheckCircle aria-hidden weight="bold" className="size-5" />{' '}
              {STATUS_LABEL[detail.workflowStatus]}
            </button>
          )}
          <ActionMenu
            label="Other status changes"
            className="[&>button]:min-h-11 [&>button]:rounded-l-none [&>button]:border-l-0 [&>button]:bg-gold [&>button]:text-on-action"
            trigger={<span className="sr-only">Other status changes</span>}
            align="right"
            sections={[
              {
                items: others.length
                  ? others.map((s) => ({
                      label: `Move to ${STATUS_LABEL[s]}`,
                      onSelect: () =>
                        isBackward(detail.workflowStatus, s)
                          ? setBack(s)
                          : void act(
                              () =>
                                api.taxReturnWorkspace.changeStatus(detail.id, {
                                  workflowStatus: s,
                                }),
                              `Moved to ${STATUS_LABEL[s]}.`,
                            ),
                    }))
                  : [
                      {
                        label: 'No other moves',
                        onSelect: () => undefined,
                        restricted: 'A closed return does not change status.',
                      },
                    ],
              },
            ]}
          />
        </span>
      </div>
      {back ? (
        <StatusDialog row={detail} onClose={() => setBack(undefined)} onNotice={onNotice} />
      ) : null}
    </div>
  );
}
