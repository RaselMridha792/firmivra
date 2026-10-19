'use client';

import type { AdvisoryClientRow, AdvisoryGoalRow, AdvisoryMeetingRow } from '@firmivra/types';
import { ActionMenu, Avatar, Table, Toast, type Column } from '@firmivra/ui';
import {
  Bank,
  BookOpen,
  Buildings,
  CalendarDots,
  CaretRight,
  ChartBar,
  ChartLineUp,
  DotsThree,
  Eye,
  FileText,
  Globe,
  HandCoins,
  Lightbulb,
  PaintBrush,
  PlayCircle,
  Target,
  TrendUp,
  Users,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { AddClientDialog, AddGoalDialog } from './ba-dialogs';
import { BaShell } from './ba-shell';
import {
  BASE,
  BA_KEY,
  ClientStatusPill,
  DateTimeCell,
  GoalStatusPill,
  ProgressBar,
  SectionHead,
  card,
  dayText,
  outlined,
  primary,
  quiet,
} from './ba-shared';

/** The resource library's categories (apps/api/src/advisory/catalog.ts), each with its icon. */
const RESOURCE_ICON: Record<string, Icon> = {
  'Formation / EIN': Buildings,
  Branding: PaintBrush,
  Website: Globe,
  Banking: Bank,
  Funding: HandCoins,
  'Business Planning': FileText,
  'Market Research': ChartBar,
  'Financial Management': ChartLineUp,
  'Growth / Operations': TrendUp,
  Education: PlayCircle,
};

/** /business-advisory: KPIs, quick actions, recent clients, meetings, goals and resources. */
export function AdvisoryOverview() {
  const router = useRouter();
  const q = useApiQuery([...BA_KEY, 'overview'], () => api.advisory.overview());
  const o = q.data;
  const [dialog, setDialog] = useState<{ kind: 'client' } | { kind: 'goal'; clientId?: string }>();
  const [msg, setMsg] = useState<string>();
  const failed = q.isError;

  const clientCols: Column<AdvisoryClientRow>[] = [
    {
      id: 'name',
      label: 'Client Name',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <Avatar name={r.client.name} size="sm" />
          <Link
            href={`${BASE}/clients/${r.id}`}
            data-testid="client-link"
            className="font-semibold text-heading hover:underline"
          >
            {r.client.name}
          </Link>
        </span>
      ),
    },
    {
      id: 'business',
      label: 'Business Name',
      cell: (r) => <span className="text-link">{r.businessName ?? '—'}</span>,
    },
    { id: 'service', label: 'Service Focus', cell: (r) => r.primaryService?.name ?? '—' },
    {
      id: 'next',
      className: 'whitespace-nowrap',
      label: 'Next Meeting',
      cell: (r) => <DateTimeCell iso={r.nextMeetingAt} />,
    },
    {
      id: 'status',
      className: 'whitespace-nowrap',
      label: 'Status',
      cell: (r) => <ClientStatusPill status={r.status} />,
    },
    {
      id: 'actions',
      className: 'whitespace-nowrap',
      label: 'Actions',
      cell: (r) => (
        <ActionMenu
          label={`Actions for ${r.client.name}`}
          trigger={<DotsThree aria-hidden weight="bold" className="size-5 text-action" />}
          sections={[
            {
              items: [
                {
                  label: 'Open Advisory Detail',
                  icon: Eye,
                  onSelect: () => router.push(`${BASE}/clients/${r.id}`),
                },
                ...(o?.canCreatePlan
                  ? [
                      {
                        label: 'Create Business Plan',
                        icon: FileText,
                        onSelect: () => router.push(`${BASE}/plans/new?advisoryClientId=${r.id}`),
                      },
                    ]
                  : []),
                ...(o?.canManageGoals
                  ? [
                      {
                        label: 'Add Business Goal',
                        icon: Target,
                        onSelect: () => setDialog({ kind: 'goal', clientId: r.id }),
                      },
                    ]
                  : []),
                {
                  label: 'Schedule Meeting',
                  icon: CalendarDots,
                  onSelect: () => router.push('/calendar/new'),
                },
              ],
            },
          ]}
        />
      ),
    },
  ];

  const meetingCols: Column<AdvisoryMeetingRow>[] = [
    {
      id: 'date',
      className: 'whitespace-nowrap',
      label: 'Date',
      cell: (r) => <DateTimeCell iso={r.startsAt} />,
    },
    { id: 'client', label: 'Client', cell: (r) => r.client.name },
    { id: 'business', label: 'Business Name', cell: (r) => r.businessName ?? '—' },
    { id: 'type', label: 'Meeting Type', cell: (r) => r.meetingType ?? '—' },
    {
      id: 'action',
      className: 'whitespace-nowrap',
      label: 'Action',
      cell: (r) =>
        r.joinUrl ? (
          <a
            href={r.joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${outlined} min-h-9 min-w-16 px-3 text-action`}
            aria-label={`Join the meeting with ${r.client.name}`}
          >
            Join
          </a>
        ) : (
          <Link
            href={`/calendar/${r.appointmentId}`}
            className={`${outlined} min-h-9 min-w-16 px-3 text-action`}
            aria-label={`Open the meeting with ${r.client.name}`}
          >
            Open
          </Link>
        ),
    },
  ];

  const goalCols: Column<AdvisoryGoalRow>[] = [
    {
      id: 'goal',
      label: 'Goal',
      cell: (r) => (
        <Link
          href={`${BASE}/clients/${r.advisoryClientId}/goals`}
          className="text-link hover:underline"
        >
          {r.title}
        </Link>
      ),
    },
    { id: 'client', className: 'whitespace-nowrap', label: 'Client', cell: (r) => r.client.name },
    {
      id: 'target',
      className: 'whitespace-nowrap',
      label: 'Target Date',
      cell: (r) => dayText(r.targetDate),
    },
    {
      id: 'status',
      className: 'whitespace-nowrap',
      label: 'Status',
      cell: (r) => <GoalStatusPill status={r.status} />,
    },
    {
      id: 'progress',
      label: 'Progress',
      cell: (r) => <ProgressBar value={r.progressPercent} label={`Progress of ${r.title}`} />,
    },
  ];

  const canPlan = o ? o.canCreatePlan : !failed;
  const canGoal = o ? o.canManageGoals : !failed;

  return (
    <BaShell>
      {failed ? (
        <p role="alert" className={quiet} data-testid="ba-error">
          Business advisory is not available right now. We could not load it. Try again in a moment.
        </p>
      ) : null}
      {msg ? <Toast message={msg} tone="success" onDismiss={() => setMsg(undefined)} /> : null}

      <section
        className={`${card} grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]`}
        aria-label="Turn business goals into real growth"
        data-testid="hero"
      >
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="hidden size-20 shrink-0 items-center justify-center rounded-xl bg-info-soft text-action sm:flex"
          >
            <Lightbulb weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-bold text-heading">
              Turn Business Goals Into Real Growth
            </h2>
            <p className="text-base text-link">
              We provide the strategy, tools, and support your clients need to build stronger, more
              profitable, and more sustainable businesses.
            </p>
          </div>
        </div>
        <div
          className="grid gap-2 rounded-xl border border-divider p-3 sm:grid-cols-2"
          data-testid="quick-actions"
        >
          <Link
            href={`${BASE}/plans/new`}
            aria-disabled={!canPlan}
            className={`${primary} ${canPlan ? '' : 'pointer-events-none opacity-50'}`}
          >
            <FileText aria-hidden weight="fill" className="size-5" /> Create Business Plan
          </Link>
          <Link href="/calendar/new" className={outlined}>
            <CalendarDots aria-hidden weight="fill" className="size-5 text-action" /> Schedule
            Advisory Meeting
          </Link>
          <button
            type="button"
            disabled={!canGoal}
            onClick={() => setDialog({ kind: 'goal' })}
            className={outlined}
          >
            <Target aria-hidden weight="fill" className="size-5 text-action" /> Add Business Goal
          </button>
          <button
            type="button"
            disabled={failed}
            onClick={() => setDialog({ kind: 'client' })}
            className={outlined}
          >
            <Users aria-hidden weight="fill" className="size-5 text-action" /> Add Advisory Client
          </button>
        </div>
      </section>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] 2xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <section
          className={`${card} px-3`}
          aria-label="Recent advisory clients"
          data-testid="recent-clients"
        >
          <SectionHead
            icon={UsersThree}
            title="Recent Advisory Clients"
            subtitle="Clients currently in the advisory program or with active projects."
            href={`${BASE}/clients`}
          />
          <Table
            rows={o?.recentClients ?? []}
            columns={clientCols}
            rowKey={(r) => r.id}
            caption="Recent advisory clients"
            dense
            noun="clients"
            pageSize={5}
            showPagination={false}
            loading={q.isPending}
            emptyTitle={failed ? 'Clients are not available' : 'No advisory clients yet'}
            emptyText={
              failed
                ? 'We could not load them. Try again in a moment.'
                : 'Add an advisory client to start.'
            }
          />
        </section>
        <section className={card} aria-label="Upcoming advisory meetings" data-testid="meetings">
          <SectionHead
            icon={CalendarDots}
            title="Upcoming Advisory Meetings"
            href="/calendar/list"
          />
          <Table
            rows={o?.meetings ?? []}
            columns={meetingCols}
            rowKey={(r) => r.appointmentId}
            caption="Upcoming advisory meetings"
            dense
            noun="meetings"
            pageSize={5}
            showPagination={false}
            loading={q.isPending}
            emptyTitle={failed ? 'Meetings are not available' : 'No upcoming meetings'}
            emptyText={
              failed
                ? 'We could not load them. Try again in a moment.'
                : 'Schedule an appointment for a Business Advisory service.'
            }
          />
        </section>
      </div>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] 2xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <section className={card} aria-label="Active business goals" data-testid="goals">
          <SectionHead
            icon={Target}
            title="Active Business Goals & Milestones"
            subtitle="Track progress on client business goals."
            href={`${BASE}/goals`}
          />
          <Table
            rows={o?.goals ?? []}
            columns={goalCols}
            rowKey={(r) => r.id}
            caption="Active business goals"
            dense
            noun="goals"
            pageSize={5}
            showPagination={false}
            loading={q.isPending}
            emptyTitle={failed ? 'Goals are not available' : 'No active goals'}
            emptyText={
              failed
                ? 'We could not load them. Try again in a moment.'
                : 'Add a business goal for an advisory client.'
            }
          />
        </section>
        <section className={card} aria-label="Business resources" data-testid="resources">
          <SectionHead
            icon={BookOpen}
            title="Business Resources"
            subtitle="Tools, templates, and resources for you and your clients."
            href={`${BASE}/resources`}
          />
          {o && o.resources.length === 0 ? <p className={quiet}>No resources yet.</p> : null}
          {failed ? <p className={quiet}>Resources are not available right now.</p> : null}
          {o?.resources.length ? (
            <ul className="overflow-hidden rounded-lg border border-divider">
              {o.resources.map((r) => {
                const Glyph = RESOURCE_ICON[r.category] ?? BookOpen;
                return (
                  <li key={r.key} className="border-t border-divider first:border-t-0">
                    <Link
                      href={`${BASE}/resources`}
                      className="flex min-h-11 items-center gap-3 px-3 text-sm text-heading hover:bg-canvas hover:text-action"
                    >
                      <Glyph aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
                      <span className="flex-1">{r.title}</span>
                      <CaretRight aria-hidden weight="bold" className="size-4 text-heading" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </div>

      {dialog?.kind === 'client' ? (
        <AddClientDialog
          onClose={() => setDialog(undefined)}
          onAdded={(id) => {
            setDialog(undefined);
            router.push(`${BASE}/clients/${id}`);
          }}
        />
      ) : null}
      {dialog?.kind === 'goal' ? (
        <AddGoalDialog
          {...(dialog.clientId ? { advisoryClientId: dialog.clientId } : {})}
          onClose={() => setDialog(undefined)}
          onAdded={(title) => {
            setDialog(undefined);
            setMsg(`Goal added: ${title}`);
          }}
        />
      ) : null}
    </BaShell>
  );
}
