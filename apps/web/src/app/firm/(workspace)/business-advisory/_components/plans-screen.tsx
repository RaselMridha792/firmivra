'use client';

import type { AdvisoryPlanRow } from '@firmivra/types';
import {
  ActionMenu,
  Badge,
  Button,
  Checkbox,
  Modal,
  Select,
  Table,
  Textarea,
  type ActionMenuItem,
  type Column,
} from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  CheckCircle,
  ClockCounterClockwise,
  DotsThreeVertical,
  PaperPlaneTilt,
  PencilSimple,
  Play,
  Plus,
  SealCheck,
  UserCheck,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { ErrorLine, useMembers } from './ba-dialogs';
import { FilterSelect, SearchBox, serverPaging, useAct } from './ba-list-kit';
import { BaShell } from './ba-shell';
import { PlanSnapshot } from './plan-snapshot';
import {
  BASE,
  BA_KEY,
  PLAN_STATUS,
  PLAN_TYPES,
  PlanStatusPill,
  card,
  dayText,
  primary,
  errorText,
} from './ba-shared';

const SIZE = 10;
const YEAR = new Date().getFullYear();
const CHANNEL: Record<string, string> = {
  PORTAL: 'Client portal',
  EMAIL: 'Email',
  DOWNLOAD: 'Download',
};

