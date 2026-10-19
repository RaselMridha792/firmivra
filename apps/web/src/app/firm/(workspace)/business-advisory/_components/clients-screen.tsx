'use client';

import type { AdvisoryClientRow } from '@firmivra/types';
import { ActionMenu, Avatar, Badge, Checkbox, Table, type Column } from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  CalendarDots,
  DotsThreeVertical,
  Eye,
  FileText,
  Plus,
  Target,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { AddClientDialog, AddGoalDialog, useMembers } from './ba-dialogs';
import { FilterSelect, SearchBox, serverPaging, useAct } from './ba-list-kit';
import { BaShell } from './ba-shell';
import {
  BASE,
  BA_KEY,
  BUSINESS_STAGES,
  CLIENT_STATUS,
  ClientStatusPill,
  DateTimeCell,
  card,
  primary,
} from './ba-shared';

const SIZE = 10;

/** "82 / 100", green from 75, amber from 50, red below; "—" without enough data. */
export function HealthPill({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted">—</span>;
  return (
    <Badge tone={score >= 75 ? 'success' : score >= 50 ? 'warning' : 'danger'}>{score} / 100</Badge>
  );
}

/** /business-advisory/clients: every advisory client, searchable and filtered; opens design 3. */
export function AdvisoryClients() {
  const router = useRouter();
  const { act, toast, say } = useAct();
  const members = useMembers();
  const services = useApiQuery([...BA_KEY, 'services'], () => api.advisory.serviceOptions());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [advisor, setAdvisor] = useState('');
  const [stage, setStage] = useState('');
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ kind: 'client' } | { kind: 'goal'; clientId: string }>();
  const term = useDeferredValue(search.trim());
  const q = useApiQuery(
    [...BA_KEY, 'clients', term, status, serviceId, advisor, stage, archived, sort, page],
    () =>
      api.advisory.clients({
        ...(term ? { search: term } : {}),
        ...(status ? { status: status as never } : {}),
        ...(serviceId ? { serviceId } : {}),
        ...(advisor ? { advisorUserId: advisor } : {}),
        ...(stage ? { businessStage: stage } : {}),
        ...(archived ? { includeArchived: true } : {}),
        sort: sort as never,
        direction: sort === 'health' ? 'desc' : 'asc',
        page,
        pageSize: SIZE,
      }),
  );
  const filter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };

  const cols: Column<AdvisoryClientRow>[] = [
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
          {r.archived ? <Badge tone="neutral">Archived</Badge> : null}
        </span>
      ),
    },
    {
      id: 'business',
      label: 'Business Name',
      cell: (r) => <span className="text-link">{r.businessName ?? '—'}</span>,
    },
    {
      id: 'industry',
      label: 'Industry / Stage',
      cell: (r) => (
        <span className="flex flex-col leading-snug">
          <span>{r.industry ?? '—'}</span>
          <span className="text-muted">{r.businessStage ?? ''}</span>
        </span>
      ),
    },
    {
      id: 'service',
      label: 'Service Focus',
      cell: (r) => (
        <span className="flex flex-col leading-snug">
          <span>{r.primaryService?.name ?? '—'}</span>
          {r.additionalServiceCount ? (
            <span className="text-muted">+{r.additionalServiceCount} more</span>
          ) : null}
        </span>
      ),
    },
    { id: 'advisor', label: 'Advisor', cell: (r) => r.advisor?.name ?? '—' },
    {
      id: 'next',
      label: 'Next Meeting',
      className: 'whitespace-nowrap',
      cell: (r) => <DateTimeCell iso={r.nextMeetingAt} />,
    },
    {
      id: 'health',
      label: 'Health',
      className: 'whitespace-nowrap',
      cell: (r) => <HealthPill score={r.healthScore} />,
    },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (r) => <ClientStatusPill status={r.status} />,
    },
  ];

  return (
    <BaShell>
      {toast}
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Advisory clients"
        data-testid="ba-clients"
      >
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox value={search} onChange={filter(setSearch)} label="Search clients" />
          <FilterSelect
            label="Status"
            all="All Statuses"
            value={status}
            onChange={filter(setStatus)}
            options={Object.entries(CLIENT_STATUS).map(([value, label]) => ({ value, label }))}
          />
          <FilterSelect
            label="Service"
            all="All Services"
            value={serviceId}
            onChange={filter(setServiceId)}
            options={(services.data ?? []).map((s) => ({ value: s.serviceId, label: s.name }))}
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
          <FilterSelect
            label="Business stage"
            all="All Stages"
            value={stage}
            onChange={filter(setStage)}
            options={BUSINESS_STAGES.map((s) => ({ value: s, label: s }))}
            width="w-36"
          />
          <FilterSelect
            label="Sort by"
            all="Sort: Name"
            value={sort === 'name' ? '' : sort}
            onChange={(v) => filter(setSort)(v || 'name')}
            options={[
              { value: 'status', label: 'Sort: Status' },
              { value: 'nextMeeting', label: 'Sort: Next Meeting' },
              { value: 'health', label: 'Sort: Health' },
            ]}
            width="w-44"
          />
          <Checkbox
            label="Show archived"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setPage(1);
            }}
          />
          <button
            type="button"
            className={`${primary} ml-auto`}
            disabled={q.isError}
            onClick={() => setDialog({ kind: 'client' })}
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Add Advisory Client
          </button>
        </div>
        <Table
          rows={q.data?.items ?? []}
          columns={cols}
          rowKey={(r) => r.id}
          caption="Advisory clients"
          dense
          noun="clients"
          pageSize={SIZE}
          loading={q.isPending}
          emptyTitle={q.isError ? 'Advisory clients are not available' : 'No advisory clients'}
          emptyText={
            q.isError
              ? 'We could not load them. Try again in a moment.'
              : term || status || serviceId || advisor || stage
                ? 'Try another search or filter.'
                : 'Add an advisory client to start.'
          }
          rowActions={(r) => (
            <ActionMenu
              label={`Actions for ${r.client.name}`}
              trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
              sections={[
                {
                  items: [
                    {
                      label: 'Open Advisory Detail',
                      icon: Eye,
                      onSelect: () => router.push(`${BASE}/clients/${r.id}`),
                    },
                    {
                      label: 'Create Business Plan',
                      icon: FileText,
                      onSelect: () => router.push(`${BASE}/plans/new?advisoryClientId=${r.id}`),
                    },
                    {
                      label: 'Add Business Goal',
                      icon: Target,
                      onSelect: () => setDialog({ kind: 'goal', clientId: r.id }),
                    },
                    {
                      label: 'Schedule Meeting',
                      icon: CalendarDots,
                      onSelect: () => router.push('/calendar/new'),
                    },
                  ],
                },
                {
                  items: [
                    r.archived
                      ? {
                          label: 'Restore',
                          icon: ArrowCounterClockwise,
                          onSelect: () =>
                            void act(
                              () => api.advisory.restoreClient(r.id),
                              `${r.client.name} restored.`,
                            ),
                        }
                      : {
                          label: 'Archive',
                          icon: Archive,
                          danger: true,
                          onSelect: () =>
                            void act(
                              () => api.advisory.archiveClient(r.id),
                              `${r.client.name} archived.`,
                            ),
                        },
                  ],
                },
              ]}
            />
          )}
          server={serverPaging(q.data, SIZE, page, setPage)}
        />
      </section>
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
          advisoryClientId={dialog.clientId}
          onClose={() => setDialog(undefined)}
          onAdded={(title) => {
            setDialog(undefined);
            say(`Goal added: ${title}`);
          }}
        />
      ) : null}
    </BaShell>
  );
}
