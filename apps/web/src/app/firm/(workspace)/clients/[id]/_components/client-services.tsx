'use client';

import type { ClientService, ClientServiceWorkspace, EngagementStatus } from '@firmivra/types';
import { Badge, Card } from '@firmivra/ui';
import Link from 'next/link';
import { OriginLink } from '../../../../../../components/origin-link';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { dateText } from '../../_components/client-parts';

// Octavia's E4: the client's services (GET /business/clients/{id}/services) on the profile: the
// Services tab, Overview's Active Services and the service tabs. A service opens its module's
// record (a tax return, the bookkeeping or payroll client, the tax plan, the advisory client) with
// Back to the client; the API leaves it closed when the member's grid has no VIEW there.

export const MODULE_LABEL: Record<ClientServiceWorkspace['module'], string> = {
  TAX_RETURNS: 'Tax Returns',
  BOOKKEEPING: 'Bookkeeping',
  PAYROLL: 'Payroll',
  TAX_PLANNING: 'Tax Planning',
  BUSINESS_ADVISORY: 'Advisory',
};
const ORDER = Object.keys(MODULE_LABEL) as ClientServiceWorkspace['module'][];

export const STATUS: Record<
  EngagementStatus,
  { label: string; tone: 'success' | 'info' | 'neutral' | 'danger' }
> = {
  PENDING: { label: 'Pending', tone: 'info' },
  ACTIVE: { label: 'Active', tone: 'success' },
  COMPLETED: { label: 'Completed', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
};

/** Enrolled: the service is under way or about to start. */
export const enrolled = (s: ClientService) => s.status === 'PENDING' || s.status === 'ACTIVE';

/** Where a service opens: its record in the module, or the module's list when it has none. */
export function workspaceHref(w: ClientServiceWorkspace): string {
  switch (w.module) {
    case 'TAX_RETURNS':
      return w.id ? `/tax-returns/${w.id}` : '/tax-returns';
    case 'BOOKKEEPING':
      return w.id ? `/bookkeeping/clients/${w.id}` : '/bookkeeping';
    case 'PAYROLL':
      return w.id ? `/payroll/clients/${w.id}` : '/payroll';
    case 'TAX_PLANNING':
      return w.id ? `/tax-planning/plans/${w.id}` : '/tax-planning';
    case 'BUSINESS_ADVISORY':
      return w.id ? `/business-advisory/clients/${w.id}` : '/business-advisory';
  }
}

export function useClientServices(clientId: string) {
  return useApiQuery(['clients', clientId, 'services'], () => api.clients.services(clientId));
}

/**
 * The service tabs: one per module the client is enrolled in and the member may open, on the
 * newest enrollment's record, in the sidebar's order.
 */
export function serviceTabs(items: ClientService[] | undefined): { label: string; href: string }[] {
  const first = new Map<ClientServiceWorkspace['module'], ClientServiceWorkspace>();
  for (const s of items ?? []) {
    if (enrolled(s) && s.workspace && !first.has(s.workspace.module)) {
      first.set(s.workspace.module, s.workspace);
    }
  }
  return ORDER.filter((m) => first.has(m)).map((m) => ({
    label: MODULE_LABEL[m],
    href: workspaceHref(first.get(m)!),
  }));
}

function OpenLink({ service }: { service: ClientService }) {
  return service.workspace ? (
    <OriginLink
      href={workspaceHref(service.workspace)}
      className="text-sm font-medium text-link hover:underline"
    >
      Open {MODULE_LABEL[service.workspace.module]}
    </OriginLink>
  ) : null;
}

/** Overview's Active Services: enrolled services, with their status and the way into each. */
export function ActiveServicesCard({ clientId }: { clientId: string }) {
  const q = useClientServices(clientId);
  const active = (q.data ?? []).filter(enrolled);
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center justify-between gap-2">
          Active Services
          <Link
            href={`/clients/${clientId}/services`}
            className="text-sm font-medium text-link hover:underline"
          >
            All Services
          </Link>
        </span>
      }
    >
      <div data-testid="active-services">
        {q.isError ? (
          <p role="alert" className="text-sm text-danger">
            Services are not available right now.
          </p>
        ) : q.isPending ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : active.length === 0 ? (
          <p className="text-sm text-muted">Not enrolled in a service yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {active.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium wrap-anywhere text-text">
                    {s.service.name}
                  </span>
                  <span className="block text-xs text-muted">Since {dateText(s.since)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                  <OpenLink service={s} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** The Services tab: every service, its status, who works it, and the way into it. */
export function ServicesTable({ clientId }: { clientId: string }) {
  const q = useClientServices(clientId);
  const items = q.data ?? [];
  return (
    <Card title="Services">
      <div data-testid="client-services">
        {q.isError ? (
          <p role="alert" className="text-sm text-danger">
            Services are not available right now.
          </p>
        ) : q.isPending ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">
            No services yet. Enroll the client in a service from Services &amp; Pricing.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">The client&apos;s services</caption>
              <thead className="bg-table-head">
                <tr>
                  {['Service', 'Engagement', 'Status', 'Since', 'Assigned', ''].map((h) => (
                    <th key={h || 'open'} scope="col" className="px-3 py-2 font-medium">
                      {h || <span className="sr-only">Open</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} className="border-b border-divider" data-testid="client-service">
                    <td className="px-3 py-2 font-medium text-text">{s.service.name}</td>
                    <td className="px-3 py-2 wrap-anywhere text-text">{s.title}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-text">{dateText(s.since)}</td>
                    <td className="px-3 py-2 text-text">{s.assignedTo?.name ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <OpenLink service={s} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