/** /business-advisory/plans: every business plan, with its lifecycle actions. */
export function BusinessPlans() {
  const router = useRouter();
  const { ask, toast, say } = useAct();
  const members = useMembers();
  const overview = useApiQuery([...BA_KEY, 'overview'], () => api.advisory.overview());
  const canSend = overview.data?.canSend ?? false;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [year, setYear] = useState('');
  const [type, setType] = useState('');
  const [advisor, setAdvisor] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{
    kind: 'versions' | 'send' | 'approval';
    plan: AdvisoryPlanRow;
  }>();
  const term = useDeferredValue(search.trim());
  const q = useApiQuery(
    [...BA_KEY, 'plans', term, status, year, type, advisor, archived, page],
    () =>
      api.advisory.plans({
        ...(term ? { search: term } : {}),
        ...(status ? { status: status as never } : {}),
        ...(year ? { targetYear: Number(year) } : {}),
        ...(type ? { planType: type } : {}),
        ...(advisor ? { advisorUserId: advisor } : {}),
        ...(archived ? { includeArchived: true } : {}),
        page,
        pageSize: SIZE,
      }),
  );
  const filter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };

  /** Status changes and finalizing send the plan's current etag. */
  // A-X05: every status change, finalizing, archive and restore is confirmed first.
  const move = (
    p: AdvisoryPlanRow,
    to: 'DRAFT' | 'IN_REVIEW' | 'IN_PROGRESS' | 'COMPLETED',
    done: string,
  ) =>
    ask(
      {
        title: 'Change the plan’s status?',
        message: `${p.name} moves from ${PLAN_STATUS[p.status] ?? p.status} to ${PLAN_STATUS[to] ?? to}.`,
        confirm: 'Change Status',
      },
      async () => {
        const d = await api.advisory.plan(p.id);
        return api.advisory.setPlanStatus(p.id, { status: to, etag: d.etag });
      },
      done,
    );
  const finalize = (p: AdvisoryPlanRow) =>
    ask(
      {
        title: 'Finalize this plan?',
        message: `${p.name} is saved as a new version that never changes; later edits make another one.`,
        confirm: 'Finalize Plan',
      },
      async () => {
        const d = await api.advisory.plan(p.id);
        return api.advisory.finalizePlan(p.id, { etag: d.etag });
      },
      `${p.name} finalized.`,
    );

  const actions = (p: AdvisoryPlanRow): ActionMenuItem[] => {
    const item = (label: string, icon: ActionMenuItem['icon'], onSelect: () => void) => ({
      label,
      icon,
      onSelect,
    });
    if (p.status === 'ARCHIVED')
      return [
        item('Restore', ArrowCounterClockwise, () =>
          ask(
            {
              title: 'Restore this plan?',
              message: `${p.name} comes back to the plans list, as it was archived.`,
              confirm: 'Restore',
            },
            () => api.advisory.restorePlan(p.id),
            `${p.name} restored.`,
          ),
        ),
      ];
    // Octavia's B9: a finalized or sent plan is locked; Modify Plan starts its next draft
    // revision, and every finalized version stays as it was. B10: a plan waiting for the client's
    // approval is locked too; Modify Plan withdraws the request, and the revision needs approving
    // again.
    const awaiting = p.status === 'AWAITING_CLIENT_APPROVAL';
    const locked = p.status === 'FINALIZED' || p.status === 'SENT' || awaiting;
    const list: ActionMenuItem[] = [
      locked
        ? item('Modify Plan', PencilSimple, () =>
            ask(
              {
                title: 'Modify this plan?',
                message: awaiting
                  ? `${p.name} goes back to a draft revision and the client's approval request is withdrawn. A revision needs their approval again.`
                  : `${p.name} becomes a new draft revision; version ${p.currentVersion} stays as it was.${p.clientApproval ? " The client's approval is cleared: a revision needs approving again." : ''}`,
                confirm: 'Modify Plan',
              },
              async () => {
                const d = await api.advisory.plan(p.id);
                await api.advisory.setPlanStatus(p.id, { status: 'DRAFT', etag: d.etag });
                router.push(`${BASE}/plans/${p.id}/edit`);
              },
              `${p.name} is a new draft revision; version ${p.currentVersion} stays as it was.`,
            ),
          )
        : item('Edit Plan', PencilSimple, () => router.push(`${BASE}/plans/${p.id}/edit`)),
    ];
    if (p.status === 'DRAFT')
      list.push(
        item('Submit for Review', CheckCircle, () =>
          move(p, 'IN_REVIEW', 'Plan submitted for review.'),
        ),
      );
    if (p.status === 'IN_REVIEW')
      list.push(
        item('Back to Draft', ArrowCounterClockwise, () => move(p, 'DRAFT', 'Plan back to draft.')),
      );
    // B10: staff review, then the client's approval before finalization.
    if (canSend && p.status === 'IN_REVIEW')
      list.push(
        item('Send for Client Approval', UserCheck, () => setDialog({ kind: 'approval', plan: p })),
      );
    if (p.status === 'DRAFT' || p.status === 'IN_REVIEW')
      list.push(item('Finalize Plan', SealCheck, () => finalize(p)));
    if (canSend && p.currentVersion > 0 && !awaiting)
      list.push(item('Send to Client', PaperPlaneTilt, () => setDialog({ kind: 'send', plan: p })));
    if (p.status === 'FINALIZED' || p.status === 'SENT')
      list.push(
        item('Start Implementation', Play, () => move(p, 'IN_PROGRESS', 'Plan in progress.')),
      );
    if (p.status === 'IN_PROGRESS')
      list.push(item('Mark Completed', CheckCircle, () => move(p, 'COMPLETED', 'Plan completed.')));
    if (p.status === 'COMPLETED')
      list.push(
        item('Reopen', ArrowCounterClockwise, () => move(p, 'IN_PROGRESS', 'Plan reopened.')),
      );
    return list;
  };

  const cols: Column<AdvisoryPlanRow>[] = [
    {
      id: 'name',
      label: 'Plan',
      cell: (r) => (
        <Link
          href={`${BASE}/plans/${r.id}/edit`}
          data-testid="plan-link"
          className="font-semibold text-link hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    {
      id: 'client',
      label: 'Client',
      cell: (r) => (
        <Link href={`${BASE}/clients/${r.advisoryClientId}`} className="hover:underline">
          {r.client.name}
        </Link>
      ),
    },
    { id: 'type', label: 'Type', cell: (r) => r.planType ?? '—' },
    { id: 'year', label: 'Year', cell: (r) => r.targetYear },
    { id: 'advisor', label: 'Advisor', cell: (r) => r.advisor?.name ?? '—' },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (r) => <PlanStatusPill status={r.status} />,
    },
    {
      id: 'version',
      label: 'Version',
      cell: (r) =>
        r.currentVersion ? (
          <button
            type="button"
            className="text-link hover:underline"
            onClick={() => setDialog({ kind: 'versions', plan: r })}
          >
            v{r.currentVersion}
          </button>
        ) : (
          <span className="text-muted">Not finalized</span>
        ),
    },
    {
      id: 'updated',
      label: 'Last Updated',
      className: 'whitespace-nowrap',
      cell: (r) => dayText(r.updatedAt),
    },
  ];

  return (
    <BaShell>
      {toast}
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Business plans"
        data-testid="ba-plans"
      >
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox value={search} onChange={filter(setSearch)} label="Search plans" />
          <FilterSelect
            label="Status"
            all="All Statuses"
            value={status}
            onChange={filter(setStatus)}
            options={Object.entries(PLAN_STATUS)
              .filter(([v]) => v !== 'ARCHIVED')
              .map(([value, label]) => ({ value, label }))}
          />
          <FilterSelect
            label="Target year"
            all="All Years"
            value={year}
            onChange={filter(setYear)}
            options={[YEAR - 1, YEAR, YEAR + 1, YEAR + 2].map((y) => ({
              value: String(y),
              label: String(y),
            }))}
            width="w-32"
          />
          <FilterSelect
            label="Plan type"
            all="All Types"
            value={type}
            onChange={filter(setType)}
            options={PLAN_TYPES.map((t) => ({ value: t, label: t }))}
          />
          {members.length ? (
            <FilterSelect
              label="Advisor"
              all="All Advisors"
              value={advisor}
              onChange={filter(setAdvisor)}
              options={members}
            />
          ) : null}
          <Checkbox
            label="Show archived"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setPage(1);
            }}
          />
          <Link
            href={`${BASE}/plans/new`}
            aria-disabled={overview.data ? !overview.data.canCreatePlan : false}
            className={`${primary} ml-auto ${overview.data && !overview.data.canCreatePlan ? 'pointer-events-none opacity-50' : ''}`}
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Create Business Plan
          </Link>
        </div>
        <Table
          rows={q.data?.items ?? []}
          columns={cols}
          rowKey={(r) => r.id}
          caption="Business plans"
          dense
          noun="plans"
          pageSize={SIZE}
          loading={q.isPending}
          emptyTitle={q.isError ? 'Business plans are not available' : 'No business plans'}
          emptyText={
            q.isError
              ? 'We could not load them. Try again in a moment.'
              : term || status || year || type || advisor
                ? 'Try another search or filter.'
                : 'Create a business plan for an advisory client.'
          }
          rowActions={(r) => (
            <ActionMenu
              label={`Actions for ${r.name}`}
              trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
              sections={[
                { items: actions(r) },
                {
                  items: [
                    {
                      label: 'Version History',
                      icon: ClockCounterClockwise,
                      onSelect: () => setDialog({ kind: 'versions', plan: r }),
                    },
                    ...(r.status === 'ARCHIVED'
                      ? []
                      : [
                          {
                            label: 'Archive',
                            icon: Archive,
                            danger: true,
                            onSelect: () =>
                              ask(
                                {
                                  title: 'Archive this plan?',
                                  message: `${r.name} leaves the plans list; it is kept and can be restored.`,
                                  confirm: 'Archive',
                                  danger: true,
                                },
                                () => api.advisory.archivePlan(r.id),
                                `${r.name} archived.`,
                              ),
                          },
                        ]),
                  ],
                },
              ]}
            />
          )}
          server={serverPaging(q.data, SIZE, page, setPage)}
        />
      </section>
      {dialog?.kind === 'versions' ? (
        <VersionsDialog plan={dialog.plan} onClose={() => setDialog(undefined)} />
      ) : null}
      {dialog?.kind === 'send' ? (
        <SendPlanDialog
          plan={dialog.plan}
          onClose={() => setDialog(undefined)}
          onSent={(channel) => {
            setDialog(undefined);
            say(`${dialog.plan.name} sent (${CHANNEL[channel]?.toLowerCase()}).`);
          }}
        />
      ) : null}
      {dialog?.kind === 'approval' ? (
        <RequestApprovalDialog
          plan={dialog.plan}
          onClose={() => setDialog(undefined)}
          onSent={() => {
            setDialog(undefined);
            say(`${dialog.plan.name} sent to ${dialog.plan.client.name} for approval.`);
          }}
        />
      ) : null}
    </BaShell>
  );
}

