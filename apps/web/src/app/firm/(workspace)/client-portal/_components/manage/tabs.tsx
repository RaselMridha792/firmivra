'use client';

import type {
  ClientPortalActivityItem,
  ClientPortalLoginItem,
  PortalLoginEvent,
} from '@firmivra/types';
import { Badge, Button, Card, Input, Modal, Select } from '@firmivra/ui';
import { EnvelopeSimple, ShieldCheck, ShieldWarning } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { dayText, timeText } from '../activity-labels';
import { headerKey } from '../keys';
import { useClientHeader } from './client-shell';
import { ActivityRows, QuickActions, VisibilityCard } from './overview';

const INVITATION: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }
> = {
  OPEN: { label: 'Sent', tone: 'info' },
  ACCEPTED: { label: 'Accepted / Activated', tone: 'success' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
  REVOKED: { label: 'Revoked', tone: 'neutral' },
  NOT_SENT: { label: 'Not delivered', tone: 'danger' },
};

const LOGIN_EVENT: Record<
  PortalLoginEvent,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  SIGNED_IN: { label: 'Successful login', tone: 'success' },
  SIGNED_OUT: { label: 'Signed out', tone: 'neutral' },
  SIGN_IN_FAILED: { label: 'Wrong password', tone: 'warning' },
  MFA_FAILED: { label: 'Wrong MFA code', tone: 'warning' },
  LOCKED_OUT: { label: 'Locked out (too many attempts)', tone: 'danger' },
};

/** Access & Security (developer instructions 15): invitation, access, MFA and login history. */
export function AccessSecurityTab({ clientId }: { clientId: string }) {
  const header = useClientHeader(clientId);
  return (
    <PageState query={header}>
      {(h) => (
        <div className="flex flex-col gap-6">
          <div className="grid items-start gap-6 xl:grid-cols-3">
            <Card title="Portal Invitation" data-testid="invitation-card" className="min-w-0">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Status</dt>
                <dd>
                  {h.portal.logins.some((l) => l.status === 'ACTIVE') ? (
                    <Badge tone="success">Accepted / Activated</Badge>
                  ) : h.portal.invitation ? (
                    <Badge tone={INVITATION[h.portal.invitation.state]?.tone ?? 'neutral'}>
                      {INVITATION[h.portal.invitation.state]?.label ?? h.portal.invitation.state}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Not sent</Badge>
                  )}
                </dd>
                <dt className="text-muted">Invitation date</dt>
                <dd className="text-text">
                  {h.portal.invitation
                    ? `${dayText(h.portal.invitation.sentAt)} ${timeText(h.portal.invitation.sentAt)}${h.portal.invitation.sentBy ? ` by ${h.portal.invitation.sentBy}` : ''}`
                    : '—'}
                </dd>
                <dt className="text-muted">Logins</dt>
                <dd className="text-text">
                  {h.portal.logins.length
                    ? h.portal.logins.map((l) => (
                        <span key={l.clientAccountId} className="flex items-center gap-1.5">
                          <EnvelopeSimple aria-hidden className="size-4 text-muted" /> {l.email}
                        </span>
                      ))
                    : 'No portal login yet'}
                </dd>
              </dl>
              {h.portal.invitationBlocked && h.portal.invitationBlocked !== 'HAS_LOGIN' ? (
                <p className="mt-3 text-sm text-muted">
                  {h.portal.invitationBlocked === 'NO_EMAIL'
                    ? 'Add an email to the client before inviting them.'
                    : h.portal.invitationBlocked === 'SIGN_UP_WAITING'
                      ? 'A sign-up with this email is waiting in Sign-ups.'
                      : h.portal.invitationBlocked === 'ARCHIVED'
                        ? 'Restore the client before inviting them.'
                        : 'The daily invitation limit for this client is reached.'}
                </p>
              ) : null}
            </Card>
            <QuickActions header={h} />
            <MfaCard clientId={clientId} mfa={h.portal.mfa} canManage={h.can.manageAccess} />
          </div>
          <LoginHistory clientId={clientId} />
        </div>
      )}
    </PageState>
  );
}

