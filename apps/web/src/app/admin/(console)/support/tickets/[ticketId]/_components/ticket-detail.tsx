'use client';

import { ActionMenu, Button, Callout, FileDropzone, Modal, Skeleton, Tabs } from '@firmivra/ui';
import {
  ArrowClockwise,
  ArrowsMerge,
  CaretDown,
  CheckCircle,
  Info,
  Paperclip,
  SealCheck,
  Trash,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  ATTACHMENT_TYPES,
  isActive,
  MAX_ATTACHMENT_BYTES,
  TICKET_STATUSES,
  type TicketAttachment,
  type TicketChange,
  type TicketStatus,
} from '../../../../../../../mocks/admin-support';
import { adminSupport } from '../../../_components/support-api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import {
  formatDate,
  formatTime,
  loadError,
  STATUS_TONES,
  SUPPORT,
  SUPPORT_ERRORS,
  supportKeys,
  ticketNo,
  type BadgeTone,
} from '../../../_components/support-data';
import { Breadcrumbs, Panel, QuietLine, ResultLine } from '../../../_components/support-parts';
import {
  statusOptions,
  TicketActionModal,
  type TicketAction,
} from '../../../_components/ticket-actions';
import { TicketComposer, type ComposerMode } from './ticket-composer';
import {
  ActivityPanel,
  AttachmentsPanel,
  ConversationList,
  DetailsPanel,
  NotesPanel,
} from './ticket-panels';
import { ClientFirmCard, QUICK_ICONS, QuickActions, TicketInfoCard } from './ticket-rail';

const PILL: Record<BadgeTone, string> = {
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-disabled text-muted',
  purple: 'bg-purple-soft text-purple',
};

type TabId = 'conversation' | 'details' | 'attachments' | 'notes' | 'activity';

