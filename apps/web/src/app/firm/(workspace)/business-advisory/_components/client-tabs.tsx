'use client';

import type { AdvisoryPlanRow, AdvisoryVersionRow, InternalNote } from '@firmivra/types';
import {
  Badge,
  Button,
  ChecklistCard,
  Modal,
  Pagination,
  Select,
  Table,
  Textarea,
  Timeline,
  type Column,
  type TimelineItem,
} from '@firmivra/ui';
import {
  Briefcase,
  CheckSquare,
  ClockCounterClockwise,
  CurrencyDollar,
  FileText,
  Lightbulb,
  ListChecks,
  NotePencil,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  SealCheck,
  Target,
  Trash,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { ActionItemsSection } from './action-plans-screen';
import { ErrorLine } from './ba-dialogs';
import { useAct } from './ba-list-kit';
import {
  AREA_LABEL,
  BASE,
  BA_KEY,
  PlanStatusPill,
  SectionHead,
  card,
  dayText,
  errorText,
  noneWhenMissing,
  outlined,
  primary,
  quiet,
} from './ba-shared';
import { ClientShell, useAdvisoryClient } from './client-shell';
import { GoalsList } from './goals-screen';
import { STEPS, stepHref } from './plan-frame';
import { readiness } from './plan-steps';
import { SendPlanDialog } from './plans-screen';

const CHANNEL: Record<string, string> = {
  portal: 'Client portal',
  email: 'Email',
  download: 'Download',
};

// ---------- Business Plan ----------

/** /business-advisory/clients/[clientId]/plan: the current plan and its versions, and every plan of the client. */
export function ClientPlanTab({ advisoryClientId }: { advisoryClientId: string }) {
  const client = useAdvisoryClient(advisoryClientId);
  const c = client.data;
  const currentId = c?.currentPlan?.id;
  const { toast, say } = useAct();
  const [sending, setSending] = useState<AdvisoryPlanRow>();
  const plans = useApiQuery([...BA_KEY, 'client-plans', advisoryClientId], () =>
    api.advisory.plans({ advisoryClientId, includeArchived: true, pageSize: 50 }),
  );
  const plan = useApiQuery([...BA_KEY, 'plan', currentId], () =>
    currentId ? api.advisory.plan(currentId) : Promise.resolve(null),
  );
  const versions = useApiQuery([...BA_KEY, 'versions', currentId], () =>
    currentId ? api.advisory.versions(currentId) : Promise.resolve(null),
  );
  const p = plan.data;
  const checks = p ? readiness(p) : [];
  const failed = client.isError || plans.isError;

  const planCols: Column<AdvisoryPlanRow>[] = [
    {
      id: 'name',
      label: 'Plan',
      cell: (r) => (
        <Link
          href={`${BASE}/plans/${r.id}/edit`}
          className="font-semibold text-link hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    { id: 'year', label: 'Year', cell: (r) => r.targetYear },
    { id: 'type', label: 'Type', cell: (r) => r.planType ?? '—' },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (r) => <PlanStatusPill status={r.status} />,
    },
    {
      id: 'version',
      label: 'Version',
      cell: (r) => (r.currentVersion ? `v${r.currentVersion}` : '—'),
    },
    {
      id: 'updated',
      label: 'Last Updated',
      className: 'whitespace-nowrap',
      cell: (r) => dayText(r.updatedAt),
    },
  ];
  const versionCols: Column<AdvisoryVersionRow>[] = [
    {
      id: 'n',
      label: 'Version',
      className: 'whitespace-nowrap',
      cell: (v) => <span className="font-semibold text-heading">Version {v.versionNo}</span>,
    },
    {
      id: 'made',
      label: 'Finalized',
      cell: (v) => (
        <span className="flex flex-col leading-snug">
          <span>{dayText(v.createdAt)}</span>
          {v.createdBy ? <span className="text-xs text-muted">by {v.createdBy.name}</span> : null}
        </span>
      ),
    },
    {
      id: 'asof',
      label: 'Figures as of',
      className: 'whitespace-nowrap',
      cell: (v) => dayText(v.sourceDataAsOf),
    },
    {
      id: 'sent',
      label: 'Delivered',
      cell: (v) =>
        v.deliveredAt ? (
          <span className="flex flex-col leading-snug">
            <span>{dayText(v.deliveredAt)}</span>
            <span className="text-xs text-muted">
              {CHANNEL[v.deliveredChannel ?? ''] ?? v.deliveredChannel}
            </span>
          </span>
        ) : (
          <Badge tone="neutral">Not sent</Badge>
        ),
    },
  ];

  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      {toast}
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className={card} aria-label="Current plan" data-testid="tab-current-plan">
          <SectionHead
            icon={FileText}
            title="Current Plan"
            subtitle="The plan the client is working on now."
          />
          {p ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={stepHref(p.id, 1)}
                  className="font-display text-xl font-bold text-heading hover:underline"
                >
                  {p.name}
                </Link>
                <PlanStatusPill status={p.status} />
              </div>
              <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">Target year / type</dt>
                <dd className="text-heading">
                  {p.targetYear}
                  {p.planType ? ` · ${p.planType}` : ''}
                </dd>
                <dt className="text-muted">Where it stands</dt>
                <dd className="text-heading">
                  Step {p.step} of 5: {STEPS[p.step - 1]?.label}
                </dd>
                <dt className="text-muted">Strategy</dt>
                <dd className="text-heading">{p.strategy.summary ?? '—'}</dd>
                <dt className="text-muted">Focus areas</dt>
                <dd className="text-heading">
                  {(p.strategy.areas ?? []).map((a) => AREA_LABEL[a.area] ?? a.area).join(', ') ||
                    '—'}
                </dd>
                <dt className="text-muted">Last updated</dt>
                <dd className="text-heading">{dayText(p.updatedAt)}</dd>
              </dl>
              <ChecklistCard
                title={
                  checks.every((x) => x.done) ? 'Ready to finalize' : 'Before it can be finalized'
                }
                items={checks.map(({ id, label, done }) => ({ id, label, done }))}
                marker="check"
                surface={checks.every((x) => x.done) ? 'success' : 'plain'}
              />
              <div className="flex flex-wrap gap-2">
                <Link href={stepHref(p.id, p.step)} className={primary}>
                  <PencilSimple aria-hidden weight="fill" className="size-4" /> Continue Editing
                </Link>
                <Link href={stepHref(p.id, 5)} className={outlined}>
                  <SealCheck aria-hidden weight="fill" className="size-4 text-action" /> Review
                  &amp; Finalize
                </Link>
                {p.canSend && p.currentVersion > 0 ? (
                  <button type="button" className={outlined} onClick={() => setSending(p)}>
                    <PaperPlaneTilt aria-hidden weight="fill" className="size-4 text-action" /> Send
                    to Client
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className={quiet}>
              {failed || plan.isError ? (
                'The plan is not available right now.'
              ) : c && !currentId ? (
                <>
                  No business plan yet.{' '}
                  <Link
                    href={`${BASE}/plans/new?advisoryClientId=${advisoryClientId}`}
                    className="font-medium text-link hover:underline"
                  >
                    Create Business Plan
                  </Link>
                </>
              ) : (
                'Loading…'
              )}
            </p>
          )}
        </section>
        <section className={card} aria-label="Versions" data-testid="tab-versions">
          <SectionHead
            icon={ClockCounterClockwise}
            title="Version History"
            subtitle="A finalized version never changes; each delivery is kept."
          />
          <Table
            rows={versions.data ?? []}
            columns={versionCols}
            rowKey={(v) => String(v.versionNo)}
            caption="Plan versions"
            dense
            noun="versions"
            pageSize={20}
            showPagination={false}
            loading={Boolean(currentId) && versions.isPending}
            emptyTitle={
              versions.isError || failed
                ? 'Versions are not available'
                : 'No finalized versions yet'
            }
            emptyText={
              versions.isError || failed
                ? 'We could not load them.'
                : 'Finalize the plan to keep its first version.'
            }
          />
        </section>
      </div>
      <section className={card} aria-label="All plans" data-testid="tab-plans">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHead
            icon={FileText}
            title="All Business Plans"
            subtitle="Every plan of this client, archived ones too."
          />
          <Link href={`${BASE}/plans/new?advisoryClientId=${advisoryClientId}`} className={primary}>
            <Plus aria-hidden weight="bold" className="size-4" /> Create Business Plan
          </Link>
        </div>
        <Table
          rows={plans.data?.items ?? []}
          columns={planCols}
          rowKey={(r) => r.id}
          caption="Business plans"
          dense
          noun="plans"
          pageSize={50}
          showPagination={false}
          loading={plans.isPending}
          emptyTitle={plans.isError ? 'Plans are not available' : 'No business plans yet'}
          emptyText={
            plans.isError ? 'We could not load them.' : 'Create the first plan for this client.'
          }
        />
      </section>
      {sending ? (
        <SendPlanDialog
          plan={sending}
          onClose={() => setSending(undefined)}
          onSent={() => {
            setSending(undefined);
            say(`${sending.name} sent.`);
          }}
        />
      ) : null}
    </ClientShell>
  );
}

// ---------- Goals and tasks: the module's lists, for this client ----------

export function ClientGoalsTab({ advisoryClientId }: { advisoryClientId: string }) {
  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      <GoalsList advisoryClientId={advisoryClientId} />
    </ClientShell>
  );
}

export function ClientTasksTab({ advisoryClientId }: { advisoryClientId: string }) {
  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      <ActionItemsSection advisoryClientId={advisoryClientId} />
    </ClientShell>
  );
}

