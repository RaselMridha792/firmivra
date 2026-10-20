'use client';

import type { TaxReturnDetail } from '@firmivra/types';
import { ActionMenu, Avatar, Badge, Toast } from '@firmivra/ui';
import {
  ArrowLeft,
  ChatCircleDots,
  CheckCircle,
  CheckSquare,
  ClockCounterClockwise,
  FileText,
  ListChecks,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../lib/query';
import {
  DetailsDialog,
  StatusDialog,
  isBackward,
  useAct,
  type Notice,
} from '../../../_components/return-actions';
import {
  ApprovalsPanel,
  EfilePanel,
  NextSteps,
  Panel,
  SignaturesPanel,
  SummaryPanel,
  ValidationPanel,
  textButton,
} from '../../../_components/review-panels';
import {
  BLOCKER_LABEL,
  FILING_STATUS_LABEL,
  STATUS_LABEL,
  TR_ERRORS,
  TR_KEY,
  card,
  dateTimeText,
  dayText,
  outlined,
  primary,
  quiet,
  returnKind,
} from '../../../_components/tr-shared';
import {
  NotesPanel,
  ReturnDocumentsPanel,
  WorkflowStepper,
  workflowSteps,
} from '../../../_components/work-panels';

const TAB_LINKS = [
  ['Overview', ''],
  ['Intake & Documents', 'documents'],
  ['Preparation', 'preparation'],
  ['Review', 'review'],
  ['E-Signatures', 'signatures'],
  ['E-File', 'efile'],
  ['Payments & Refunds', 'payments'],
  ['Notes', 'notes'],
  ['Activity', 'activity'],
] as const;

/**
 * /tax-returns/{id}/review (Frame 3, Review, E-File & Filing Status): the workflow, return
 * details, federal and state amounts, validation, approvals, documents, e-file status, client
 * signatures and next steps. Mark as Ready to File waits for every prerequisite.
 */
export function ReviewScreen({ returnId }: { returnId: string }) {
  const q = useApiQuery([...TR_KEY, 'detail', returnId], () =>
    api.taxReturnWorkspace.get(returnId),
  );
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const notice: Notice = (text, tone) => setMessage({ text, tone });
  const r = q.data;
  if (q.isError || !r) {
    return (
      <div className="flex flex-col gap-4" data-testid="review-screen">
        <nav aria-label="Breadcrumb" className="text-sm">
          <Link href="/tax-returns" className="text-link hover:underline">
            Tax Returns
          </Link>
        </nav>
        {q.isError ? (
          <p role="alert" className={quiet}>
            This return is not available. {errorMessage(q.error, TR_ERRORS)}
          </p>
        ) : (
          <div className={`${card} h-32 animate-pulse`} aria-label="Loading" />
        )}
        <div>
          <Link href="/tax-returns" className={outlined}>
            <ArrowLeft aria-hidden weight="bold" className="size-5" /> Back to Returns
          </Link>
        </div>
      </div>
    );
  }
  const kind = returnKind(r);
  const title = `${r.taxYear} ${kind.group.replace(/s$/, '')} Return`;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="review-screen">
      <nav aria-label="Breadcrumb" className="text-sm">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/tax-returns" className="text-link hover:underline">
              Tax Returns
            </Link>
          </li>
          <li aria-hidden>›</li>
          <li>
            <Link href={`/clients/${r.client.id}`} className="text-link hover:underline">
              {r.client.name}
            </Link>
          </li>
          <li aria-hidden>›</li>
          <li>
            <Link href={`/tax-returns/${r.id}`} className="text-link hover:underline">
              {title}
            </Link>
          </li>
          <li aria-hidden>›</li>
          <li aria-current="page" className="text-heading">
            Review &amp; E-File
          </li>
        </ol>
      </nav>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <ReviewHeader detail={r} title={title} />
      <nav aria-label="Return sections" className="overflow-x-auto border-b border-divider">
        <ul className="flex min-w-max justify-between gap-6">
          {TAB_LINKS.map(([label, tab]) => (
            <li key={label}>
              <Link
                href={`/tax-returns/${r.id}${tab ? `?tab=${tab}` : ''}`}
                aria-current={tab === 'review' ? 'page' : undefined}
                className={`-mb-px inline-flex min-h-10 items-center border-b-2 py-2 text-base font-medium ${tab === 'review' ? 'border-action text-action' : 'border-transparent text-action/80 hover:text-heading'}`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Return Workflow" testId="review-workflow">
            <WorkflowStepper status={r.workflowStatus} frame={3} numbered />
          </Panel>
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <ReturnDetails detail={r} onNotice={notice} />
              <SummaryPanel detail={r} onNotice={notice} />
              <NotesPanel detail={r} onNotice={notice} limit={1} />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <ValidationPanel detail={r} onNotice={notice} compact />
              <ApprovalsPanel detail={r} onNotice={notice} />
              <ReturnDocumentsPanel detail={r} onNotice={notice} limit={3} />
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <EfilePanel detail={r} onNotice={notice} />
          <SignaturesPanel detail={r} onNotice={notice} />
          <NextSteps detail={r} />
        </div>
      </div>
      <ReviewActions detail={r} onNotice={notice} />
    </div>
  );
}

function ReviewHeader({ detail, title }: { detail: TaxReturnDetail; title: string }) {
  const docs = useApiQuery([...TR_KEY, 'documents', detail.id], () =>
    api.taxReturnWorkspace.documents(detail.id),
  );
  const extension = (docs.data ?? []).find((d) => d.kind === 'EXTENSION');
  const steps = workflowSteps(detail.workflowStatus, 3);
  const at = steps.findIndex((s) => s.state !== 'complete');
  const step = at === -1 ? steps.length : at + 1;
  const box =
    'flex min-w-36 flex-col gap-1 rounded-xl border border-divider bg-surface px-3 py-2 text-sm';
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <Avatar name={detail.client.name} size="xl" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
              {detail.client.name}
            </h1>
            <Badge tone="success" icon={CheckCircle}>
              Active Client
            </Badge>
          </div>
          <p className="flex flex-wrap gap-x-3 text-sm text-action">
            <span>
              {detail.client.accountType === 'BUSINESS' ? 'EIN' : 'SSN'}:{' '}
              {detail.client.maskedId ?? 'not on file'}
            </span>
            <span aria-hidden className="text-muted">
              |
            </span>
            <span>
              {title}
              {detail.formType ? ` (${detail.formType})` : ''}
            </span>
          </p>
        </div>
      </div>
      <ul className="flex flex-wrap gap-3" aria-label="Return summary">
        <li className={box}>
          <span className="font-medium text-heading">Filing Status</span>
          <span className="text-lg text-heading">
            {detail.filingStatus
              ? FILING_STATUS_LABEL[detail.filingStatus]
              : detail.filingType === 'BUSINESS'
                ? 'Business'
                : 'Not set'}
          </span>
        </li>
        <li className={box}>
          <span className="font-medium text-heading">Filing Deadline</span>
          <span className="text-lg text-heading">
            {detail.dueOn ? dayText(detail.dueOn) : 'Not set'}
          </span>
        </li>
        <li className={box}>
          <span className="font-medium text-heading">Extension</span>
          <span className="text-muted">{extension ? 'Form on file' : 'Not Filed'}</span>
          <Link href={`/tax-returns/${detail.id}?tab=documents`} className={textButton}>
            {extension ? 'View Form' : 'File Extension'}
          </Link>
        </li>
        <li className={box}>
          <span className="font-medium text-heading">Return Progress</span>
          <span className="text-text">Step {Math.min(step, 6)} of 6</span>
          <Badge
            tone={detail.workflowStatus === 'REJECTED' ? 'danger' : 'success'}
            icon={CheckCircle}
          >
            {STATUS_LABEL[detail.workflowStatus]}
          </Badge>
        </li>
      </ul>
    </header>
  );
}

/** Return Details: year, type, filing status, federal and state e-file, people, stage, updated. */
function ReturnDetails({ detail, onNotice }: { detail: TaxReturnDetail; onNotice: Notice }) {
  const [edit, setEdit] = useState(false);
  const filings = useApiQuery([...TR_KEY, 'filings', detail.id], () =>
    api.taxReturnWorkspace.filings(detail.id),
  );
  const federal = filings.data?.find((f) => f.jurisdiction === 'US');
  const states = (filings.data ?? []).filter((f) => f.jurisdiction !== 'US');
  const fs = (s: string | undefined): string =>
    s
      ? ((
          {
            NOT_FILED: 'Not Transmitted',
            TRANSMITTED: 'Transmitted',
            ACCEPTED: 'Accepted',
            REJECTED: 'Rejected',
            PAPER_FILED: 'Paper Filed',
          } as Record<string, string>
        )[s] ?? '—')
      : '—';
  const rows: [string, string][] = [
    ['Tax Year', String(detail.taxYear)],
    [
      'Return Type',
      `${returnKind(detail).group.replace(/s$/, '')}${detail.formType ? ` (${detail.formType})` : ''}`,
    ],
    ['Filing Status', detail.filingStatus ? FILING_STATUS_LABEL[detail.filingStatus] : '—'],
    ['Federal E-File', fs(federal?.status)],
    [
      'State Return',
      states.length ? states.map((s) => `${s.jurisdiction} (${fs(s.status)})`).join(', ') : 'None',
    ],
    ['Assigned Preparer', detail.preparer?.name ?? 'Unassigned'],
    ['Assigned Reviewer', detail.reviewer?.name ?? 'Unassigned'],
    ['Current Stage', STATUS_LABEL[detail.workflowStatus]],
    ['Last Updated', dateTimeText(detail.updatedAt)],
  ];
  return (
    <Panel
      title="Return Details"
      icon={FileText}
      testId="return-details"
      action={
        <button type="button" className={textButton} onClick={() => setEdit(true)}>
          Edit
        </button>
      }
    >
      <dl className="grid grid-cols-[9rem_1fr] gap-x-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="border-b border-divider py-1.5 text-heading">{k}</dt>
            <dd className="border-b border-divider py-1.5 text-text">{v}</dd>
          </div>
        ))}
      </dl>
      {edit ? (
        <DetailsDialog row={detail} onClose={() => setEdit(false)} onNotice={onNotice} />
      ) : null}
    </Panel>
  );
}