function AttachModal({
  ticketId,
  onClose,
  onDone,
}: {
  ticketId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState('');
  const add = useApiMutation(
    () =>
      adminSupport.addAttachments(
        ticketId,
        files.map((file) => ({ name: file.name, type: file.type, size: file.size, file })),
      ),
    { invalidate: SUPPORT },
  );
  return (
    <Modal
      open
      title="Add Attachment"
      subtitle="Images, PDFs and documents, up to 10 MB each."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={files.length === 0 || add.isPending}
            onClick={() =>
              add.mutate(undefined, {
                onSuccess: () =>
                  onDone(
                    files.length === 1 ? 'Attachment added.' : `${files.length} attachments added.`,
                  ),
              })
            }
          >
            {add.isPending ? 'Uploading…' : 'Add Attachment'}
          </Button>
        </>
      }
    >
      <FileDropzone
        label="Files to attach"
        icon={Paperclip}
        title="Drag and drop files here, or click to browse"
        accept={ATTACHMENT_TYPES}
        maxBytes={MAX_ATTACHMENT_BYTES}
        onFiles={(picked) => {
          setRejected('');
          setFiles([...files, ...picked]);
        }}
        onReject={(rejections) =>
          setRejected(
            rejections
              .map(({ file, reason }) =>
                reason === 'size'
                  ? `${file.name} is larger than 10 MB.`
                  : `${file.name} is not an image, PDF or document.`,
              )
              .join(' '),
          )
        }
      />
      {rejected ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {rejected}
        </p>
      ) : null}
      {files.length ? (
        <ul aria-label="Files to attach" className="mt-3 flex flex-col gap-1 text-sm text-text">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}`}>{file.name}</li>
          ))}
        </ul>
      ) : null}
      {add.error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {errorMessage(add.error, SUPPORT_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}

/** A frame that keeps its place while the ticket loads ('loading') or cannot load (the reason). */
function Frame({ label, state }: { label: string; state: string }) {
  return (
    <Panel label={label} className="p-5">
      <h2 className="mb-3 text-lg font-bold text-heading">{label}</h2>
      {state === 'loading' ? (
        <div role="status" aria-label={`Loading ${label}`} className="flex flex-col gap-3">
          <Skeleton className="w-3/4" />
          <Skeleton className="w-1/2" />
          <Skeleton className="w-2/3" />
        </div>
      ) : (
        <QuietLine>{state}</QuietLine>
      )}
    </Panel>
  );
}

/**
 * A support ticket (modern-saas-support-ticket-dashboard.jpg, docx §3): the header with status,
 * More, Assign, Escalate, Resolve and Close; the Conversation, Details, Attachments, Internal
 * Notes and Activity History tabs; the reply editor; and the Ticket Information, Client / Firm
 * and Quick Actions cards. Every change goes to the one ticket record and refreshes the list too.
 */
export function TicketDetailScreen({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const ticketQuery = useApiQuery(supportKeys.ticket(ticketId), () =>
    adminSupport.ticket(ticketId),
  );
  const me = useApiQuery(supportKeys.me, () => adminSupport.me());
  const settings = useApiQuery(supportKeys.settings, () => adminSupport.settings());
  const directory = useApiQuery(supportKeys.directory, () => adminSupport.directory());
  const [tab, setTab] = useState<TabId>('conversation');
  const [mode, setMode] = useState<ComposerMode>('REPLY');
  const [text, setText] = useState('');
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [action, setAction] = useState<TicketAction | 'attach' | null>(null);
  const [message, setMessage] = useState('');
  const update = useApiMutation(
    (body: Omit<TicketChange, 'version'>) =>
      adminSupport.updateTicket(ticketId, {
        version: ticketQuery.data?.version ?? 0,
        ...body,
      }),
    { invalidate: SUPPORT },
  );
  const download = useApiMutation(
    async ({ file, view }: { file: TicketAttachment; view: boolean }) => {
      // A signed link that works for a few minutes (the file downloads as an attachment).
      const url = await adminSupport.attachmentUrl(ticketId, file.id);
      if (view) window.open(url, '_blank', 'noopener');
      else {
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.click();
      }
      if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return file;
    },
  );

  const ticket = ticketQuery.data;
  const permissions = me.data?.permissions ?? [];
  const can = (p: (typeof permissions)[number]) => permissions.includes(p);
  const failure = ticketQuery.isError ? loadError(ticketQuery.error) : null;
  const active = ticket ? isActive(ticket.status) : false;
  const notesAllowed = can('VIEW_INTERNAL_NOTES');

  function open(next: TicketAction | 'attach') {
    setMessage('');
    setAction(next);
  }
  function done(result: string) {
    setAction(null);
    setMessage(result);
  }
  function change(body: Omit<TicketChange, 'version'>, success: string) {
    setMessage('');
    update.mutate(body, { onSuccess: () => setMessage(success) });
  }
  function changeStatus(next: TicketStatus) {
    if (!ticket || next === ticket.status) return;
    if (next === 'ESCALATED') open('escalate');
    else if (next === 'CLOSED') open('close');
    else change({ status: next }, `${ticketNo(ticket.number)} is now ${TICKET_STATUSES[next]}.`);
  }
  function writeNote() {
    setTab('conversation');
    setMode('NOTE');
    requestAnimationFrame(() => boxRef.current?.focus());
  }

  const title = ticket ? `Ticket ${ticketNo(ticket.number)}` : 'Ticket';
  const statusChoices = ticket
    ? statusOptions(permissions).some((o) => o.value === ticket.status)
      ? statusOptions(permissions)
      : [
          { value: ticket.status, label: TICKET_STATUSES[ticket.status] },
          ...statusOptions(permissions),
        ]
    : [];
  const actionError =
    (update.error ?? download.error)
      ? errorMessage(update.error ?? download.error, SUPPORT_ERRORS)
      : undefined;

  const moreSections = ticket
    ? [
        {
          items: [
            ...(!active
              ? [
                  {
                    label: 'Reopen Ticket',
                    icon: ArrowClockwise,
                    onSelect: () =>
                      change({ status: 'OPEN' }, `${ticketNo(ticket.number)} was reopened.`),
                  },
                ]
              : []),
            ...(can('MERGE') && !ticket.mergedInto
              ? [{ label: 'Merge Ticket', icon: ArrowsMerge, onSelect: () => open('merge') }]
              : []),
            ...(can('DELETE')
              ? [
                  {
                    label: 'Delete Ticket',
                    icon: Trash,
                    danger: true,
                    onSelect: () => open('delete'),
                  },
                ]
              : []),
          ],
        },
      ]
    : [];

  const header = (
    <header className="flex flex-col gap-2">
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Support', href: '/support' },
          { label: title },
        ]}
      />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-4">
            <h1 data-testid="page-title" className="text-4xl font-bold text-heading">
              {title}
            </h1>
            {ticket ? (
              <span className="relative inline-flex">
                <label htmlFor="ticket-status" className="sr-only">
                  Ticket status
                </label>
                <select
                  id="ticket-status"
                  data-testid="ticket-status"
                  value={ticket.status}
                  disabled={update.isPending}
                  onChange={(event) => changeStatus(event.target.value as TicketStatus)}
                  className={`appearance-none rounded-lg py-1.5 pr-10 pl-4 text-lg font-semibold focus:outline-2 focus:outline-focus ${PILL[STATUS_TONES[ticket.status]]}`}
                >
                  {statusChoices.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <CaretDown
                  aria-hidden
                  weight="bold"
                  className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
                />
              </span>
            ) : null}
          </div>
          {ticket ? (
            <>
              <p className="mt-1 text-xl font-semibold text-heading">{ticket.subject}</p>
              <p className="text-sm text-muted">
                Created on {formatDate(ticket.createdAt)} at {formatTime(ticket.createdAt)} by{' '}
                {ticket.createdBy.name}
              </p>
            </>
          ) : ticketQuery.isPending ? (
            <div role="status" aria-label="Loading ticket" className="mt-2 flex flex-col gap-2">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="w-80" />
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted">{failure}</p>
          )}
        </div>
        {ticket ? (
          <div className="flex flex-wrap items-center gap-3">
            <ActionMenu trigger="More" label="More ticket actions" sections={moreSections} />
            {can('ASSIGN') ? (
              <Button variant="outline" onClick={() => open('assign')}>
                <UsersThree aria-hidden weight="fill" className="size-5" />
                Assign
              </Button>
            ) : null}
            {can('ESCALATE') ? (
              <Button
                variant="secondary"
                disabled={!active || ticket.escalation !== null}
                onClick={() => open('escalate')}
              >
                <ArrowClockwise aria-hidden weight="bold" className="size-5" />
                {ticket.escalation ? 'Escalated' : 'Escalate'}
              </Button>
            ) : null}
            {can('RESOLVE') ? (
              <button
                type="button"
                disabled={!active || update.isPending}
                onClick={() =>
                  change({ status: 'RESOLVED' }, `${ticketNo(ticket.number)} was resolved.`)
                }
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-success px-4 py-2 text-sm font-medium text-on-action hover:bg-success/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-text"
              >
                <SealCheck aria-hidden weight="fill" className="size-5" />
                Resolve
              </button>
            ) : null}
            {can('CLOSE') ? (
              <button
                type="button"
                disabled={ticket.status === 'CLOSED'}
                onClick={() => open('close')}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-muted px-4 py-2 text-sm font-medium text-on-action hover:bg-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-text"
              >
                <CheckCircle aria-hidden weight="fill" className="size-5" />
                Close
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );

  if (!ticket) {
    const state = failure ?? 'loading';
    return (
      <div className="flex min-w-0 flex-col gap-5">
        {header}
        <div className="grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <Frame label="Conversation" state={state} />
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <Frame label="Ticket Information" state={state} />
            <Frame label="Client / Firm" state={state} />
            <Frame label="Quick Actions" state={state} />
          </div>
        </div>
      </div>
    );
  }

  const canned = (settings.data?.cannedResponses ?? []).filter((c) => c.active);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {header}
      <ResultLine message={message} error={actionError} />
      {ticket.mergedInto ? (
        <Callout icon={Info} surface="info" size="compact">
          This ticket was merged into{' '}
          <Link href={`/support/tickets/${ticket.mergedInto.id}`} className="text-link underline">
            {ticketNo(ticket.mergedInto.number)}
          </Link>
          . Its history is kept there.
        </Callout>
      ) : null}
      <div className="grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2 max-lg:[&_[role=tablist]]:flex-wrap max-lg:[&_[role=tablist]]:gap-x-4">
          <Tabs
            label="Ticket sections"
            variant="underline"
            value={tab}
            onChange={(next) => setTab(next as TabId)}
            items={[
              {
                id: 'conversation',
                label: 'Conversation',
                content: (
                  <Panel label="Conversation" className="flex flex-col gap-3 p-3">
                    <ConversationList
                      ticket={ticket}
                      onReplyTo={(name) => {
                        setMode('REPLY');
                        setText(`Hi ${name.split(' ')[0] ?? name},\n\n`);
                        requestAnimationFrame(() => boxRef.current?.focus());
                      }}
                    />
                    <TicketComposer
                      ticket={ticket}
                      mode={notesAllowed ? mode : 'REPLY'}
                      onMode={setMode}
                      text={text}
                      onText={setText}
                      boxRef={boxRef}
                      canNote={notesAllowed}
                      canned={canned}
                      onSent={setMessage}
                    />
                  </Panel>
                ),
              },
              { id: 'details', label: 'Details', content: <DetailsPanel ticket={ticket} /> },
              {
                id: 'attachments',
                label: `Attachments (${ticket.counts.attachments})`,
                content: (
                  <AttachmentsPanel
                    ticket={ticket}
                    busy={download.isPending}
                    onAdd={() => open('attach')}
                    onOpen={(file, view) => download.mutate({ file, view })}
                  />
                ),
              },
              {
                id: 'notes',
                label: notesAllowed ? `Internal Notes (${ticket.counts.notes})` : 'Internal Notes',
                content: <NotesPanel ticket={ticket} allowed={notesAllowed} onAdd={writeNote} />,
              },
              {
                id: 'activity',
                label: 'Activity History',
                content: <ActivityPanel ticket={ticket} />,
              },
            ]}
          />
        </div>
        <aside aria-label="Ticket summary" className="flex min-w-0 flex-col gap-5">
          <TicketInfoCard
            ticket={ticket}
            settings={settings.data}
            permissions={permissions}
            busy={update.isPending}
            onStatus={changeStatus}
            onPriority={(priorityId) =>
              change({ priorityId }, `Priority of ${ticketNo(ticket.number)} changed.`)
            }
            onCategory={(categoryId) =>
              change({ categoryId }, `Category of ${ticketNo(ticket.number)} changed.`)
            }
            menu={[
              {
                label: 'Copy ticket link',
                onSelect: () => {
                  void navigator.clipboard?.writeText(window.location.href);
                  setMessage('Ticket link copied.');
                },
              },
              ...(can('ASSIGN') ? [{ label: 'Assign', onSelect: () => open('assign') }] : []),
            ]}
          />
          <ClientFirmCard ticket={ticket} directory={directory.data} />
          <QuickActions
            actions={[
              {
                label: 'Add Internal Note',
                icon: QUICK_ICONS.note,
                onSelect: writeNote,
                hidden: !notesAllowed,
              },
              { label: 'Add Attachment', icon: QUICK_ICONS.attach, onSelect: () => open('attach') },
              { label: 'Change Status', icon: QUICK_ICONS.status, onSelect: () => open('status') },
              {
                label: 'Merge Ticket',
                icon: QUICK_ICONS.merge,
                onSelect: () => open('merge'),
                hidden: !can('MERGE') || ticket.mergedInto !== null,
              },
            ]}
          />
        </aside>
      </div>

      {action === 'attach' ? (
        <AttachModal ticketId={ticket.id} onClose={() => setAction(null)} onDone={done} />
      ) : action ? (
        <TicketActionModal
          action={action}
          ticket={ticket}
          onClose={() => setAction(null)}
          onDone={(result) => {
            if (action === 'delete') router.push('/support');
            else done(result);
          }}
        />
      ) : null}
    </div>
  );
}
