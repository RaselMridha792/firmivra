'use client';

import type { ClientPortalHeader, PendingClientAction, PortalModule } from '@firmivra/types';
import { PORTAL_MODULE_LABELS } from '@firmivra/types';
import { Button, Card, Modal, Textarea, Toggle } from '@firmivra/ui';
import type { Icon } from '@phosphor-icons/react';
import {
  CalendarBlank,
  CaretRight,
  ClipboardText,
  Clock,
  Copy,
  CurrencyDollar,
  Eye,
  FileText,
  Key,
  Lightning,
  LinkSimple,
  LockSimple,
  LockSimpleOpen,
  PaperPlaneTilt,
  PencilSimple,
  ProhibitInset,
  UserPlus,
  WarningCircle,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { NotesCard } from '../../../clients/[id]/messages/_components/notes-card';
import { activityOf, dayText, timeText } from '../activity-labels';
import { headerKey } from '../keys';
import { useClientHeader } from './client-shell';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Frame 2's Overview (individual-client-portal-management-access-and-visibility.jpg). */
export function ManagementOverview({ clientId }: { clientId: string }) {
  const header = useClientHeader(clientId);
  return (
    <PageState query={header}>
      {(h) => (
        <div className="flex flex-col gap-6">
          <div className="grid items-start gap-6 xl:grid-cols-3">
            <PendingActionsCard clientId={clientId} />
            <VisibilityCard clientId={clientId} canChange={h.can.manageAccess} compact />
            <div className="flex flex-col gap-6">
              <QuickActions header={h} />
              <PortalLinkCard link={h.portal.link} />
            </div>
          </div>
          <div className="grid items-start gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <PortalActivityCard clientId={clientId} limit={5} />
            </div>
            <NotesCard clientId={clientId} title="Client Notes (Internal Only)" />
          </div>
        </div>
      )}
    </PageState>
  );
}

const PENDING: Record<
  PendingClientAction['kind'],
  {
    icon: Icon;
    label: (n: number) => string;
    href: (a: PendingClientAction, client: string) => string;
  }
> = {
  DOCUMENTS_REQUESTED: {
    icon: FileText,
    label: (n) => `Document${n === 1 ? '' : 's'} Requested`,
    href: (_a, c) => `/clients/${c}/documents`,
  },
  INTAKE_INCOMPLETE: {
    icon: ClipboardText,
    label: () => 'Intake Form Incomplete',
    href: (_a, c) => `/clients/${c}/intake-forms`,
  },
  INTAKE_SUBMITTED: {
    icon: ClipboardText,
    label: () => 'Submitted - Needs Review',
    href: (_a, c) => `/clients/${c}/intake-forms`,
  },
  SIGNATURE_REQUIRED: {
    icon: PencilSimple,
    label: () => 'Signature Required',
    href: (_a, c) => `/clients/${c}/signatures`,
  },
  INVOICE_OUTSTANDING: {
    icon: CurrencyDollar,
    label: () => 'Outstanding',
    href: (a) => `/invoices/${a.recordId}`,
  },
  APPOINTMENT_UPCOMING: {
    icon: CalendarBlank,
    label: () => 'Upcoming Appointment',
    href: (a) => `/calendar/${a.recordId}`,
  },
  TASK_OPEN: {
    icon: ClipboardText,
    label: () => 'Task / Request',
    href: (a) => `/tasks/${a.recordId}`,
  },
};

/** What waits on the client (instructions 17): each row opens the canonical record. */
export function PendingActionsCard({ clientId }: { clientId: string }) {
  const pending = useApiQuery(['client-portal', 'pending', clientId], () =>
    api.clientPortal.pendingActions(clientId),
  );
  return (
    <Card data-testid="pending-actions" className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <WarningCircle aria-hidden weight="fill" className="size-6 text-danger" />
        <h2 className="flex-1 text-lg font-semibold text-heading">Pending Client Actions</h2>
      </div>
      <PageState
        query={pending}
        empty="Nothing is waiting on this client."
        isEmpty={(d) => d.items.length === 0}
      >
        {(d) => (
          <ul className="flex flex-col divide-y divide-divider">
            {d.items.map((a) => {
              const kind = PENDING[a.kind];
              const Glyph = kind.icon;
              const lead =
                a.kind === 'INVOICE_OUTSTANDING' && a.amountCents !== null
                  ? `${money.format(a.amountCents / 100)} ${kind.label(a.count)}`
                  : `${a.count} ${kind.label(a.count)}`;
              const detail = [
                a.kind === 'INVOICE_OUTSTANDING' ? `Invoice ${a.title}` : a.title,
                a.at ? dayText(a.at) : a.dueOn ? `Due ${dayText(`${a.dueOn}T12:00:00Z`)}` : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={a.kind}>
                  <Link
                    href={kind.href(a, clientId)}
                    className="flex items-center gap-3 py-3 hover:bg-canvas"
                    data-testid={`pending-${a.kind}`}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info">
                      <Glyph aria-hidden className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-heading">{lead}</span>
                      <span
                        className={`block truncate text-sm ${a.overdue ? 'text-danger' : 'text-muted'}`}
                      >
                        {detail}
                        {a.overdue ? ' · Overdue' : ''}
                      </span>
                    </span>
                    <CaretRight aria-hidden className="size-4 text-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PageState>
    </Card>
  );
}

/**
 * Portal Content & Visibility (instructions 16): what this client sees, on top of the firm's
 * switches. Owner and Admin switch an area; it never deletes a record.
 */
export function VisibilityCard({
  clientId,
  canChange,
  compact = false,
}: {
  clientId: string;
  canChange: boolean;
  compact?: boolean;
}) {
  const key = ['client-portal', 'visibility', clientId];
  const visibility = useApiQuery(key, () => api.clientPortal.visibility(clientId));
  const save = useApiMutation(
    (change: { module: PortalModule; on: boolean }) =>
      api.clientPortal.setVisibility(clientId, { areas: { [change.module]: change.on } }),
    { invalidate: key },
  );
  return (
    <Card data-testid="portal-visibility" className="min-w-0">
      <div className="mb-1 flex items-center gap-2">
        <Eye aria-hidden weight="fill" className="size-6 text-action" />
        <h2 className="flex-1 text-lg font-semibold text-heading">
          Portal Content &amp; Visibility
        </h2>
        {compact ? (
          <Link
            href={`/client-portal/${clientId}/content`}
            className="text-sm font-medium text-action underline"
          >
            Edit
          </Link>
        ) : null}
      </div>
      <p className="mb-3 text-sm text-muted">
        Select what this client can see and access in their portal.
      </p>
      <PageState query={visibility}>
        {(v) => (
          <ul className="flex flex-col divide-y divide-divider">
            {v.areas.map((a) => (
              <li key={a.module} className="flex items-center gap-3 py-2">
                <span className="flex-1 text-sm text-text">{PORTAL_MODULE_LABELS[a.module]}</span>
                {!a.firmOn ? (
                  <span className="text-xs text-muted">Off for the firm</span>
                ) : (
                  <>
                    <Toggle
                      label={`${PORTAL_MODULE_LABELS[a.module]} visible to this client`}
                      checked={a.clientOn}
                      disabled={!canChange || save.isPending}
                      onChange={(on) => save.mutate({ module: a.module, on })}
                    />
                    <span className={`w-14 text-sm ${a.visible ? 'text-success' : 'text-muted'}`}>
                      {a.visible ? 'Visible' : 'Hidden'}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageState>
      {save.error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(save.error)}
        </p>
      ) : null}
      {!canChange ? (
        <p className="mt-2 text-xs text-muted">
          Only an Owner or Admin changes what the client sees.
        </p>
      ) : null}
    </Card>
  );
}

type Confirm = 'reset' | 'lock' | 'deactivate' | null;

/** Quick Actions (instructions 15): each audited by the API; Owner and Admin for access. */
export function QuickActions({ header }: { header: ClientPortalHeader }) {
  const queryClient = useQueryClient();
  const clientId = header.client.id;
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: headerKey(clientId) }),
      queryClient.invalidateQueries({ queryKey: ['client-portal', 'activity', clientId] }),
    ]);
  const act = useApiMutation(async (kind: string) => {
    switch (kind) {
      case 'invite':
        await api.portalInvitations.send(clientId, { confirm: true });
        return 'Portal invitation sent.';
      case 'reset':
        await api.clientPortal.resetAccess(clientId);
        return 'Access reset sent: the client gets a reset code by email.';
      case 'lock':
        await api.clientPortal.lock(clientId, reason.trim() ? { reason: reason.trim() } : {});
        return 'Portal access locked. The client is signed out everywhere.';
      case 'unlock':
        await api.clientPortal.unlock(clientId);
        return 'Portal access unlocked.';
      case 'deactivate':
        await api.clientPortal.deactivate(clientId);
        return 'Portal deactivated. Records and history are kept.';
      default:
        await api.clientPortal.reactivate(clientId);
        return 'Portal reactivated.';
    }
  });
  const run = (kind: string) =>
    act.mutate(kind, {
      onSuccess: (message) => {
        setConfirm(null);
        setReason('');
        setNotice(message);
        void refresh();
      },
    });
  const manage = header.can.manageAccess;
  const locked = header.portal.lock.locked;
  const deactivated = header.portal.status === 'DEACTIVATED';
  const hasLogin = header.portal.logins.some((l) => l.status === 'ACTIVE');
  const canInvite = header.can.invite && header.portal.invitationBlocked === null;
  const item = (
    label: string,
    icon: Icon,
    onClick: () => void,
    opts: { danger?: boolean; testId: string },
  ) => {
    const Glyph = icon;
    return (
      <Button
        variant="outline"
        className={`w-full !justify-start ${opts.danger ? '!border-danger !text-danger' : ''}`}
        data-testid={opts.testId}
        disabled={act.isPending}
        onClick={onClick}
      >
        <Glyph aria-hidden className="size-5" /> {label}
      </Button>
    );
  };
  return (
    <Card data-testid="quick-actions" className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <Lightning aria-hidden weight="fill" className="size-6 text-action" />
        <h2 className="text-lg font-semibold text-heading">Quick Actions</h2>
      </div>
      <div className="flex flex-col gap-2">
        {canInvite
          ? item(
              header.portal.invitation ? 'Resend Portal Invitation' : 'Send Portal Invitation',
              PaperPlaneTilt,
              () => run('invite'),
              { testId: 'action-invite' },
            )
          : null}
        {manage && hasLogin
          ? item('Reset Client Access', Key, () => setConfirm('reset'), { testId: 'action-reset' })
          : null}
        {manage
          ? locked
            ? item('Unlock Portal Access', LockSimpleOpen, () => run('unlock'), {
                testId: 'action-unlock',
              })
            : item('Lock Portal Access', LockSimple, () => setConfirm('lock'), {
                testId: 'action-lock',
              })
          : null}
        {manage
          ? deactivated
            ? item('Reactivate Portal', UserPlus, () => run('reactivate'), {
                testId: 'action-reactivate',
              })
            : hasLogin
              ? item('Deactivate Portal', ProhibitInset, () => setConfirm('deactivate'), {
                  danger: true,
                  testId: 'action-deactivate',
                })
              : null
          : null}
        <Link
          href={`/client-portal/${clientId}/access#login-history`}
          className="flex min-h-11 items-center gap-2 rounded-control border border-divider px-4 text-sm font-medium text-action hover:bg-canvas"
        >
          <Clock aria-hidden className="size-5" /> View Login History
        </Link>
      </div>
      {notice ? (
        <p role="status" className="mt-3 text-sm text-success">
          {notice}
        </p>
      ) : null}
      {act.error && !confirm ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {errorMessage(act.error)}
        </p>
      ) : null}
      <Modal
        open={confirm !== null}
        title={
          confirm === 'lock'
            ? 'Lock portal access?'
            : confirm === 'deactivate'
              ? 'Deactivate this portal?'
              : 'Reset client access?'
        }
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              data-testid="confirm-action"
              disabled={act.isPending}
              onClick={() => confirm && run(confirm)}
            >
              {confirm === 'lock'
                ? 'Lock Access'
                : confirm === 'deactivate'
                  ? 'Deactivate'
                  : 'Send Reset'}
            </Button>
          </>
        }
      >
        <p className="text-text">
          {confirm === 'lock'
            ? `${header.client.name} can't sign in, and every session ends now. Records and history are kept; unlock to restore access.`
            : confirm === 'deactivate'
              ? `Every active portal login of ${header.client.name} is turned off. Records and history are kept; reactivate to restore them.`
              : `${header.client.name} gets the portal's password reset code by email. Their password is never shown.`}
        </p>
        {confirm === 'lock' ? (
          <div className="mt-3">
            <Textarea
              label="Reason (staff only, optional)"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        ) : null}
        {act.error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {errorMessage(act.error)}
          </p>
        ) : null}
      </Modal>
    </Card>
  );
}

/** Portal Link for This Client, with Copy Link. */
export function PortalLinkCard({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card data-testid="portal-link" className="min-w-0">
      <div className="mb-2 flex items-center gap-2">
        <LinkSimple aria-hidden weight="bold" className="size-6 text-action" />
        <h2 className="text-lg font-semibold text-heading">Portal Link for This Client</h2>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-action">{link}</span>
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
          }}
        >
          <Copy aria-hidden className="size-4" /> {copied ? 'Copied' : 'Copy Link'}
        </Button>
      </div>
    </Card>
  );
}

/** Recent Portal Activity, with the IP for Owner and Admin (the API leaves it out for others). */
export function PortalActivityCard({ clientId, limit }: { clientId: string; limit: number }) {
  const activity = useApiQuery(['client-portal', 'activity', clientId, 'card', limit], () =>
    api.clientPortal.activity(clientId, { limit }),
  );
  return (
    <Card data-testid="portal-activity" className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <Clock aria-hidden weight="bold" className="size-6 text-action" />
        <h2 className="flex-1 text-lg font-semibold text-heading">Recent Portal Activity</h2>
        <Link
          href={`/client-portal/${clientId}/activity`}
          className="text-sm font-medium text-action underline"
        >
          View All
        </Link>
      </div>
      <PageState
        query={activity}
        empty="No portal activity recorded yet."
        isEmpty={(p) => p.items.length === 0}
      >
        {(p) => <ActivityRows items={p.items} />}
      </PageState>
    </Card>
  );
}

export function ActivityRows({
  items,
}: {
  items: {
    id: string;
    at: string;
    type: string;
    actor: { kind: string; name: string | null };
    ip: string | null;
  }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-muted">
          <tr>
            <th className="py-2 pr-4 font-medium">Date / Time</th>
            <th className="py-2 pr-4 font-medium">Activity</th>
            <th className="py-2 pr-4 font-medium">By</th>
            <th className="py-2 font-medium">IP Address</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => {
            const kind = activityOf(e.type);
            const Glyph = kind.icon;
            return (
              <tr key={e.id} className="border-t border-divider">
                <td className="py-2 pr-4 whitespace-nowrap text-text">
                  {dayText(e.at)} <span className="text-muted">{timeText(e.at)}</span>
                </td>
                <td className="py-2 pr-4">
                  <span className="flex items-center gap-2 text-text">
                    <Glyph aria-hidden className="size-4 text-action" /> {kind.label}
                  </span>
                </td>
                <td className="py-2 pr-4 text-muted">
                  {e.actor.name ?? (e.actor.kind === 'CLIENT' ? 'Client' : 'Firmivra')}
                </td>
                <td className="py-2 text-muted">{e.ip ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