function MfaCard({
  clientId,
  mfa,
  canManage,
}: {
  clientId: string;
  mfa: 'ENABLED' | 'NOT_ENROLLED' | null;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const reset = useApiMutation(() => api.clientPortal.resetMfa(clientId));
  return (
    <Card data-testid="mfa-card" className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck aria-hidden weight="fill" className="size-6 text-action" />
        <h2 className="text-lg font-semibold text-heading">MFA Management</h2>
      </div>
      <p className="text-sm text-text">
        {mfa === 'ENABLED'
          ? 'An authenticator app is set up for the client’s login.'
          : mfa === 'NOT_ENROLLED'
            ? 'The client has not set up an authenticator app.'
            : 'The client has no portal login yet.'}
      </p>
      {canManage && mfa === 'ENABLED' ? (
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => setOpen(true)}
          data-testid="reset-mfa"
        >
          <ShieldWarning aria-hidden className="size-5" /> Reset MFA
        </Button>
      ) : null}
      {done ? (
        <p role="status" className="mt-3 text-sm text-success">
          MFA reset. The client sets up an authenticator at their next sign-in.
        </p>
      ) : null}
      <Modal
        open={open}
        title="Reset the client's MFA?"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={reset.isPending}
              onClick={() =>
                reset.mutate(undefined, {
                  onSuccess: () => {
                    setOpen(false);
                    setDone(true);
                    void queryClient.invalidateQueries({ queryKey: headerKey(clientId) });
                  },
                })
              }
            >
              Reset MFA
            </Button>
          </>
        }
      >
        <p className="text-text">
          The authenticator app is forgotten and the client&apos;s sessions end. Use this only after
          confirming who is asking.
        </p>
        {reset.error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {errorMessage(reset.error)}
          </p>
        ) : null}
      </Modal>
    </Card>
  );
}