// ---------- Notes ----------

/**
 * /business-advisory/clients/[clientId]/notes: the staff's advisory and meeting notes (the client's
 * internal notes, kept with the advisory engagement when there is one). Never shown to the client.
 */
export function ClientNotesTab({ advisoryClientId }: { advisoryClientId: string }) {
  const client = useAdvisoryClient(advisoryClientId);
  const c = client.data;
  const { act, toast } = useAct();
  const [scope, setScope] = useState<'advisory' | 'all'>('advisory');
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string }>();
  const [removing, setRemoving] = useState<InternalNote>();
  const [error, setError] = useState<string>();
  const engagement = scope === 'advisory' ? (c?.engagementId ?? null) : null;
  const notes = useApiQuery([...BA_KEY, 'client-notes', c?.client.id, engagement], () =>
    c
      ? api.clientNotes
          .list(c.client.id, engagement ? { engagementId: engagement } : {})
          .catch(noneWhenMissing([] as InternalNote[]))
      : Promise.resolve(null),
  );
  const failed = client.isError || notes.isError;
  const add = async () => {
    if (!c) return;
    setError(undefined);
    try {
      await api.clientNotes.create(c.client.id, {
        body: body.trim(),
        ...(c.engagementId ? { engagementId: c.engagementId } : {}),
      });
      setBody('');
      await act(() => Promise.resolve(), 'Note saved.');
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      {toast}
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <section className={card} aria-label="New note" data-testid="tab-note-new">
          <SectionHead
            icon={NotePencil}
            title="New Note"
            subtitle="Meeting and advisory notes for the firm's staff; the client never sees them."
          />
          <div className="flex flex-col gap-3">
            <ErrorLine text={error} />
            <Textarea
              label="Note"
              rows={6}
              maxLength={10000}
              value={body}
              disabled={!c}
              onChange={(e) => setBody(e.target.value)}
            />
            <button
              type="button"
              className={`${primary} self-start`}
              disabled={!c || !body.trim()}
              onClick={() => void add()}
            >
              <Plus aria-hidden weight="bold" className="size-4" /> Save Note
            </button>
          </div>
        </section>
        <section className={card} aria-label="Notes" data-testid="tab-notes">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHead icon={NotePencil} title="Notes" subtitle="Newest first." />
            {c?.engagementId ? (
              <div className="w-56">
                <Select
                  label="Show"
                  hideLabel
                  value={scope}
                  onChange={(e) => setScope(e.target.value as 'advisory' | 'all')}
                  options={[
                    { value: 'advisory', label: 'Advisory notes' },
                    { value: 'all', label: "All of the client's notes" },
                  ]}
                />
              </div>
            ) : null}
          </div>
          {notes.data && notes.data.length ? (
            <ul className="divide-y divide-divider" data-testid="note-list">
              {notes.data.map((n) => (
                <li key={n.id} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-heading">{n.author.name}</span>
                    <span className="text-muted">
                      {dayText(n.createdAt)}
                      {n.updatedAt !== n.createdAt ? ' · edited' : ''}
                    </span>
                    {n.canEdit && editing?.id !== n.id ? (
                      <span className="ml-auto flex gap-1">
                        <Button
                          variant="secondary"
                          aria-label="Edit note"
                          onClick={() => setEditing({ id: n.id, body: n.body })}
                        >
                          <PencilSimple aria-hidden weight="fill" className="size-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          aria-label="Delete note"
                          onClick={() => setRemoving(n)}
                        >
                          <Trash aria-hidden weight="fill" className="size-4" />
                        </Button>
                      </span>
                    ) : null}
                  </div>
                  {editing?.id === n.id ? (
                    <div className="flex flex-col gap-2">
                      <Textarea
                        label="Edit note"
                        rows={4}
                        maxLength={10000}
                        value={editing.body}
                        onChange={(e) => setEditing({ id: n.id, body: e.target.value })}
                      />
                      <span className="flex gap-2">
                        <Button
                          disabled={!editing.body.trim()}
                          onClick={() =>
                            void act(
                              () => api.clientNotes.update(n.id, { body: editing.body.trim() }),
                              'Note updated.',
                            ).then(() => setEditing(undefined))
                          }
                        >
                          Save
                        </Button>
                        <Button variant="secondary" onClick={() => setEditing(undefined)}>
                          Cancel
                        </Button>
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap text-text">{n.body}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={quiet}>
              {failed
                ? 'Notes are not available right now.'
                : notes.isPending && c
                  ? 'Loading…'
                  : 'No notes yet.'}
            </p>
          )}
        </section>
      </div>
      {removing ? (
        <Modal
          open
          title="Delete note?"
          subtitle="The note is removed for everyone. This cannot be undone."
          onClose={() => setRemoving(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(undefined)}>
                Keep Note
              </Button>
              <Button
                onClick={() =>
                  void act(() => api.clientNotes.remove(removing.id), 'Note deleted.').then(() =>
                    setRemoving(undefined),
                  )
                }
              >
                Delete
              </Button>
            </>
          }
        >
          <p className="line-clamp-3 text-sm text-text">{removing.body}</p>
        </Modal>
      ) : null}
    </ClientShell>
  );
}

// ---------- Activity Log ----------

const SIZE = 20;
/** The icon of a history line, from the kind of record it is about. */
const ACTIVITY: [string, Icon, TimelineItem['tone']][] = [
  ['plan', FileText, 'blue'],
  ['goal', Target, 'amber'],
  ['milestone', Target, 'amber'],
  ['recommendation', Lightbulb, 'purple'],
  ['action', CheckSquare, 'green'],
  ['financ', CurrencyDollar, 'green'],
  ['workstream', Briefcase, 'navy'],
  ['service', Briefcase, 'navy'],
  ['resource', PaperPlaneTilt, 'blue'],
  ['client', UsersThree, 'grey'],
];
const iconOf = (action: string): [Icon, TimelineItem['tone']] => {
  const hit = ACTIVITY.find(([key]) => action.includes(key));
  return hit ? [hit[1], hit[2]] : [ListChecks, 'grey'];
};

/** /business-advisory/clients/[clientId]/activity: the audited history of the client's advisory work. */
export function ClientActivityTab({ advisoryClientId }: { advisoryClientId: string }) {
  const [page, setPage] = useState(1);
  const q = useApiQuery([...BA_KEY, 'client-activity', advisoryClientId, page], () =>
    api.advisory.activity(advisoryClientId, { page, pageSize: SIZE }),
  );
  const items: TimelineItem[] = (q.data?.items ?? []).map((a) => {
    const [icon, tone] = iconOf(a.action);
    return {
      id: a.id,
      icon,
      tone,
      title: a.message,
      time: new Date(a.at).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
      dateTime: a.at,
      actor: a.actor?.name ?? 'System',
    };
  });
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / SIZE));
  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      <section className={card} aria-label="Activity log" data-testid="tab-activity">
        <SectionHead
          icon={ClockCounterClockwise}
          title="Activity Log"
          subtitle="What changed in this client's advisory work, by whom and when. Figures and notes are never shown here."
        />
        {q.isError ? (
          <p className={quiet}>
            The activity log is not available right now. Try again in a moment.
          </p>
        ) : q.isPending ? (
          <p className={quiet}>Loading…</p>
        ) : (
          <Timeline
            items={items}
            variant="rail"
            label="Advisory activity"
            emptyText="No activity yet."
          />
        )}
        {pages > 1 ? (
          <div className="mt-3">
            <Pagination
              page={page}
              onPage={setPage}
              pageCount={pages}
              summary={`${q.data?.total ?? 0} entries`}
            />
          </div>
        ) : null}
      </section>
    </ClientShell>
  );
}