/** A plan's finalized versions: each one's source-data date and how it was delivered. */
export function VersionsDialog({ plan, onClose }: { plan: AdvisoryPlanRow; onClose: () => void }) {
  const q = useApiQuery([...BA_KEY, 'versions', plan.id], () => api.advisory.versions(plan.id));
  // Octavia's B9: each version opens as it was finalized.
  const [open, setOpen] = useState<number>();
  const snap = useApiQuery([...BA_KEY, 'version', plan.id, open ?? 0], async () =>
    open ? api.advisory.version(plan.id, open) : null,
  );
  return (
    <Modal
      open
      title="Version History"
      subtitle={`${plan.name}: finalized versions are kept as they were delivered.`}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div data-testid="plan-versions">
        {q.isError ? (
          <p className="text-sm text-muted">The versions could not be loaded.</p>
        ) : q.data && q.data.length === 0 ? (
          <p className="text-sm text-muted">No finalized versions yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-divider">
            {(q.data ?? []).map((v) => (
              <li key={v.versionNo} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="font-semibold text-heading">Version {v.versionNo}</span>
                <span className="text-muted">
                  Finalized {dayText(v.createdAt)}
                  {v.createdBy ? ` by ${v.createdBy.name}` : ''}
                </span>
                <span className="text-muted">
                  Figures as of {v.sourceDataAsOf ? dayText(v.sourceDataAsOf) : '—'}
                </span>
                <Button
                  variant="secondary"
                  onClick={() => setOpen(open === v.versionNo ? undefined : v.versionNo)}
                  aria-expanded={open === v.versionNo}
                  data-testid="view-snapshot"
                >
                  {open === v.versionNo ? 'Hide Snapshot' : 'View Snapshot'}
                </Button>
                {v.deliveredAt ? (
                  <Badge tone="purple">
                    Sent {dayText(v.deliveredAt)} ·{' '}
                    {CHANNEL[(v.deliveredChannel ?? '').toUpperCase()] ?? v.deliveredChannel}
                  </Badge>
                ) : (
                  <Badge tone="neutral">Not sent</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
        {open ? (
          <section
            className="mt-3 flex flex-col gap-2 rounded-lg bg-canvas p-3 text-sm"
            data-testid="plan-snapshot"
            aria-label={`Version ${open} snapshot`}
          >
            {snap.isPending ? (
              <p className="text-muted">Loading the snapshot…</p>
            ) : snap.data ? (
              <>
                <h3 className="font-semibold text-heading">
                  Version {open}: {snap.data.planName} · {snap.data.targetYear}
                </h3>
                <p className="text-xs text-muted">
                  This snapshot is read only: the whole plan as it was finalized
                  {snap.data.createdBy ? ` by ${snap.data.createdBy.name}` : ''} on{' '}
                  {dayText(snap.data.createdAt)}. A change to the plan makes a new version.
                </p>
                {/* Advisory Review 2 A-07: the whole historical plan, not a summary. */}
                <PlanSnapshot version={snap.data} />
              </>
            ) : (
              <p className="text-muted">This version could not be loaded.</p>
            )}
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * B10 (Business Advisory review §16): staff review, then the client's approval BEFORE
 * finalization. Sends a plan in review to the client's portal for approval: the version they read
 * is kept, the plan waits (locked) and their Approve finalizes it. Refused (and said why) when the
 * plan isn't ready or the client has no portal login.
 */
export function RequestApprovalDialog({
  plan,
  onClose,
  onSent,
}: {
  plan: AdvisoryPlanRow;
  onClose: () => void;
  onSent: () => void;
}) {
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      open
      title="Send for Client Approval"
      subtitle={`${plan.name} for ${plan.client.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            data-testid="send-for-approval"
            onClick={async () => {
              setSaving(true);
              setError(undefined);
              try {
                const d = await api.advisory.plan(plan.id);
                await api.advisory.requestPlanApproval(plan.id, {
                  etag: d.etag,
                  ...(message.trim() ? { message: message.trim() } : {}),
                });
                await qc.invalidateQueries({ queryKey: [...BA_KEY] });
                onSent();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            Send for Approval
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="request-approval">
        <ErrorLine text={error} />
        <p className="text-sm text-text">
          The client reads this version in their portal (My Services, Business Advisory) and
          approves it there. Their approval finalizes the plan. Until then the plan is locked;
          Modify Plan withdraws the request, and a revision needs their approval again.
        </p>
        <Textarea
          label="Message to the client (optional)"
          rows={3}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
    </Modal>
  );
}

/** Send the latest (or a chosen) finalized version to the client. */
export function SendPlanDialog({
  plan,
  onClose,
  onSent,
}: {
  plan: AdvisoryPlanRow;
  onClose: () => void;
  onSent: (channel: string) => void;
}) {
  const [channel, setChannel] = useState('PORTAL');
  const [version, setVersion] = useState(String(plan.currentVersion));
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      open
      title="Send Plan to Client"
      subtitle={`${plan.name} for ${plan.client.name}. Only a finalized version is sent.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError(undefined);
              try {
                await api.advisory.sendPlan(plan.id, {
                  channel: channel as never,
                  version: Number(version),
                  ...(message.trim() ? { message: message.trim() } : {}),
                });
                onSent(channel);
              } catch (e) {
                setError(errorText(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            Send
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="send-plan">
        <ErrorLine text={error} />
        <Select
          label="Send by"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          options={Object.entries(CHANNEL).map(([value, label]) => ({ value, label }))}
        />
        <Select
          label="Version"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          options={Array.from(
            { length: plan.currentVersion },
            (_, i) => plan.currentVersion - i,
          ).map((n) => ({
            value: String(n),
            label: `Version ${n}${n === plan.currentVersion ? ' (latest)' : ''}`,
          }))}
        />
        <Textarea
          label="Message to the client (optional)"
          rows={3}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
    </Modal>
  );
}
