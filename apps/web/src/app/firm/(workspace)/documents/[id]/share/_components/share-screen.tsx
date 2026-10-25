'use client';

import {
  ApiRequestError,
  DOCUMENT_ERRORS,
  type DocumentShare,
  type LibraryDocument,
  type UpdateDocumentShareRequest,
} from '@firmivra/types';
import {
  Avatar,
  Badge,
  Button,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Tabs,
  Timeline,
  Toast,
  Toggle,
} from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowSquareOut,
  CaretRight,
  CheckCircle,
  Clock,
  Copy,
  EnvelopeSimple,
  Eye,
  LinkSimple,
  PaperPlaneTilt,
  ShieldCheck,
  User,
  UserCircleGear,
  Users,
  type Icon,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { useFirm } from '../../../../../../../components/firm-context';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { RowMenu } from '../../../../team/_components/row-menu';
import { FileIcon } from '../../../_components/file-icon';
import { formatTime } from '../../../requests/[id]/_components/detail-parts';
import { dayAfter, dayOf, expiryOf, hasAccess, permissionText, sizeText } from './share-parts';

const ERRORS: Record<string, string> = {
  ...DOCUMENT_ERRORS,
  SHARE_EXISTS: 'This person already has access. Change it in Current Access instead.',
  INTERNAL_DOCUMENT: 'An internal document is never shared with the client.',
  FILE_NOT_CLEAN: 'The file is still being checked for viruses, or it failed the check.',
  NOT_A_MEMBER: 'That team member is no longer active. Choose another.',
};
const REVIEW: Record<
  NonNullable<LibraryDocument['reviewStatus']>,
  { label: string; tone: 'success' | 'warning' | 'info' | 'danger' }