/** Login History and Security Events (sign-ins, failures and lockouts; never a password). */
function LoginHistory({ clientId }: { clientId: string }) {
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  return (
    <Card data-testid="login-history" className="min-w-0">
      <h2 id="login-history" className="mb-3 text-lg font-semibold text-heading">
        Login History &amp; Security Events
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2 pr-4 font-medium">Date / Time</th>
              <th className="py-2 pr-4 font-medium">Event</th>
              <th className="py-2 pr-4 font-medium">Login</th>
              <th className="py-2 font-medium">IP Address</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((cursor, i) => (
              <LoginPage
                key={cursor ?? 'first'}
                clientId={clientId}
                cursor={cursor}
                onMore={
                  i === pages.length - 1 ? (next) => setPages((p) => [...p, next]) : undefined
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function LoginPage({
  clientId,
  cursor,
  onMore,
}: {
  clientId: string;
  cursor: string | undefined;
  onMore: ((next: string) => void) | undefined;
}) {
  const page = useApiQuery(['client-portal', 'logins', clientId, cursor ?? ''], () =>
    api.clientPortal.logins(clientId, cursor ? { cursor } : {}),
  );
  if (page.isPending) {
    return (
      <tr>
        <td colSpan={4} className="py-3 text-muted">
          Loading…
        </td>
      </tr>
    );
  }
  if (page.isError) {
    return (
      <tr>
        <td colSpan={4} className="py-3 text-danger">
          {errorMessage(page.error)}
        </td>
      </tr>
    );
  }
  const items: ClientPortalLoginItem[] = page.data.items;
  return (
    <>
      {items.length === 0 && !cursor ? (
        <tr>
          <td colSpan={4} className="py-3 text-muted">
            No sign-ins recorded for this client yet.
          </td>
        </tr>
      ) : null}
      {items.map((e) => {
        const ev = LOGIN_EVENT[e.event];
        return (
          <tr key={e.id} className="border-t border-divider">
            <td className="py-2 pr-4 whitespace-nowrap text-text">
              {dayText(e.at)} <span className="text-muted">{timeText(e.at)}</span>
            </td>
            <td className="py-2 pr-4">
              <Badge tone={ev.tone}>{ev.label}</Badge>
              {e.until ? (
                <span className="ml-2 text-xs text-muted">until {timeText(e.until)}</span>
              ) : null}
            </td>
            <td className="py-2 pr-4 text-muted">{e.email ?? '—'}</td>
            <td className="py-2 text-muted">{e.ip ?? '—'}</td>
          </tr>
        );
      })}
      {onMore && page.data.nextCursor ? (
        <tr>
          <td colSpan={4} className="pt-3">
            <Button variant="outline" onClick={() => onMore(page.data.nextCursor!)}>
              Load more
            </Button>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Portal Content (instructions 16): the client's switches, with the rules they follow. */
export function PortalContentTab({ clientId }: { clientId: string }) {
  const header = useClientHeader(clientId);
  return (
    <PageState query={header}>
      {(h) => (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <VisibilityCard clientId={clientId} canChange={h.can.manageAccess} />
          <Card title="How visibility works" className="min-w-0">
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-text">
              <li>
                An area shows only when the firm (Settings &gt; Client Portal) and this client both
                have it on.
              </li>
              <li>
                Turning an area off hides it from the client&apos;s menu and refuses it in the
                portal. Nothing is deleted.
              </li>
              <li>
                Turning an area on never shares every record: documents, returns and reports still
                need their own sharing.
              </li>
              <li>Every change is recorded with who made it and when.</li>
            </ul>
          </Card>
        </div>
      )}
    </PageState>
  );
}

const TYPES = [
  { value: '', label: 'All activity' },
  { value: 'portal', label: 'Portal access' },
  { value: 'document', label: 'Documents' },
  { value: 'message', label: 'Messages' },
  { value: 'intake', label: 'Intake forms' },
  { value: 'invoice', label: 'Invoices & payments' },
  { value: 'appointment', label: 'Appointments' },
  { value: 'profile', label: 'Profile' },
];

/** Activity (instructions 24): every portal event, filtered by type, actor and date. */
export function ActivityTab({ clientId }: { clientId: string }) {
  const [type, setType] = useState('');
  const [actor, setActor] = useState<'' | 'CLIENT' | 'STAFF'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [items, setItems] = useState<ClientPortalActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const filters = {
    type: type || undefined,
    actor: actor || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const page = useApiQuery(
    ['client-portal', 'activity', clientId, 'all', filters, cursor ?? ''],
    () => api.clientPortal.activity(clientId, { ...filters, cursor, limit: 25 }),
  );
  const shown = cursor ? [...items, ...(page.data?.items ?? [])] : (page.data?.items ?? []);
  const reset = () => {
    setItems([]);
    setCursor(undefined);
  };
  return (
    <Card data-testid="activity-tab" className="min-w-0">
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Select
          label="Event type"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            reset();
          }}
          options={TYPES}
        />
        <Select
          label="By"
          value={actor}
          onChange={(e) => {
            setActor(e.target.value as '' | 'CLIENT' | 'STAFF');
            reset();
          }}
          options={[
            { value: '', label: 'Anyone' },
            { value: 'CLIENT', label: 'The client' },
            { value: 'STAFF', label: 'Firm staff' },
          ]}
        />
        <Input
          label="From"
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            reset();
          }}
        />
        <Input
          label="To"
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            reset();
          }}
        />
      </div>
      {page.isPending && shown.length === 0 ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : page.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(page.error)}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">No portal activity matches.</p>
      ) : (
        <ActivityRows items={shown} />
      )}
      {page.data?.nextCursor ? (
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => {
            setItems(shown);
            setCursor(page.data!.nextCursor!);
          }}
        >
          Load more
        </Button>
      ) : null}
    </Card>
  );
}

/** A tab whose records live in their own module until its table is built here (Web 4, Web 5). */
export function ModuleLinkTab({
  label,
  href,
  text,
}: {
  label: string;
  href: string;
  text: string;
}) {
  const router = useRouter();
  return (
    <Card className="flex flex-col items-start gap-3">
      <p className="text-text">{text}</p>
      <Button variant="outline" onClick={() => router.push(href)}>
        Open {label}
      </Button>
    </Card>
  );
}
