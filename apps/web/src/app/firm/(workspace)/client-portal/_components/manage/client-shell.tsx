'use client';

import type { ClientPortalHeader, ClientPortalStatus } from '@firmivra/types';
import { Avatar, Badge, Button, Card } from '@firmivra/ui';
import type { Icon } from '@phosphor-icons/react';
import {
  ArrowLeft,
  ArrowSquareOut,
  CalendarBlank,
  CaretRight,
  Clock,
  EnvelopeSimple,
  ShieldCheck,
  User,
  UserCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { activityOf, dayText, timeText } from '../activity-labels';
import { ClientSwitcher } from '../client-portal-screen';
import { headerKey } from '../keys';

/** Frame 2's tabs (developer instructions 13 and 14), each a page of the same client. */
export const MANAGE_TABS = [
  { path: '', label: 'Overview' },
  { path: '/access', label: 'Access & Security' },
  { path: '/content', label: 'Portal Content' },
  { path: '/documents', label: 'Documents' },
  { path: '/forms', label: 'Forms & Requests' },
  { path: '/communications', label: 'Communications' },
  { path: '/activity', label: 'Activity' },
] as const;

export const PORTAL_STATUS: Record<
  ClientPortalStatus,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }
> = {
  ACTIVE: { label: 'Active Portal', tone: 'success' },
  LOCKED: { label: 'Locked', tone: 'danger' },
  DEACTIVATED: { label: 'Deactivated', tone: 'danger' },
  PENDING_APPROVAL: { label: 'Pending Approval', tone: 'warning' },
  INVITATION_PENDING: { label: 'Invitation Pending', tone: 'info' },
  NOT_ACTIVATED: { label: 'Not Activated', tone: 'neutral' },
};

export const useClientHeader = (clientId: string) =>
  useApiQuery(headerKey(clientId), () => api.clientPortal.get(clientId));

/**
 * Every individual-client page of the Client Portal module (Frame 2; developer instructions 13
 * and 14): breadcrumbs, Back to All Clients and Switch Client, the header and its status strip,
 * and the tabs. Switching stays on the same tab for the new client.
 */
