'use client';

import type { AdvisoryDeliverable } from '@firmivra/types';
import { Badge, Table, type Column } from '@firmivra/ui';
import { Briefcase, CheckCircle, SealCheck } from '@phosphor-icons/react';
import Link from 'next/link';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { BASE, BA_KEY, SectionHead, card, dayText, quiet } from './ba-shared';
import { ClientShell, WORKSTREAM_STATUS } from './client-shell';

const CHANNEL: Record<string, string> = {
  portal: 'Client portal',
  email: 'Email',
  download: 'Download',
};

/**
 * /business-advisory/clients/[clientId]/services (A-X14, Business Advisory Review Two B35): the
 * client's Services & Deliverables. Their advisory services In Progress and Completed, each with
 * its dates, who carries it out, its files (the client's Documents tab, on that service) and the
 * service's workspace; and Plans Delivered, the plan versions the client received, each opening
 * its plan. Services are added and changed on the Overview (Edit Client).
 */
export function ClientDeliverablesTab({ advisoryClientId }: { advisoryClientId: string }) {
  const q = useApiQuery([...BA_KEY, 'client-deliverables', advisoryClientId], () =>
    api.advisory.deliverables(advisoryClientId),
  );
  const base = `${BASE}/clients/${advisoryClientId}`;
  const cols = (done: boolean): Column<AdvisoryDeliverable>[] => [
    {
      id: 'service',
      label: 'Service',
      cell: (d) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-heading">{d.serviceName}</span>
          {d.role === 'PRIMARY' ? <Badge tone="info">Primary focus</Badge> : null}
          {d.packageName ? <span className="text-xs text-muted">{d.packageName}</span> : null}
        </span>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (d) => WORKSTREAM_STATUS[d.status] ?? d.status,
    },
    {
      id: 'started',
      label: 'Started',
      className: 'whitespace-nowrap',
      cell: (d) => dayText(d.startedOn),
    },
    ...(done
      ? [
          {
            id: 'completed',
            label: 'Completed',
            className: 'whitespace-nowrap',
            cell: (d: AdvisoryDeliverable) => dayText(d.completedOn),
          },
        ]
      : []),
    { id: 'staff', label: 'Staff', cell: (d) => d.staff?.name ?? '—' },
    {
      id: 'files',
      label: 'Files',
      className: 'whitespace-nowrap',
      cell: (d) =>
        d.engagementId ? (
          <Link
            href={`${base}/documents?serviceId=${d.engagementId}`}
            className="text-link hover:underline"
            aria-label={`Files of ${d.serviceName}`}
          >
            {d.fileCount === 1 ? '1 file' : `${d.fileCount} files`}
          </Link>
        ) : (
          '—'
        ),
    },
    {
      id: 'open',
      label: 'Links',
      className: 'whitespace-nowrap',
      cell: (d) =>
        d.engagementId ? (
          <Link
            href={`/workspaces/${d.engagementId}`}
            className="text-link hover:underline"
            aria-label={`Open the service: ${d.serviceName}`}
          >
            Open Service
          </Link>
        ) : (
          <span className="text-muted">Not started</span>
        ),
    },
  ];
  const table = (done: boolean, rows: AdvisoryDeliverable[]) => (
    <Table
      rows={rows}
      columns={cols(done)}
      rowKey={(d) => d.workstreamId}
      caption={done ? 'Completed services' : 'Services in progress'}
      dense
      noun="services"
      loading={q.isPending}
      emptyTitle={
        q.isError
          ? 'Services are not available'
          : done
            ? 'No completed services'
            : 'No services in progress'
      }
      emptyText={
        q.isError
          ? 'We could not load them. Try again in a moment.'
          : done
            ? 'A service shows here once it is completed.'
            : 'A service shows here once it is accepted or under way (the Overview lists every service).'
      }
    />
  );
  const delivered = q.data?.plansDelivered ?? [];
  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Services in progress"
        data-testid="deliverables-in-progress"
      >
        <SectionHead
          icon={Briefcase}
          title="In Progress"
          subtitle="The client's advisory services under way: who carries them out, their files and their workspace."
        />
        {table(false, q.data?.inProgress ?? [])}
      </section>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Completed services"
        data-testid="deliverables-completed"
      >
        <SectionHead icon={CheckCircle} title="Completed" subtitle="Services that are done." />
        {table(true, q.data?.completed ?? [])}
      </section>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Plans delivered"
        data-testid="deliverables-plans"
      >
        <SectionHead
          icon={SealCheck}
          title="Plans Delivered"
          subtitle="Each plan version the client received; later edits never change a delivered version."
        />
        {delivered.length ? (
          <ul className="divide-y divide-divider">
            {delivered.map((p) => (
              <li
                key={`${p.planId}:${p.versionNo}`}
                className="flex flex-wrap items-center gap-2 py-2 text-sm"
              >
                <Link
                  href={`${BASE}/plans/${p.planId}/edit/review`}
                  className="min-w-40 flex-1 font-semibold text-link hover:underline"
                >
                  {p.planName}
                </Link>
                <span className="text-muted">Version {p.versionNo}</span>
                <span className="text-muted">
                  {CHANNEL[p.channel ?? ''] ?? 'Delivered'}, {dayText(p.deliveredAt.slice(0, 10))}
                </span>
                {p.by ? <span className="text-muted">by {p.by.name}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={quiet}>
            {q.isError
              ? 'Not available right now.'
              : q.isPending
                ? 'Loading…'
                : 'No plan has been delivered yet.'}
          </p>
        )}
      </section>
    </ClientShell>
  );
}