/** Back to Return, Client Portal, Send Message, Create Task, More Actions, Mark as Ready to File. */
function ReviewActions({ detail, onNotice }: { detail: TaxReturnDetail; onNotice: Notice }) {
  const act = useAct(onNotice);
  const router = useRouter();
  const [back, setBack] = useState(false);
  const canFile = detail.canMoveTo.includes('READY_TO_FILE');
  const blocked = detail.blockers.filter(
    (b) => b !== 'NO_FILING_TRANSMITTED' && b !== 'FILINGS_NOT_ACCEPTED',
  );
  const ready = canFile && blocked.length === 0;
  const button =
    'inline-flex min-h-11 items-center gap-2 rounded-control border border-action bg-surface px-4 font-medium text-action hover:bg-accent-soft';
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4"
      data-testid="review-actions"
    >
      <Link href={`/tax-returns/${detail.id}`} className={button}>
        <ArrowLeft aria-hidden weight="bold" className="size-5" /> Back to Return
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/clients/${detail.client.id}/documents`} className={button}>
          <UsersThree aria-hidden weight="fill" className="size-5" /> Client Portal
        </Link>
        <Link href={`/clients/${detail.client.id}/messages`} className={button}>
          <ChatCircleDots aria-hidden weight="fill" className="size-5" /> Send Message
        </Link>
        <Link href="/tasks/new" className={button}>
          <CheckSquare aria-hidden weight="fill" className="size-5" /> Create Task
        </Link>
        <ActionMenu
          label="More Actions"
          className="[&>button]:min-h-11 [&>button]:px-4"
          trigger={
            <span className="inline-flex items-center gap-2 font-medium text-action">
              More Actions
            </span>
          }
          align="right"
          sections={[
            {
              items: [
                {
                  label: 'Open Review Checklist',
                  icon: ListChecks,
                  onSelect: () => router.push(`/tax-returns/${detail.id}?tab=review`),
                },
                {
                  label: 'Activity / Audit History',
                  icon: ClockCounterClockwise,
                  onSelect: () => router.push(`/tax-returns/${detail.id}?tab=activity`),
                },
                ...detail.canMoveTo
                  .filter((s) => s !== 'READY_TO_FILE')
                  .map((s) => ({
                    label: `Move to ${STATUS_LABEL[s]}`,
                    onSelect: () =>
                      isBackward(detail.workflowStatus, s)
                        ? setBack(true)
                        : void act(
                            () =>
                              api.taxReturnWorkspace.changeStatus(detail.id, { workflowStatus: s }),
                            `Moved to ${STATUS_LABEL[s]}.`,
                          ),
                  })),
              ],
            },
          ]}
        />
        <button
          type="button"
          className={primary}
          disabled={!ready}
          title={
            !ready
              ? blocked.length
                ? blocked.map((b) => BLOCKER_LABEL[b]).join('\n')
                : 'Not available from this stage'
              : undefined
          }
          onClick={() =>
            void act(
              () =>
                api.taxReturnWorkspace.changeStatus(detail.id, { workflowStatus: 'READY_TO_FILE' }),
              'Marked as Ready to File.',
            )
          }
        >
          <CheckCircle aria-hidden weight="bold" className="size-5" /> Mark as Ready to File
        </button>
      </div>
      {back ? (
        <StatusDialog row={detail} onClose={() => setBack(false)} onNotice={onNotice} />
      ) : null}
    </div>
  );
}
