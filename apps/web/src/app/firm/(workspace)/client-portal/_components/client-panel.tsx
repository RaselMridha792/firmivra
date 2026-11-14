'use client';

import type { ClientPortalHeader } from '@firmivra/types';
import { ActionMenu, Avatar, Badge, Button, Card, Skeleton, Tabs } from '@firmivra/ui';
import {
  ArrowSquareOut,
  ClockCounterClockwise,
  DotsThreeVertical,
  EnvelopeSimple,
  ShieldCheck,
  SlidersHorizontal,
  User,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { STAGES } from '../../clients/_components/list-parts';
import { headerKey, RECENT_KEY } from './keys';
import { PortalDocuments } from './documents-tab';
import { PortalForms } from './forms-tab';
import {
  PortalAppointments,
  PortalInvoices,
  PortalMessages,
  PortalTaxReturns,
} from './record-tabs';
import { PortalOverview } from './overview';

/** Frame 1's tabs (developer instructions 4): views of the same active client. */
export const PORTAL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'documents', label: 'Documents' },
  { id: 'messages', label: 'Messages' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'tax-returns', label: 'Tax Returns' },
  { id: 'invoices', label: 'Invoices & Payments' },
  { id: 'intake-forms', label: 'Intake Forms' },
] as const;
export type PortalTabId = (typeof PORTAL_TABS)[number]['id'];

/** The active client's header, tabs and the open tab: everything for this one client only. */
export function ClientPanel({
  clientId,
  tab,
  onTab,
}: {
  clientId: string;
  tab: PortalTabId;
  onTab: (tab: PortalTabId) => void;
}) {
  const header = useApiQuery(headerKey(clientId), () => api.clientPortal.get(clientId));
  const queryClient = useQueryClient();
  // Opening a client puts them first in Recent Clients (the API records it with the header).
  const loaded = header.isSuccess;
  useEffect(() => {
    if (loaded) void queryClient.invalidateQueries({ queryKey: RECENT_KEY });
  }, [loaded, clientId, queryClient]);
  return (
    <div className="@container flex min-w-0 flex-col gap-4" data-testid="client-panel">
      <PageState query={header}>
        {(h) =>
          h ? (
            <>
              <ClientHeader header={h} />
              <Card className="!p-0">
                <div className="px-4 pt-2">
                  <Tabs
                    label="Client portal"
                    variant="underline"
                    value={tab}
                    onChange={(id) => onTab(id as PortalTabId)}
                    items={PORTAL_TABS.map((t) => ({ id: t.id, label: t.label }))}
                  />
                </div>
                <div className="p-4">
                  {tab === 'overview' ? (
                    <PortalOverview clientId={clientId} onTab={onTab} />
                  ) : tab === 'documents' ? (
                    <PortalDocuments clientId={clientId} />
                  ) : tab === 'messages' ? (
                    <PortalMessages clientId={clientId} />
                  ) : tab === 'appointments' ? (
                    <PortalAppointments clientId={clientId} />
                  ) : tab === 'tax-returns' ? (
                    <PortalTaxReturns clientId={clientId} />
                  ) : tab === 'invoices' ? (
                    <PortalInvoices clientId={clientId} />
                  ) : (
                    <PortalForms clientId={clientId} />
                  )}
                </div>
              </Card>
            </>
          ) : (
            <Skeleton className="h-40" />
          )
        }
      </PageState>
    </div>
  );
}

/** Name, status, type, client since and ID, with the header's actions (instructions 3). */
export function ClientHeader({ header }: { header: ClientPortalHeader }) {
  const router = useRouter();
  const { client } = header;
  const stage = STAGES[client.status];
  const since = client.clientSince ? client.clientSince.slice(0, 4) : null;
  return (
    <Card data-testid="client-portal-header" className="min-w-0">
      {/* Octavia (Nov 14): with the sidebar expanded the name wrapped under the actions. The
          name stays on one line (the full name on hover), the badges never wrap, and the
          actions move to their own row when the panel is narrow. */}
      <div className="flex min-w-0 flex-col gap-4 @4xl:flex-row @4xl:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span className="shrink-0">
            <Avatar name={client.name} size="xl" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2
                className="min-w-0 truncate text-2xl font-bold text-heading"
                title={client.name}
                data-testid="client-portal-name"
              >
                {client.name}
              </h2>
              <span className="shrink-0 whitespace-nowrap">
                <Badge tone={stage.tone} dot>
                  {stage.label}
                </Badge>
              </span>
              {client.archived ? (
                <span className="shrink-0 whitespace-nowrap">
                  <Badge tone="neutral">Archived</Badge>
                </span>
              ) : null}
            </div>
            <p className="mt-1 truncate text-sm text-muted">
              {client.accountType === 'BUSINESS' ? 'Business' : 'Individual'}
              {since ? ` | Client Since ${since}` : ''} | ID: {client.number}
            </p>
          </div>
        </div>
        <div
          className="flex shrink-0 flex-wrap items-center gap-2"
          data-testid="client-portal-actions"
        >
          <Button
            data-testid="open-client-portal"
            onClick={() => router.push(`/client-portal/${client.id}/preview`)}
          >
            <ArrowSquareOut aria-hidden className="size-4" /> Open Client Portal
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push(`/messages/new?clientId=${encodeURIComponent(client.id)}`)}
          >
            <EnvelopeSimple aria-hidden className="size-4" /> Send Message
          </Button>
          <Button variant="outline" onClick={() => router.push(`/clients/${client.id}`)}>
            <User aria-hidden className="size-4" /> View Profile
          </Button>
          <ActionMenu
            label="More portal actions"
            align="right"
            trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
            sections={[
              {
                items: [
                  {
                    label: 'Portal Management',
                    icon: SlidersHorizontal,
                    onSelect: () => router.push(`/client-portal/${client.id}`),
                  },
                  {
                    label: 'Access & Security',
                    icon: ShieldCheck,
                    onSelect: () => router.push(`/client-portal/${client.id}/access`),
                  },
                  {
                    label: 'View Activity History',
                    icon: ClockCounterClockwise,
                    onSelect: () => router.push(`/client-portal/${client.id}/activity`),
                  },
                ],
              },
            ]}
          />
        </div>
      </div>
    </Card>
  );
}
