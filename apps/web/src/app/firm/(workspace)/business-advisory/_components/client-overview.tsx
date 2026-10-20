'use client';

import type { AdvisoryClientDetail, AdvisoryGoalRow } from '@firmivra/types';
import { Badge, Button, Callout, Modal, Table, type Column } from '@firmivra/ui';
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
  Buildings,
  CalendarDots,
  ChartBar,
  CheckSquare,
  Coins,
  CurrencyDollar,
  FileText,
  Info,
  Lightbulb,
  Lock,
  NotePencil,
  Paperclip,
  Target,
  UsersThree,
  VideoCamera,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorCode } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { Disclaimer } from './ba-shell';
import {
  ActionStatusPill,
  BASE,
  BA_KEY,
  GoalStatusPill,
  ProgressBar,
  RecStatusPill,
  SectionHead,
  card,
  dayText,
  money,
  outlined,
  primary,
  quiet,
} from './ba-shared';
import { ClientShell, EditClientDialog, useAdvisoryClient } from './client-shell';

/** A client record the other module does not know reads as "none yet", not as an outage. */
const noneWhenMissing =
  <T,>(none: T) =>
  (e: unknown): T => {
    if (errorCode(e) === 'NOT_FOUND') return none;
    throw e;
  };

const TONES = {
  blue: 'bg-info-soft text-action',
  green: 'bg-success-soft text-success',
  purple: 'bg-purple-soft text-purple',
  amber: 'bg-warning-soft text-gold',
  red: 'bg-danger-soft text-danger',
} as const;