export function ClientShell({ clientId, children }: { clientId: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const base = `/client-portal/${clientId}`;
  const suffix = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  const previewing = suffix === '/preview';
  const current = MANAGE_TABS.find((t) => t.path === suffix) ?? MANAGE_TABS[0];
  const header = useClientHeader(clientId);
  // TX-F04: opened from elsewhere (a tax return), the way back stays on every tab.
  const from = useSearchParams().get('from');
  const keep = (href: string) => (from ? `${href}?from=${encodeURIComponent(from)}` : href);
  return (
    <div className="flex flex-col gap-4" data-testid="client-portal-manage">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/client-portal" className="text-action hover:underline">
              Client Portal
            </Link>
          </li>
          <CaretRight aria-hidden className="size-3" />
          <li>
            <Link href="/client-portal" className="text-action hover:underline">
              Clients
            </Link>
          </li>
          <CaretRight aria-hidden className="size-3" />
          <li>
            <Link
              href={`/client-portal?client=${clientId}`}
              className="text-action hover:underline"
            >
              {header.data?.client.name ?? 'Client'}
            </Link>
          </li>
          <CaretRight aria-hidden className="size-3" />
          <li aria-current="page" className="font-medium text-heading">
            {previewing
              ? 'Portal Preview'
              : current.path === ''
                ? 'Portal Management'
                : current.label}
          </li>
        </ol>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => router.push('/client-portal')}>
          <ArrowLeft aria-hidden className="size-4" /> Back to All Clients
        </Button>
        <div className="w-full max-w-sm">
          <ClientSwitcher
            activeId={clientId}
            onSelect={(id) =>
              router.push(keep(`/client-portal/${id}${previewing ? '/preview' : current.path}`))
            }
          />
        </div>
      </div>
      <PageState query={header}>
        {(h) => (
          <>
            <ManageHeader header={h} />
            <StatusStrip header={h} />
          </>
        )}
      </PageState>
      <nav aria-label="Client portal management" className="overflow-x-auto overflow-y-hidden">
        <ul className="flex min-w-max gap-1 rounded-card border border-divider bg-surface p-1">
          {MANAGE_TABS.map((t) => {
            const on = !previewing && t.path === current.path;
            return (
              <li key={t.label}>
                <Link
                  href={keep(`${base}${t.path}`)}
                  aria-current={on ? 'page' : undefined}
                  className={`block rounded-lg px-4 py-2 text-sm font-medium ${on ? 'bg-action text-on-action' : 'text-text hover:bg-canvas'}`}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {/* Keyed by the client: nothing of the previous client stays after a switch. */}
      <div key={clientId}>{children}</div>
    </div>
  );
}

function ManageHeader({ header }: { header: ClientPortalHeader }) {
  const router = useRouter();
  const { client, portal } = header;
  const status = PORTAL_STATUS[portal.status];
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid="manage-header">
      <Avatar name={client.name} size="xl" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
            {client.name}
          </h1>
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-action">
          Client ID: {client.number}
          {client.email ? ` | ${client.email}` : ''}
          {client.phone ? ` | ${client.phone}` : ''} |{' '}
          {client.accountType === 'BUSINESS' ? 'Business Client' : 'Individual Client'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => router.push(`/client-portal/${client.id}/preview`)}>
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
      </div>
    </div>
  );
}

/** "1 year, 9 months" since a date. */
function since(iso: string): string {
  const from = new Date(iso);
  const now = new Date();
  let months = (now.getFullYear() - from.getFullYear()) * 12 + now.getMonth() - from.getMonth();
  if (now.getDate() < from.getDate()) months -= 1;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const part = (n: number, unit: string) => (n ? `${n} ${unit}${n === 1 ? '' : 's'}` : '');
  return [part(years, 'year'), part(rest, 'month')].filter(Boolean).join(', ') || 'This month';
}

/** Portal Status, Last Login, Portal Since, Last Activity, MFA and Access Method (instructions 14). */
function StatusStrip({ header }: { header: ClientPortalHeader }) {
  const { portal, client } = header;
  const status = PORTAL_STATUS[portal.status];
  const when = (iso: string | null, below: (iso: string) => string, none: string) =>
    iso ? (
      <p className="text-text">
        <span className="block font-semibold">{dayText(iso)}</span>
        <span className="text-sm text-muted">{below(iso)}</span>
      </p>
    ) : (
      <p className="text-sm text-muted">{none}</p>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" data-testid="status-strip">
      <Tile label="Portal Status">
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
      </Tile>
      <Tile label="Last Login" icon={CalendarBlank}>
        {when(portal.lastLogin, timeText, 'No sign-in yet')}
      </Tile>
      <Tile label="Portal Since" icon={CalendarBlank}>
        {when(portal.portalSince, since, 'Not activated')}
      </Tile>
      <Tile label="Last Activity" icon={Clock}>
        {when(
          portal.lastActivity?.at ?? null,
          () => (portal.lastActivity ? activityOf(portal.lastActivity.type).label : ''),
          'None recorded yet',
        )}
      </Tile>
      <Tile label="MFA" icon={ShieldCheck}>
        {portal.mfa === 'ENABLED' ? (
          <Badge tone="success">Enabled</Badge>
        ) : portal.mfa === 'NOT_ENROLLED' ? (
          <Badge tone="neutral">Not enrolled</Badge>
        ) : (
          <p className="text-sm text-muted">No login</p>
        )}
      </Tile>
      <Tile
        label="Access Method"
        icon={UserCircle}
        extra={
          <Link
            href={`/client-portal/${client.id}/access`}
            className="text-sm font-medium text-action underline"
          >
            Edit
          </Link>
        }
      >
        <p className="text-sm text-text">
          {portal.logins.length === 0
            ? 'No login yet'
            : portal.mfa === 'ENABLED'
              ? 'Email + Password + Authenticator'
              : 'Email + Password'}
        </p>
      </Tile>
    </div>
  );
}

function Tile({
  label,
  icon: Glyph,
  extra,
  children,
}: {
  label: string;
  icon?: Icon;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="!p-4">
      <div className="flex items-start gap-3">
        {Glyph ? (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info">
            <Glyph aria-hidden className="size-5" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-heading">{label}</p>
          {children}
        </div>
        {extra}
      </div>
    </Card>
  );
}
