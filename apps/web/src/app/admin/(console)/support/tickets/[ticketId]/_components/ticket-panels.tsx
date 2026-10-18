'use client';

import { Badge, Button, IconButton, Table, Timeline, type TimelineItem } from '@firmivra/ui';
import {
  ArrowsClockwise,
  ArrowsMerge,
  Bell,
  ChatCircleText,
  CheckCircle,
  Clock,
  DownloadSimple,
  Eye,
  FileText,
  Flag,
  Lightning,
  LockSimple,
  Paperclip,
  PaperPlaneTilt,
  PlusCircle,
  Tag,
  UserSwitch,
  Warning,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import {
  SLA_STATES,
  TICKET_SOURCES,
  TICKET_STATUSES,
  type ActivityType,
  type TicketActivity,
  type TicketAttachment,
  type TicketDetail,
} from '../../../../../../../mocks/admin-support';
import {
  fileSize,
  formatDateTime,
  SLA_TEXT,
  slaNote,
  ticketNo,
} from '../../../_components/support-data';
import { Panel, QuietLine, RowMenu } from '../../../_components/support-parts';
import { FormattedText } from './formatted-text';

/** Initials on a disc: grey for the client, blue for support (as in the conversation design). */
export function Initials({
  name,
  tone,
  size = 'lg',
}: {
  name: string;
  tone: 'client' | 'support' | 'solid';
  size?: 'md' | 'lg';
}) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
  const colours = {
    client: 'bg-disabled text-muted',
    support: 'bg-info-soft text-info',
    solid: 'bg-purple text-on-action',
  }[tone];
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${colours} ${size === 'lg' ? 'size-12 text-base' : 'size-9 text-sm'}`}
    >
      {letters}
    </span>
  );
}

export function ConversationList({
  ticket,
  onReplyTo,
}: {
  ticket: TicketDetail;
  onReplyTo: (name: string) => void;
}) {
  if (ticket.messages.length === 0) return <QuietLine>No messages yet.</QuietLine>;
  return (
    <ol aria-label="Conversation" className="flex flex-col gap-3">
      {ticket.messages.map((message) => {
        const client = message.author.role === 'CLIENT';
        return (
          <li key={message.id} data-testid="ticket-message" className="flex min-w-0 gap-3">
            <Initials name={message.author.name} tone={client ? 'client' : 'support'} />
            <article
              className={`min-w-0 flex-1 rounded-lg border border-divider px-4 py-3 ${client ? 'bg-subtle' : 'bg-canvas'}`}
            >
              <header className="mb-1 flex items-start justify-between gap-2">
                <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-heading">
                    {message.author.name} ({client ? 'Client' : 'Support'})
                  </span>
                  <time dateTime={message.at} className="text-xs text-muted">
                    {formatDateTime(message.at)}
                  </time>
                  {message.sentToClient ? null : <Badge tone="neutral">Not sent to client</Badge>}
                  {message.mergedFrom ? (
                    <Badge tone="info">From {ticketNo(message.mergedFrom)}</Badge>
                  ) : null}
                </p>
                <RowMenu
                  vertical
                  label={`Message from ${message.author.name}`}
                  items={[
                    {
                      label: 'Copy text',
                      onSelect: () => void navigator.clipboard?.writeText(message.body),
                    },
                    ...(client
                      ? [
                          {
                            label: 'Reply to this message',
                            onSelect: () => onReplyTo(message.author.name),
                          },
                        ]
                      : []),
                  ]}
                />
              </header>
              <FormattedText body={message.body} />
              {message.attachments.length ? (
                <ul aria-label="Attachments" className="mt-2 flex flex-wrap gap-2">
                  {message.attachments.map((file) => (
                    <li
                      key={file.id}
                      className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs text-text wrap-anywhere"
                    >
                      <Paperclip aria-hidden weight="bold" className="size-3.5" />
                      {file.name}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm text-heading wrap-anywhere">{children}</dd>
    </div>
  );
}

const when = (iso: string | null) => (iso ? formatDateTime(iso) : '—');

export function DetailsPanel({ ticket }: { ticket: TicketDetail }) {
  return (
    <Panel label="Ticket details" className="p-5 contain-paint">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Row label="Subject">{ticket.subject}</Row>
        <Row label="Ticket Number">{ticketNo(ticket.number)}</Row>
        <Row label="Firm">{ticket.firm.name}</Row>
        <Row label="Contact">
          {ticket.contact.name}
          {ticket.contact.email ? (
            <span className="block text-muted">{ticket.contact.email}</span>
          ) : null}
        </Row>
        <Row label="Category">
          {ticket.category.name}
          {ticket.category.active ? null : <span className="text-muted"> (inactive)</span>}
        </Row>
        <Row label="Priority">{ticket.priority.name}</Row>
        <Row label="Status">{TICKET_STATUSES[ticket.status]}</Row>
        <Row label="Source">{TICKET_SOURCES[ticket.source]}</Row>
        <Row label="Assigned To">
          {ticket.assignee
            ? `${ticket.assignee.name}${ticket.assignee.active ? '' : ' (deactivated)'}`
            : 'Unassigned (Support Team queue)'}
        </Row>
        <Row label="Created">
          {when(ticket.createdAt)} by {ticket.createdBy.name}
        </Row>
        <Row label="Last Updated">{when(ticket.updatedAt)}</Row>
        <Row label="First Response">{when(ticket.firstResponseAt)}</Row>
        <Row label="SLA Status">
          <span className={SLA_TEXT[ticket.sla.state]}>{SLA_STATES[ticket.sla.state]}</span>
          <span className="block text-muted">{slaNote(ticket.sla)}</span>
        </Row>
        <Row label="Response Due">{when(ticket.sla.dueAt)}</Row>
        <Row label="Resolved">{when(ticket.resolvedAt)}</Row>
        <Row label="Closed">{when(ticket.closedAt)}</Row>
        <Row label="Escalation">
          {ticket.escalation
            ? `${ticket.escalation.reason} (${ticket.escalation.by}, ${formatDateTime(ticket.escalation.at)})`
            : 'Not escalated'}
        </Row>
        <Row label="Merged Into">
          {ticket.mergedInto ? ticketNo(ticket.mergedInto.number) : '—'}
        </Row>
        <div className="sm:col-span-2">
          <Row label="Description">
            <FormattedText body={ticket.description} />
          </Row>
        </div>
      </dl>
    </Panel>
  );
}

const typeName = (type: string, name: string) => {
  const extension = name.split('.').pop()?.toUpperCase() ?? '';
  if (type.startsWith('image/')) return `${extension} image`;
  if (type === 'application/pdf') return 'PDF document';
  if (type.startsWith('text/')) return `${extension} text`;
  return extension ? `${extension} document` : 'File';
};

export function AttachmentsPanel({
  ticket,
  onAdd,
  onOpen,
  busy,
}: {
  ticket: TicketDetail;
  onAdd: () => void;
  onOpen: (file: TicketAttachment, view: boolean) => void;
  busy: boolean;
}) {
  return (
    <Panel label="Attachments" className="flex flex-col gap-4 p-4 contain-paint">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-heading">Attachments</h2>
        <Button variant="secondary" onClick={onAdd}>
          <Paperclip aria-hidden weight="bold" className="size-4" />
          Add Attachment
        </Button>
      </div>
      {ticket.attachments.length === 0 ? (
        <QuietLine>No attachments yet.</QuietLine>
      ) : (
        <Table
          rows={ticket.attachments}
          rowKey={(file) => file.id}
          caption="Ticket attachments"
          noun="files"
          showPagination={false}
          rowActions={(file) => (
            <>
              <IconButton
                icon={Eye}
                label={`View ${file.name}`}
                disabled={busy}
                onClick={() => onOpen(file, true)}
              />
              <IconButton
                icon={DownloadSimple}
                label={`Download ${file.name}`}
                disabled={busy}
                onClick={() => onOpen(file, false)}
              />
            </>
          )}
          columns={[
            {
              id: 'name',
              label: 'File Name',
              cell: (file) => (
                <span className="flex items-center gap-2 font-medium text-heading">
                  <FileText aria-hidden weight="fill" className="size-5 shrink-0 text-info" />
                  <span className="wrap-anywhere">{file.name}</span>
                  {file.mergedFrom ? (
                    <Badge tone="info">From {ticketNo(file.mergedFrom)}</Badge>
                  ) : null}
                </span>
              ),
            },
            { id: 'type', label: 'Type', cell: (file) => typeName(file.type, file.name) },
            { id: 'size', label: 'Size', cell: (file) => fileSize(file.size) },
            { id: 'by', label: 'Uploaded By', cell: (file) => file.uploadedBy },
            {
              id: 'at',
              label: 'Uploaded',
              cell: (file) => <span className="whitespace-nowrap">{formatDateTime(file.at)}</span>,
            },
          ]}
        />
      )}
    </Panel>
  );
}

export function NotesPanel({
  ticket,
  allowed,
  onAdd,
}: {
  ticket: TicketDetail;
  allowed: boolean;
  onAdd: () => void;
}) {
  return (
    <Panel label="Internal notes" className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-heading">
          <LockSimple aria-hidden weight="fill" className="size-5 text-warning" />
          Internal Notes
        </h2>
        {allowed ? (
          <Button variant="secondary" onClick={onAdd}>
            <PlusCircle aria-hidden weight="fill" className="size-4" />
            Add Internal Note
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        Staff only. Never shown to the client or in notifications.
      </p>
      {!allowed ? (
        <QuietLine>You don&apos;t have permission to view internal notes.</QuietLine>
      ) : ticket.notes.length === 0 ? (
        <QuietLine>No internal notes yet.</QuietLine>
      ) : (
        <ol aria-label="Internal notes" className="flex flex-col gap-3">
          {ticket.notes.map((note) => (
            <li
              key={note.id}
              data-testid="internal-note"
              className="rounded-lg border border-gold bg-amber-surface px-4 py-3"
            >
              <p className="mb-1 flex flex-wrap items-center gap-x-3 text-sm">
                <span className="font-semibold text-heading">{note.author}</span>
                <time dateTime={note.at} className="text-xs text-muted">
                  {formatDateTime(note.at)}
                </time>
                {note.mergedFrom ? (
                  <Badge tone="info">From {ticketNo(note.mergedFrom)}</Badge>
                ) : null}
              </p>
              <FormattedText body={note.body} />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

const ACTIVITY: Record<ActivityType, { icon: Icon; tone: TimelineItem['tone'] }> = {
  CREATED: { icon: PlusCircle, tone: 'blue' },
  ASSIGNED: { icon: UserSwitch, tone: 'purple' },
  REASSIGNED: { icon: UserSwitch, tone: 'purple' },
  UNASSIGNED: { icon: UserSwitch, tone: 'grey' },
  STATUS_CHANGED: { icon: ArrowsClockwise, tone: 'blue' },
  PRIORITY_CHANGED: { icon: Flag, tone: 'amber' },
  CATEGORY_CHANGED: { icon: Tag, tone: 'blue' },
  FIRM_CHANGED: { icon: ArrowsClockwise, tone: 'navy' },
  MESSAGE: { icon: PaperPlaneTilt, tone: 'blue' },
  CLIENT_REPLY: { icon: ChatCircleText, tone: 'green' },
  NOTE: { icon: LockSimple, tone: 'amber' },
  ATTACHMENT: { icon: Paperclip, tone: 'grey' },
  ESCALATED: { icon: Warning, tone: 'red' },
  SLA_WARNING: { icon: Clock, tone: 'amber' },
  SLA_BREACHED: { icon: Clock, tone: 'red' },
  RESOLVED: { icon: CheckCircle, tone: 'green' },
  REOPENED: { icon: ArrowsClockwise, tone: 'amber' },
  CLOSED: { icon: XCircle, tone: 'grey' },
  MERGED: { icon: ArrowsMerge, tone: 'purple' },
  NOTIFICATION: { icon: Bell, tone: 'grey' },
  AUTOMATION: { icon: Lightning, tone: 'navy' },
};

function activityTitle(entry: TicketActivity): string {
  const change = entry.from
    ? ` from ${entry.from} to ${entry.to ?? '—'}`
    : ` to ${entry.to ?? '—'}`;
  const note = entry.note ? `: ${entry.note}` : '';
  switch (entry.type) {
    case 'CREATED':
      return `Ticket created${note}`;
    case 'ASSIGNED':
      return `Assigned to ${entry.to ?? '—'}${entry.note ? ` (${entry.note})` : ''}`;
    case 'REASSIGNED':
      return `Reassigned${change}${entry.note ? ` (${entry.note})` : ''}`;
    case 'UNASSIGNED':
      return `Moved to ${entry.to ?? 'the Support Team queue'}${entry.from ? ` (was ${entry.from})` : ''}`;
    case 'STATUS_CHANGED':
      return `Status changed${change}`;
    case 'PRIORITY_CHANGED':
      return `Priority changed${change}`;
    case 'CATEGORY_CHANGED':
      return `Category changed${change}`;
    case 'FIRM_CHANGED':
      return `Firm / contact changed${change}`;
    case 'MESSAGE':
      return `Support reply${note}`;
    case 'CLIENT_REPLY':
      return `Client replied${note}`;
    case 'NOTE':
      return 'Internal note added';
    case 'ATTACHMENT':
      return `Attachment added: ${entry.to ?? 'file'}`;
    case 'ESCALATED':
      return `Escalated${note}`;
    case 'SLA_WARNING':
      return `SLA warning${note}`;
    case 'SLA_BREACHED':
      return `SLA breached${note}`;
    case 'RESOLVED':
      return 'Resolved';
    case 'REOPENED':
      return 'Reopened';
    case 'CLOSED':
      return 'Closed';
    case 'MERGED':
      return `Merged ${entry.from ?? ''} into ${entry.to ?? ''}`;
    case 'NOTIFICATION':
    case 'AUTOMATION':
      return entry.note ?? 'Automation ran';
  }
}

export function ActivityPanel({ ticket }: { ticket: TicketDetail }) {
  return (
    <Panel label="Activity history" className="p-4 contain-paint">
      <Timeline
        label="Activity history"
        variant="rail"
        emptyText="No activity yet."
        items={ticket.activity.map((entry) => ({
          id: entry.id,
          icon: ACTIVITY[entry.type].icon,
          tone: ACTIVITY[entry.type].tone,
          title: activityTitle(entry),
          time: formatDateTime(entry.at),
          dateTime: entry.at,
          actor: entry.actor,
        }))}
      />
    </Panel>
  );
}