> = {
  NEEDS_REVIEW: { label: 'Needs Review', tone: 'warning' },
  IN_REVIEW: { label: 'In Review', tone: 'info' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  REPLACEMENT_REQUESTED: { label: 'Replacement Requested', tone: 'danger' },
};
const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

interface Grant {
  canDownload: boolean;
  canUpload: boolean;
  canSign: boolean;
  expiresOn: string;
}

function WhoCard({
  icon: Glyph,
  title,
  note,
  checked,
  disabled,
  onSelect,
}: {
  icon: Icon;
  title: string;
  note: string;
  checked: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <label
      className={`flex min-h-16 items-start gap-2.5 rounded-control border p-3 ${checked ? 'border-action bg-info-soft' : 'border-border bg-surface'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-action'}`}
    >
      <input
        type="radio"
        name="share-with"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 size-5 shrink-0 accent-action"
      />
      <Glyph aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0 text-heading" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-heading">{title}</span>
        <span className="block text-xs text-muted">{note}</span>
      </span>
    </label>
  );
}

function Permission({
  label,
  note,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  note: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (on: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-action"
      />
      <span>
        <span className="block text-sm font-semibold text-heading">{label}</span>
        <span className="block text-xs text-muted">{note}</span>
      </span>
    </label>
  );
}

function GrantFields({
  value,
  onChange,
}: {
  value: Grant;
  onChange: (next: Partial<Grant>) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Permission label="View document" note="Viewing comes with every share." checked disabled />
      <Permission
        label="Download document"
        note="Allow the recipient to download a copy."
        checked={value.canDownload}
        onChange={(canDownload) => onChange({ canDownload })}
      />
      <Permission
        label="Allow upload / replace"
        note="Allow the recipient to upload a new version; the old one is kept."
        checked={value.canUpload}
        onChange={(canUpload) => onChange({ canUpload })}
      />
      <Permission
        label="Allow e-signature (if applicable)"
        note="Allow the recipient to sign this document electronically."
        checked={value.canSign}
        onChange={(canSign) => onChange({ canSign })}
      />
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <div>
        <h2 className="font-display text-xl font-bold text-heading">{title}</h2>
        {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Share Document (Documents design, Frame 5): who may open one document and what they may do,
 * on the library API's access, shares and access history. A share goes to one of the client's
 * portal logins or a team member; an internal document never goes to the client.
 */
export function ShareScreen({ id, portalBase }: { id: string; portalBase: string }) {
  const queryClient = useQueryClient();
  const { firm, role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';
  const key = ['document-access', id];
  const doc = useQuery({
    queryKey: ['library-document', id],
    queryFn: () => api.documentLibrary.get(id),
    retry: (n, e) => !(e instanceof ApiRequestError && e.status < 500) && n < 2,
  });
  const access = useQuery({
    queryKey: key,
    queryFn: () => api.documentLibrary.access(id),
    enabled: doc.isSuccess,
  });
  const settings = useQuery({
    queryKey: ['document-settings'],
    queryFn: () => api.documentLibrary.settings(),
  });
  const team = useQuery({ queryKey: ['team'], queryFn: () => api.team.list(), enabled: manager });
  const [tab, setTab] = useState('share');
  const history = useQuery({
    queryKey: [...key, 'history'],
    queryFn: () => api.documentLibrary.accessHistory(id),
    enabled: tab === 'history' && doc.isSuccess,
  });

  const [who, setWho] = useState<'CLIENT' | 'MEMBER'>('CLIENT');
  const [recipient, setRecipient] = useState('');
  const [grant, setGrant] = useState<Grant | null>(null);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [editing, setEditing] = useState<{ share: DocumentShare; grant: Grant } | null>(null);
  const [revoking, setRevoking] = useState<DocumentShare | null>(null);

  const days = settings.data?.shareExpiryDays ?? null;
  const fresh: Grant = {
    canDownload: true,
    canUpload: false,
    canSign: false,
    expiresOn: days ? dayAfter(days) : '',
  };
  const form = grant ?? fresh;

  async function act(done: string, run: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await run();
      await queryClient.invalidateQueries({ queryKey: key });
      setNote({ text: done, tone: 'success' });
      return true;
    } catch (e) {
      setNote({ text: errorMessage(e, ERRORS), tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <PageHeader
      above={
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            <li>
              <Link href="/documents" className="text-text hover:text-action hover:underline">
                Documents
              </Link>
            </li>
            <li aria-hidden>
              <CaretRight weight="bold" className="size-3 text-muted" />
            </li>
            <li>
              <Link
                href={`/documents/${id}`}
                className="text-text hover:text-action hover:underline"
              >
                Document Details
              </Link>
            </li>
            <li aria-hidden>
              <CaretRight weight="bold" className="size-3 text-muted" />
            </li>
            <li aria-current="page" className="font-medium text-heading">
              Share Document
            </li>
          </ol>
        </nav>
      }
      title="Share Document"
      subtitle="Control who can access this document and what they can do."
      actions={
        <Link
          href={`/documents/${id}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-5" />
          Back to Document Details
        </Link>
      }
    />
  );

  if (doc.isPending)
    return (
      <div className="flex flex-col gap-5" data-testid="share-document">
        {header}
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    );
  if (doc.isError) {
    const missing = doc.error instanceof ApiRequestError && [400, 404].includes(doc.error.status);
    return (
      <div className="flex flex-col gap-5" data-testid="share-document">
        {header}
        <p role="alert" className="rounded-card bg-surface p-6 text-center text-text shadow-card">
          {missing
            ? 'This document was not found, or it is not one you can see.'
            : 'This document could not be loaded right now. Try again in a moment.'}
        </p>
      </div>
    );
  }

  const d = doc.data;
  const a = access.data;
  const shares = a?.shares ?? [];
  const internal = d.direction === 'INTERNAL';
  const logins = a?.clientLogins ?? [];
  const members = (team.data ?? []).filter((m) => m.status === 'ACTIVE');
  const portalLink = portalBase ? `${portalBase.replace(/\/$/, '')}/${firm.slug}/documents` : '';
  const choices =
    who === 'CLIENT'
      ? logins.map((l) => ({
          value: l.id,
          label: `${l.name} (${l.email})${hasAccess(shares, 'CLIENT', l.id) ? ': has access' : ''}`,
          taken: hasAccess(shares, 'CLIENT', l.id),
        }))
      : members.map((m) => ({
          value: m.user.id,
          label: `${m.user.name} (${m.user.email})${hasAccess(shares, 'MEMBER', m.user.id) ? ': has access' : ''}`,
          taken: hasAccess(shares, 'MEMBER', m.user.id),
        }));

  async function share() {
    if (!recipient) return setError('Choose who to share it with.');
    if (form.expiresOn && form.expiresOn < dayAfter(0))
      return setError('Choose today or a later date.');
    setError('');
    const ok = await act('The document was shared.', () =>
      api.documentLibrary.share(id, {
        recipient:
          who === 'CLIENT'
            ? { kind: 'CLIENT', clientAccountId: recipient }
            : { kind: 'MEMBER', userId: recipient },
        canDownload: form.canDownload,
        canUpload: form.canUpload,
        canSign: form.canSign,
        expiresAt: expiryOf(form.expiresOn),
        notify,
      }),
    );
    if (ok) {
      setRecipient('');
      setGrant(null);
    }
  }

  const shareTab = (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void share();
      }}
    >
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold text-heading">1. Choose Who to Share With</h2>
          <p className="text-sm text-muted">Add the person who can access this document.</p>
        </div>
        <div
          role="radiogroup"
          aria-label="Share with"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          <WhoCard
            icon={User}
            title="Client"
            note={
              internal ? 'Internal documents stay with your team' : 'Give access to this client'
            }
            checked={who === 'CLIENT' && !internal}
            disabled={internal}
            onSelect={() => {
              setWho('CLIENT');
              setRecipient('');
            }}
          />
          <WhoCard
            icon={Users}
            title="Team Member"
            note="Give access to a staff member"
            checked={who === 'MEMBER' || internal}
            disabled={!manager}
            onSelect={() => {
              setWho('MEMBER');
              setRecipient('');
            }}
          />
          <WhoCard
            icon={UserCircleGear}
            title="External Contact"
            note="Not available: only clients and your team"
            checked={false}
            disabled
          />
          <WhoCard
            icon={LinkSimple}
            title="Public Link"
            note="Not available: never by public link"
            checked={false}
            disabled
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-bold text-heading">
          2. Select Recipient<span className="text-danger"> *</span>
        </h2>
        {access.isPending ? (
          <Skeleton className="h-11" />
        ) : access.isError ? (
          <p className="text-sm text-muted">
            Who can access this document could not be loaded right now.
          </p>
        ) : who === 'CLIENT' && !internal && logins.length === 0 ? (
          <p className="rounded-control bg-warning-soft px-4 py-3 text-sm text-heading">
            {d.client.name} has no portal login yet. Invite them from{' '}
            <Link href={`/clients/${d.client.id}`} className="font-medium text-action underline">
              their profile
            </Link>{' '}
            first.
          </p>
        ) : (
          <Select
            label="Recipient"
            hideLabel
            value={recipient}
            error={error || undefined}
            onChange={(e) => setRecipient(e.target.value)}
            options={[
              {
                value: '',
                label:
                  who === 'CLIENT' && !internal ? 'Choose a portal login' : 'Choose a team member',
              },
              ...choices.filter((c) => !c.taken).map(({ value, label }) => ({ value, label })),
            ]}
          />
        )}
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold text-heading">3. Set Permissions</h2>
          <p className="text-sm text-muted">Choose what this person can do with the document.</p>
        </div>
        <GrantFields value={form} onChange={(next) => setGrant({ ...form, ...next })} />
      </div>
      <div className="flex flex-col gap-3 border-t border-divider pt-4">
        <h2 className="text-lg font-bold text-heading">4. Access Settings</h2>
        <div className="max-w-xs">
          <Input
            label="Access expires (optional)"
            type="date"
            min={dayAfter(0)}
            value={form.expiresOn}
            onChange={(e) => setGrant({ ...form, expiresOn: e.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex min-w-0 flex-1 items-center gap-3">
          <Toggle label="Notify recipient by email" checked={notify} onChange={setNotify} />
          <span className="flex items-start gap-2">
            <EnvelopeSimple
              aria-hidden
              weight="bold"
              className="mt-0.5 size-5 shrink-0 text-heading"
            />
            <span>
              <span className="block text-sm font-medium text-heading">
                Notify recipient by email
              </span>
              <span className="block text-xs text-muted">
                They are told by email that the document is shared with them.
              </span>
            </span>
          </span>
        </label>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setRecipient('');
            setGrant(null);
            setError('');
          }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy || access.isError}>
          Share Document
          <PaperPlaneTilt aria-hidden weight="fill" className="size-4" />
        </Button>
      </div>
    </form>
  );

  const shareRow = (s: DocumentShare) => (
    <li key={s.id} data-testid="share-row" className="flex items-start gap-3 py-3">
      <Avatar name={s.recipient.name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-heading">
          {s.recipient.name}
          <Badge tone={s.recipient.kind === 'CLIENT' ? 'info' : 'neutral'}>
            {s.recipient.kind === 'CLIENT' ? 'Client' : 'Staff'}
          </Badge>
        </p>
        <p className="text-sm text-text">{permissionText(s)}</p>
        <p className="text-xs text-muted">
          {dateText(s.createdAt)}
          {s.expiresAt ? ` · until ${dateText(s.expiresAt)}` : ''}
        </p>
      </div>
      <RowMenu
        label={`Access of ${s.recipient.name}`}
        items={[
          {
            label: 'Change Access',
            onSelect: () =>
              setEditing({
                share: s,
                grant: {
                  canDownload: s.canDownload,
                  canUpload: s.canUpload,
                  canSign: s.canSign,
                  expiresOn: dayOf(s.expiresAt),
                },
              }),
          },
          { label: 'Revoke Access', danger: true, onSelect: () => setRevoking(s) },
        ]}
      />
    </li>
  );

  const portalCard = (
    <div className="flex flex-col gap-2">
      {portalLink ? (
        <div className="flex gap-2">
          <input
            readOnly
            aria-label="Client portal link"
            value={portalLink}
            className="min-h-11 min-w-0 flex-1 rounded-control border border-border bg-canvas px-3 text-sm text-text"
          />
          <Button
            variant="outline"
            onClick={() =>
              void navigator.clipboard.writeText(portalLink).then(
                () => setNote({ text: 'The link was copied.', tone: 'success' }),
                () =>
                  setNote({
                    text: 'The link could not be copied. Select it and copy it.',
                    tone: 'error',
                  }),
              )
            }
          >
            <Copy aria-hidden weight="bold" className="size-4" />
            Copy Link
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">
          The client portal&apos;s address is not set for this site.
        </p>
      )}
      <p className="text-xs text-muted">
        The client signs in to their portal and finds the document under Documents while their share
        lasts. The link holds no access of its own.
      </p>
    </div>
  );

  const panels: Record<string, ReactNode> = {
    share: shareTab,
    portal: (
      <div className="flex flex-col gap-3" data-testid="portal-link">
        <h2 className="text-lg font-bold text-heading">Client Portal Link</h2>
        {portalCard}
      </div>
    ),
    internal: (
      <div className="flex flex-col gap-3" data-testid="internal-access">
        <h2 className="text-lg font-bold text-heading">Internal Access</h2>
        <p className="text-sm text-muted">
          Owners and Admins, and the staff assigned to {d.client.name}, see this document by their
          role. These team members were given access to it on its own.
        </p>
        {shares.filter((s) => s.recipient.kind === 'MEMBER').length ? (
          <ul className="flex flex-col divide-y divide-divider">
            {shares.filter((s) => s.recipient.kind === 'MEMBER').map(shareRow)}
          </ul>
        ) : (
          <p className="rounded-control bg-canvas px-4 py-6 text-center text-sm text-muted">
            No team member was given access on its own.
          </p>
        )}
      </div>
    ),
    history: (
      <div className="flex flex-col gap-3" data-testid="access-history">
        <h2 className="text-lg font-bold text-heading">Access History</h2>
        {history.isPending ? (
          <Skeleton className="h-40" />
        ) : history.isError ? (
          <p className="text-sm text-muted">The access history could not be loaded right now.</p>
        ) : history.data.length ? (
          <Timeline
            items={history.data.map((h) => ({
              id: h.id,
              icon:
                h.kind === 'SHARE_REVOKED' ? ShieldCheck : h.kind === 'DOWNLOADED' ? Eye : Clock,
              tone: h.kind === 'SHARE_REVOKED' ? 'red' : 'blue',
              title: h.label,
              time: formatTime(h.at),
              dateTime: h.at,
              ...(h.by ? { actor: h.by } : {}),
            }))}
          />
        ) : (
          <p className="rounded-control bg-canvas px-4 py-6 text-center text-sm text-muted">
            No access yet.
          </p>
        )}
      </div>
    ),
  };

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="share-document">
      {header}
      {note ? <Toast tone={note.tone} message={note.text} onDismiss={() => setNote(null)} /> : null}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <section
            className="flex flex-wrap items-center gap-4 rounded-card border border-border bg-surface p-4"
            data-testid="share-file"
          >
            <FileIcon contentType={d.contentType} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="truncate text-xl font-bold text-heading">{d.fileName}</span>
                {d.reviewStatus ? (
                  <Badge tone={REVIEW[d.reviewStatus].tone} dot>
                    {REVIEW[d.reviewStatus].label}
                  </Badge>
                ) : null}
              </p>
              <p className="text-sm text-muted">
                Client: {d.client.name} | {sizeText(d.sizeBytes)} | Uploaded on{' '}
                {dateText(d.createdAt)}
              </p>
            </div>
            <button
              type="button"
              disabled={d.scanStatus !== 'CLEAN'}
              onClick={() =>
                void act('The document opened in a new tab.', async () => {
                  const link = await api.documentLibrary.preview(id);
                  window.open(link.url, '_blank', 'noopener');
                })
              }
              className="inline-flex items-center gap-1 text-sm font-medium text-action underline disabled:text-muted"
            >
              View Document
              <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
            </button>
          </section>
          <section className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-surface p-4 sm:p-6">
            <Tabs
              label="Sharing"
              variant="underline"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'share', label: 'Share Access' },
                { id: 'portal', label: 'Client Portal Link' },
                { id: 'internal', label: 'Internal Access' },
                { id: 'history', label: 'Access History' },
              ]}
            />
            {panels[tab]}
          </section>
        </div>
        <aside className="flex min-w-0 flex-col gap-5" aria-label="Access">
          <Card
            title="Current Access"
            subtitle="People who currently have access to this document."
            testId="current-access"
          >
            {access.isPending ? (
              <Skeleton className="h-32" />
            ) : access.isError ? (
              <p className="text-sm text-muted">Current access could not be loaded right now.</p>
            ) : shares.length ? (
              <ul className="flex flex-col divide-y divide-divider">{shares.map(shareRow)}</ul>
            ) : (
              <p className="text-sm text-muted">
                Only your team, by their roles. Nobody was given access on its own.
              </p>
            )}
          </Card>
          <Card
            title="Share Link (Client Portal)"
            subtitle="Where the client opens the documents shared with them."
          >
            {portalCard}
          </Card>
          <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
            <h2 className="flex items-center gap-2 font-display text-xl font-bold text-heading">
              <ShieldCheck aria-hidden weight="fill" className="size-6 text-action" />
              Security &amp; Compliance
            </h2>
            <ul className="flex flex-col gap-2 rounded-control bg-success-soft p-3 text-sm text-heading">
              {[
                'Secure, encrypted link (HTTPS)',
                'Access can be revoked at any time',
                'All access is logged and tracked',
                "Stored encrypted with your firm's own key",
              ].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <CheckCircle aria-hidden weight="fill" className="size-5 shrink-0 text-success" />
                  {t}
                </li>
              ))}
            </ul>
            <Link
              href="/privacy"
              className="inline-flex items-center gap-1 text-sm font-medium text-action underline"
            >
              Learn more about document security
              <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
            </Link>
          </section>
        </aside>
      </div>

      <Modal
        open={editing !== null}
        title={`Change access of ${editing?.share.recipient.name ?? ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (!editing) return;
                const { share: s, grant: g } = editing;
                const body: UpdateDocumentShareRequest = {};
                if (g.canDownload !== s.canDownload) body.canDownload = g.canDownload;
                if (g.canUpload !== s.canUpload) body.canUpload = g.canUpload;
                if (g.canSign !== s.canSign) body.canSign = g.canSign;
                if (g.expiresOn !== dayOf(s.expiresAt)) body.expiresAt = expiryOf(g.expiresOn);
                if (!Object.keys(body).length) return setEditing(null);
                void act(`The access of ${s.recipient.name} was changed.`, () =>
                  api.documentLibrary.updateShare(id, s.id, body),
                ).then((ok) => ok && setEditing(null));
              }}
            >
              Save
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="flex flex-col gap-4">
            <GrantFields
              value={editing.grant}
              onChange={(next) => setEditing({ ...editing, grant: { ...editing.grant, ...next } })}
            />
            <div className="max-w-xs">
              <Input
                label="Access expires (optional)"
                type="date"
                min={dayAfter(0)}
                value={editing.grant.expiresOn}
                onChange={(e) =>
                  setEditing({ ...editing, grant: { ...editing.grant, expiresOn: e.target.value } })
                }
              />
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={revoking !== null}
        title={`Revoke access of ${revoking?.recipient.name ?? ''}?`}
        onClose={() => setRevoking(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevoking(null)}>
              Keep Access
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                const s = revoking;
                if (!s) return;
                void act(`${s.recipient.name} no longer has access.`, () =>
                  api.documentLibrary.revokeShare(id, s.id),
                ).then(() => setRevoking(null));
              }}
            >
              Revoke Access
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          They can no longer open or download this document. The access history keeps the record.
        </p>
      </Modal>
    </div>
  );
}