/** One number of the client's row: icon tile, label, value, how it moved or what it means. */
function Kpi({
  icon: Glyph,
  tone,
  label,
  value,
  note,
  noteTone,
  delta,
  children,
  testId,
}: {
  icon: Icon;
  tone: keyof typeof TONES;
  label: string;
  value: string;
  note?: string | undefined;
  noteTone?: 'good' | 'bad' | undefined;
  delta?: number | null | undefined;
  children?: React.ReactNode;
  testId: string;
}) {
  return (
    <div className={`${card} flex h-full items-start gap-3 px-3`} data-testid={testId}>
      <span
        aria-hidden
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`}
      >
        <Glyph weight="fill" className="size-6" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm text-heading">{label}</span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-xl leading-tight font-bold text-heading">{value}</span>
          {delta != null ? (
            <span
              className={`inline-flex items-center gap-0.5 rounded-md px-1.5 text-sm font-semibold ${delta >= 0 ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
            >
              {delta >= 0 ? (
                <ArrowUp aria-hidden weight="bold" className="size-3" />
              ) : (
                <ArrowDown aria-hidden weight="bold" className="size-3" />
              )}
              {Math.abs(delta)}%
            </span>
          ) : null}
        </span>
        {note ? (
          <span
            className={`text-xs ${noteTone === 'bad' ? 'text-danger' : noteTone === 'good' ? 'text-success' : 'text-muted'}`}
          >
            {note}
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** The score, each factor's weight, value and explanation, and the data's age (guide §7). */
export function HealthFactors({ client }: { client: AdvisoryClientDetail }) {
  const h = client.health;
  return (
    <div className="flex flex-col gap-3" data-testid="health-factors">
      <p className="flex flex-wrap items-baseline gap-3">
        <span className="text-3xl font-bold text-heading">
          {h.score === null ? '—' : `${h.score} / 100`}
        </span>
        <span className="text-sm text-muted">
          {h.computedAt ? `Worked out ${dayText(h.computedAt)}` : 'Not enough data yet'} · formula{' '}
          {h.formulaVersion}
        </span>
        {h.stale ? <Badge tone="danger">Figures out of date</Badge> : null}
      </p>
      <ul className="divide-y divide-divider">
        {h.factors.map((f) => (
          <li
            key={f.factor}
            className="grid grid-cols-[1fr_auto_auto] items-start gap-3 py-2 text-sm"
          >
            <span className="flex flex-col">
              <span className="font-semibold text-heading">{f.label}</span>
              <span className="text-xs text-muted">{f.explanation}</span>
            </span>
            <span className="text-muted">{f.weight}%</span>
            <span className="w-16 text-right font-semibold text-heading">
              {f.value === null ? 'No data' : `${f.value}`}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        Factors without data are left out, and the rest are weighted up to 100.
      </p>
    </div>
  );
}

/** How the Business Health Score was made, in a dialog from the KPI row. */
export function HealthDialog({
  client,
  onClose,
}: {
  client: AdvisoryClientDetail;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      title="Business Health Score"
      subtitle="An explainable advisory indicator, not a guarantee. The firm sets the formula in the module's settings."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div data-testid="health-dialog">
        <HealthFactors client={client} />
      </div>
    </Modal>
  );
}

/** /business-advisory/clients/[clientId]: the client's command center (design 3, Overview tab). */
export function ClientOverview({ advisoryClientId }: { advisoryClientId: string }) {
  const q = useAdvisoryClient(advisoryClientId);
  const c = q.data;
  const failed = q.isError;
  const [dialog, setDialog] = useState<'health' | 'edit'>();
  const base = `${BASE}/clients/${advisoryClientId}`;
  const goals = useApiQuery([...BA_KEY, 'client-goals', advisoryClientId], () =>
    api.advisory.goals({ advisoryClientId, pageSize: 5 }),
  );
  const meeting = useApiQuery([...BA_KEY, 'client-next-meeting', advisoryClientId], () =>
    api.advisory.meetings({ advisoryClientId, when: 'upcoming', pageSize: 1 }),
  );
  const figures = useApiQuery(
    [...BA_KEY, 'client-figures', advisoryClientId, c?.canViewFinancials],
    () =>
      c?.canViewFinancials
        ? api.advisory.financials({ advisoryClientId, pageSize: 1 })
        : Promise.resolve(null),
  );
  const recs = useApiQuery([...BA_KEY, 'client-recs', advisoryClientId], () =>
    api.advisory.recommendations({ advisoryClientId, pageSize: 5 }),
  );
  const tasks = useApiQuery([...BA_KEY, 'client-tasks', advisoryClientId], () =>
    api.advisory.actionItems({ advisoryClientId, pageSize: 5 }),
  );
  const firmClientId = c?.client.id;
  const notes = useApiQuery([...BA_KEY, 'client-notes', firmClientId, c?.engagementId], () =>
    firmClientId
      ? api.clientNotes
          .list(firmClientId, c?.engagementId ? { engagementId: c.engagementId } : {})
          .catch(noneWhenMissing([]))
      : Promise.resolve(null),
  );
  const docs = useApiQuery([...BA_KEY, 'client-docs', firmClientId], () =>
    firmClientId
      ? api.documents.list(firmClientId, { limit: 50 }).catch(noneWhenMissing(null))
      : Promise.resolve(null),
  );
  const services = new Set(c?.workstreams.map((w) => w.serviceId));
  const advisoryDocs = (docs.data?.items ?? [])
    .filter((d) => services.has(d.service.id))
    .slice(0, 5);

  const k = c?.kpis;
  const hires =
    k && k.employees.value != null && k.employees.previous != null
      ? k.employees.value - k.employees.previous
      : null;
  const next = meeting.data?.items[0];
  const latest = figures.data?.items[0];
  const goalCols: Column<AdvisoryGoalRow>[] = [
    { id: 'goal', label: 'Goal', cell: (g) => <span className="text-link">{g.title}</span> },
    {
      id: 'target',
      label: 'Target Date',
      className: 'whitespace-nowrap',
      cell: (g) => dayText(g.targetDate),
    },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (g) => <GoalStatusPill status={g.status} />,
    },
    {
      id: 'progress',
      label: 'Progress',
      cell: (g) => <ProgressBar value={g.progressPercent} label={`Progress of ${g.title}`} />,
    },
  ];
  type Rec = NonNullable<typeof recs.data>['items'][number];
  const recCols: Column<Rec>[] = [
    {
      id: 'title',
      label: 'Recommendation',
      cell: (r) => <span className="text-link">{r.title}</span>,
    },
    { id: 'cat', label: 'Category', cell: (r) => r.category ?? '—' },
    {
      id: 'impact',
      label: 'Potential Impact',
      className: 'whitespace-nowrap',
      cell: (r) => r.impactLabel ?? (r.impactCents === null ? '—' : money(r.impactCents)),
    },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (r) => <RecStatusPill status={r.status} />,
    },
  ];
  type Task = NonNullable<typeof tasks.data>['items'][number];
  const taskCols: Column<Task>[] = [
    { id: 'task', label: 'Task', cell: (t) => <span className="text-link">{t.title}</span> },
    {
      id: 'who',
      label: 'Assigned To',
      cell: (t) => t.assignee?.name ?? (t.assigneeKind === 'CLIENT' ? 'Client' : 'Advisory team'),
    },
    { id: 'due', label: 'Due Date', className: 'whitespace-nowrap', cell: (t) => dayText(t.dueOn) },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (t) =>
        t.overdue ? <Badge tone="danger">Overdue</Badge> : <ActionStatusPill status={t.status} />,
    },
  ];
  const empty = (what: string, error: boolean) =>
    error ? { title: `${what} are not available`, text: 'We could not load them.' } : null;

  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      <ul
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        data-testid="client-kpis"
      >
        <li>
          <Kpi
            icon={ChartBar}
            tone="blue"
            label="Annual Revenue"
            testId="kpi-revenue"
            value={c && !c.canViewFinancials ? 'Restricted' : money(k?.annualRevenueCents?.value)}
            delta={k?.annualRevenueCents?.deltaPercent}
            note={
              k?.annualRevenueCents?.periodLabel
                ? `${k.annualRevenueCents.periodLabel}, vs. last year`
                : undefined
            }
          />
        </li>
        <li>
          <Kpi
            icon={Coins}
            tone="green"
            label="Net Profit"
            testId="kpi-profit"
            value={c && !c.canViewFinancials ? 'Restricted' : money(k?.netProfitCents?.value)}
            delta={k?.netProfitCents?.deltaPercent}
            note={k?.netProfitCents?.periodLabel ? 'vs. last year' : undefined}
          />
        </li>
        <li>
          <Kpi
            icon={UsersThree}
            tone="purple"
            label="Employees"
            testId="kpi-employees"
            value={k?.employees.value == null ? '—' : String(k.employees.value)}
            note={
              hires === null
                ? undefined
                : hires >= 0
                  ? `${hires} new this year`
                  : `${-hires} fewer this year`
            }
          />
        </li>
        <li>
          <Kpi
            icon={Target}
            tone="amber"
            label="Active Goals"
            testId="kpi-goals"
            value={k ? String(k.activeGoals.count) : '—'}
            note={k ? `${k.activeGoals.onTrack} on track` : undefined}
            noteTone="good"
          />
        </li>
        <li>
          <Kpi
            icon={CheckSquare}
            tone="red"
            label="Open Tasks"
            testId="kpi-tasks"
            value={k ? String(k.openTasks.open) : '—'}
            note={k ? `${k.openTasks.overdue} overdue` : undefined}
            noteTone={k?.openTasks.overdue ? 'bad' : undefined}
          />
        </li>
        <li>
          <Kpi
            icon={ChartBar}
            tone="blue"
            label="Business Health Score"
            testId="kpi-health"
            value={c?.health.score == null ? '—' : `${c.health.score} / 100`}
            note={c?.health.stale ? 'Figures out of date' : undefined}
            noteTone="bad"
          >
            {c ? (
              <>
                <span
                  aria-hidden
                  className="mt-1 block h-2 overflow-hidden rounded-pill bg-disabled"
                >
                  <span
                    className="block h-full rounded-pill bg-success"
                    style={{ width: `${c.health.score ?? 0}%` }}
                  />
                </span>
                <button
                  type="button"
                  onClick={() => setDialog('health')}
                  className="mt-1 inline-flex items-center gap-1 self-start text-xs font-medium text-link hover:underline"
                >
                  <Info aria-hidden weight="fill" className="size-3.5" /> How it works
                </button>
              </>
            ) : null}
          </Kpi>
        </li>
      </ul>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)_minmax(0,0.85fr)]">
        <section
          className={card}
          aria-label="Client business information"
          data-testid="card-business"
        >
          <div className="flex items-start justify-between gap-2">
            <SectionHead icon={Buildings} title="Client Business Information" />
            {c?.canEdit ? (
              <button
                type="button"
                className="text-sm font-medium text-link hover:underline"
                onClick={() => setDialog('edit')}
              >
                Edit
              </button>
            ) : null}
          </div>
          {c ? (
            <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              {(
                [
                  ['Business Name', c.businessName],
                  ['EIN', c.businessProfile.einMasked],
                  ['Entity Type', c.businessProfile.entityType],
                  ['Industry', c.industry],
                  [
                    'Years in Business',
                    c.businessProfile.yearsInBusiness == null
                      ? null
                      : `${c.businessProfile.yearsInBusiness} years`,
                  ],
                  ['Business Stage', c.businessStage],
                  [
                    'Address',
                    [
                      c.businessProfile.address?.line1,
                      c.businessProfile.address?.city,
                      [c.businessProfile.address?.state, c.businessProfile.address?.postalCode]
                        .filter(Boolean)
                        .join(' '),
                    ]
                      .filter(Boolean)
                      .join(', '),
                  ],
                ] as [string, string | null][]
              ).map(([label, v]) => (
                <div key={label} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd className="min-w-0 break-words text-heading">{v || '—'}</dd>
                </div>
              ))}
              <dt className="text-muted">Website</dt>
              <dd className="min-w-0 break-all">
                {c.businessProfile.website ? (
                  <a
                    href={c.businessProfile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link hover:underline"
                  >
                    {c.businessProfile.website.replace(/^https?:\/\//, '')}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </dl>
          ) : (
            <p className={quiet}>{failed ? 'Not available right now.' : 'Loading…'}</p>
          )}
        </section>

        <section className={card} aria-label="Goals and milestones" data-testid="card-goals">
          <SectionHead icon={Target} title="Goals & Milestones" href={`${base}/goals`} />
          <Table
            rows={goals.data?.items ?? []}
            columns={goalCols}
            rowKey={(g) => g.id}
            caption="Goals"
            dense
            noun="goals"
            pageSize={5}
            showPagination={false}
            loading={goals.isPending}
            emptyTitle={empty('Goals', goals.isError)?.title ?? 'No goals yet'}
            emptyText={
              empty('Goals', goals.isError)?.text ?? 'Add a goal on the Goals & Milestones tab.'
            }
          />
        </section>

        <section className={card} aria-label="Upcoming meeting" data-testid="card-meeting">
          <SectionHead icon={CalendarDots} title="Upcoming Meeting" />
          {next ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-4">
                <span className="flex w-20 shrink-0 flex-col items-center rounded-lg border border-divider py-2 text-heading">
                  <span className="text-xs font-semibold uppercase">
                    {new Date(next.startsAt).toLocaleDateString('en-US', { month: 'short' })}
                  </span>
                  <span className="text-3xl leading-none font-bold">
                    {new Date(next.startsAt).getDate()}
                  </span>
                  <span className="text-xs">{new Date(next.startsAt).getFullYear()}</span>
                </span>
                <span className="flex min-w-0 flex-col text-sm">
                  <span className="font-semibold text-heading">
                    {next.meetingType ?? 'Advisory meeting'}
                  </span>
                  <span>
                    {new Date(next.startsAt).toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                  <span>
                    {new Date(next.startsAt).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}{' '}
                    –{' '}
                    {new Date(next.endsAt).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="flex items-center gap-1 text-link">
                    <VideoCamera aria-hidden weight="fill" className="size-4" />{' '}
                    {next.joinUrl ? 'Virtual Meeting' : (next.location ?? 'In person')}
                  </span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {next.joinUrl ? (
                  <a
                    href={next.joinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={primary}
                  >
                    Join Meeting
                  </a>
                ) : (
                  <Link href={`/calendar/${next.appointmentId}`} className={primary}>
                    Open Meeting
                  </Link>
                )}
                <Link href={`/calendar/${next.appointmentId}/edit`} className={outlined}>
                  Reschedule
                </Link>
              </div>
            </div>
          ) : (
            <p className={quiet}>
              {meeting.isError
                ? 'Meetings are not available right now.'
                : meeting.isPending
                  ? 'Loading…'
                  : 'No upcoming meeting.'}{' '}
              {!meeting.isError && !meeting.isPending ? (
                <Link href="/calendar/new" className="font-medium text-link hover:underline">
                  Schedule one
                </Link>
              ) : null}
            </p>
          )}
        </section>

        <section className={card} aria-label="Financial snapshot" data-testid="card-financials">
          <SectionHead
            icon={CurrencyDollar}
            title="Financial Snapshot"
            href={`${base}/financials`}
          />
          {c && !c.canViewFinancials ? (
            <Callout icon={Lock} title="Financial figures are restricted" surface="plain">
              Your role does not include &quot;View financial analysis&quot;.
            </Callout>
          ) : latest ? (
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm" data-testid="snapshot">
              <dt className="text-muted">Total Revenue</dt>
              <dd className="text-right font-semibold text-heading">
                {money(latest.revenueCents)}
              </dd>
              <dt className="text-muted">Total Expenses</dt>
              <dd className="text-right font-semibold text-heading">
                {money(latest.expensesCents)}
              </dd>
              <dt className="text-muted">Net Profit</dt>
              <dd
                className={`text-right font-semibold ${latest.netProfitCents !== null && latest.netProfitCents < 0 ? 'text-danger' : 'text-success'}`}
              >
                {money(latest.netProfitCents)}
              </dd>
              <dt className="text-muted">Profit Margin</dt>
              <dd className="text-right font-semibold text-heading">
                {latest.marginPercent === null ? '—' : `${latest.marginPercent}%`}
              </dd>
              <dt className="text-muted">Cash Flow</dt>
              <dd className="text-right font-semibold text-heading">
                {money(latest.cashFlowCents)}
              </dd>
              <dt className="col-span-2 text-xs text-muted">
                {dayText(latest.periodStart)} – {dayText(latest.periodEnd)} · as of{' '}
                {dayText(latest.asOf)}
                {latest.stale ? ' · out of date' : ''}
              </dt>
            </dl>
          ) : (
            <p className={quiet}>
              {failed || figures.isError
                ? 'Figures are not available right now.'
                : figures.isPending && c
                  ? 'Loading…'
                  : 'No figures yet.'}
            </p>
          )}
        </section>

        <section
          className={card}
          aria-label="Top recommendations"
          data-testid="card-recommendations"
        >
          <SectionHead
            icon={Lightbulb}
            title="Top Recommendations"
            href={`${base}/recommendations`}
          />
          <Table
            rows={recs.data?.items ?? []}
            columns={recCols}
            rowKey={(r) => r.id}
            caption="Recommendations"
            dense
            noun="recommendations"
            pageSize={5}
            showPagination={false}
            loading={recs.isPending}
            emptyTitle={empty('Recommendations', recs.isError)?.title ?? 'No recommendations yet'}
            emptyText={
              empty('Recommendations', recs.isError)?.text ?? 'Add one on the Recommendations tab.'
            }
          />
        </section>

        <section className={card} aria-label="Recent meeting notes" data-testid="card-notes">
          <SectionHead icon={NotePencil} title="Recent Meeting Notes" href={`${base}/notes`} />
          {notes.data && notes.data.length ? (
            <ul className="divide-y divide-divider">
              {notes.data.slice(0, 3).map((n) => (
                <li key={n.id} className="grid grid-cols-[6rem_1fr] gap-3 py-2 text-sm">
                  <span className="text-muted">{dayText(n.createdAt)}</span>
                  <span className="line-clamp-2 text-heading">{n.body}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={quiet}>
              {failed || notes.isError
                ? 'Notes are not available right now.'
                : notes.isPending && c
                  ? 'Loading…'
                  : 'No notes yet.'}
            </p>
          )}
        </section>
      </div>
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1.1fr)_minmax(0,0.85fr)]">
        <section className={card} aria-label="Action items" data-testid="card-tasks">
          <SectionHead icon={CheckSquare} title="Action Items / Tasks" href={`${base}/tasks`} />
          <Table
            rows={tasks.data?.items ?? []}
            columns={taskCols}
            rowKey={(t) => t.id}
            caption="Action items"
            dense
            noun="tasks"
            pageSize={5}
            showPagination={false}
            loading={tasks.isPending}
            emptyTitle={empty('Tasks', tasks.isError)?.title ?? 'No tasks yet'}
            emptyText={empty('Tasks', tasks.isError)?.text ?? 'Add one on the Tasks tab.'}
          />
        </section>

        <section className={card} aria-label="Documents" data-testid="card-documents">
          <SectionHead icon={Paperclip} title="Documents" href={`${base}/documents`} />
          {advisoryDocs.length ? (
            <ul className="divide-y divide-divider">
              {advisoryDocs.map((d) => (
                <li key={d.id} className="grid grid-cols-[1fr_auto] gap-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2 truncate text-link">
                    <FileText aria-hidden weight="fill" className="size-4 shrink-0" /> {d.fileName}
                  </span>
                  <span className="text-muted">{dayText(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={quiet}>
              {failed || docs.isError
                ? 'Documents are not available right now.'
                : docs.isPending && c
                  ? 'Loading…'
                  : 'No advisory documents yet.'}
            </p>
          )}
        </section>

        <figure
          className={`${card} flex flex-col items-center justify-center gap-2 py-8 text-center`}
        >
          <Briefcase aria-hidden weight="fill" className="size-10 text-info" />
          <blockquote className="font-display text-xl text-heading italic">
            &ldquo;Guided by strategy. Driven by growth.&rdquo;
          </blockquote>
        </figure>
      </div>
      {c ? <Disclaimer text={c.disclaimer} /> : null}
      {dialog === 'health' && c ? (
        <HealthDialog client={c} onClose={() => setDialog(undefined)} />
      ) : null}
      {dialog === 'edit' && c ? (
        <EditClientDialog client={c} onClose={() => setDialog(undefined)} />
      ) : null}
    </ClientShell>
  );
}
