'use client';

import {
  ArrowSquareOut,
  ArrowUpRight,
  ArrowsMerge,
  Buildings,
  FileText,
  Paperclip,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import {
  SLA_STATES,
  TICKET_SOURCES,
  TICKET_STATUSES,
  type SupportDirectory,
  type SupportPermission,
  type SupportSettings,
  type TicketDetail,
  type TicketStatus,
} from '../../../../../../../mocks/admin-support';
import { SelectField } from '../../../_components/fields';
import {
  formatDateTime,
  PRIORITY_DOTS,
  SLA_DOTS,
  SLA_TEXT,
  slaNote,
  STATUS_DOTS,
  ticketNo,
} from '../../../_components/support-data';
import { Dot, Panel, RowMenu, type RowMenuItem } from '../../../_components/support-parts';
import { statusOptions } from '../../../_components/ticket-actions';
import { Initials } from './ticket-panels';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-sm text-text">{label}</span>
      <span className="text-sm text-heading">{children}</span>
    </div>
  );
}

/** The statuses for a select: the ones this person may set, plus the current one. */
function withCurrent(status: TicketStatus, permissions: SupportPermission[]) {
  const options = statusOptions(permissions);
  return options.some((o) => o.value === status)
    ? options
    : [{ value: status, label: TICKET_STATUSES[status] }, ...options];
}

/**
 * Ticket Information (docx §3): number, status, priority, category, assignee, SLA, source and
 * times. Status, priority and category change the master ticket record from here.
 */
export function TicketInfoCard({
  ticket,
  settings,
  permissions,
  busy,
  menu,
  onStatus,
  onPriority,
  onCategory,
}: {
  ticket: TicketDetail;
  settings: SupportSettings | undefined;
  permissions: SupportPermission[];
  busy: boolean;
  menu: RowMenuItem[];
  onStatus: (status: TicketStatus) => void;
  onPriority: (id: string) => void;
  onCategory: (id: string) => void;
}) {
  const id = useId();
  const priorities = [...(settings?.priorities ?? [])]
    .filter((p) => p.active || p.id === ticket.priority.id)
    .sort((a, b) => a.rank - b.rank);
  const categories = (settings?.categories ?? []).filter(
    (c) => c.active || c.id === ticket.category.id,
  );
  return (
    <Panel label="Ticket Information" testId="ticket-information" className="p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-heading">Ticket Information</h2>
        <RowMenu vertical label="Ticket information actions" items={menu} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Item label="Ticket Number">
          <span className="text-base font-bold">{ticketNo(ticket.number)}</span>
        </Item>
        <div className="min-w-0">
          <SelectField
            id={`${id}-status`}
            label="Status"
            dot={STATUS_DOTS[ticket.status]}
            disabled={busy}
            options={withCurrent(ticket.status, permissions)}
            value={ticket.status}
            onChange={(event) => onStatus(event.target.value as TicketStatus)}
          />
        </div>
        <div className="min-w-0">
          <SelectField
            id={`${id}-priority`}
            label="Priority"
            dot={PRIORITY_DOTS[ticket.priority.color]}
            disabled={busy || !settings}
            options={
              priorities.length
                ? priorities.map((p) => ({
                    value: p.id,
                    label: p.active ? p.name : `${p.name} (inactive)`,
                  }))
                : [{ value: ticket.priority.id, label: ticket.priority.name }]
            }
            value={ticket.priority.id}
            onChange={(event) => onPriority(event.target.value)}
          />
        </div>
        <div className="min-w-0">
          <SelectField
            id={`${id}-category`}
            label="Category"
            disabled={busy || !settings}
            options={
              categories.length
                ? categories.map((c) => ({
                    value: c.id,
                    label: c.active ? c.name : `${c.name} (inactive)`,
                  }))
                : [{ value: ticket.category.id, label: ticket.category.name }]
            }
            value={ticket.category.id}
            onChange={(event) => onCategory(event.target.value)}
          />
        </div>
        <Item label="Assigned To">
          {ticket.assignee ? (
            <span className="flex items-center gap-3">
              <Initials name={ticket.assignee.name} tone="solid" size="md" />
              <span>
                {ticket.assignee.name}
                {ticket.assignee.active ? null : (
                  <span className="block text-xs text-muted">Deactivated</span>
                )}
              </span>
            </span>
          ) : (
            <span className="text-muted">Unassigned</span>
          )}
        </Item>
        <Item label="SLA Status">
          <span
            data-testid="sla-status"
            className={`flex items-center gap-2 font-semibold ${SLA_TEXT[ticket.sla.state]}`}
          >
            <Dot className={SLA_DOTS[ticket.sla.state]} />
            {ticket.sla.state === 'WITHIN' ? 'Within SLA' : SLA_STATES[ticket.sla.state]}
          </span>
          <span className="mt-0.5 block text-xs text-muted">{slaNote(ticket.sla)}</span>
        </Item>
        <Item label="Source">{TICKET_SOURCES[ticket.source]}</Item>
        <Item label="Created">
          <span className="text-text">{formatDateTime(ticket.createdAt)}</span>
        </Item>
        <Item label="Last Updated">
          <span className="text-text">{formatDateTime(ticket.updatedAt)}</span>
        </Item>
      </div>
    </Panel>
  );
}

/** Client / Firm: the firm (linked to its profile) and the contact, from the firm records. */
export function ClientFirmCard({
  ticket,
  directory,
  onEdit,
}: {
  ticket: TicketDetail;
  directory: SupportDirectory | undefined;
  /** Left out: the ticket's firm and contact are fixed (B2), so there is nothing to edit. */
  onEdit?: () => void;
}) {
  const firm = directory?.firms.find((f) => f.id === ticket.firm.id);
  const primary = firm?.contacts.find((c) => c.id === ticket.contact.id)?.primary ?? true;
  return (
    <Panel label="Client / Firm" testId="client-firm" className="p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-heading">Client / Firm</h2>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="text-sm font-medium text-link hover:underline"
          >
            Edit
          </button>
        ) : null}
      </div>
      <div className="flex gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
          <Buildings aria-hidden weight="fill" className="size-7" />
        </span>
        <dl className="flex min-w-0 flex-col gap-2 text-sm">
          <div>
            <dt className="sr-only">Firm</dt>
            <dd>
              <Link
                href={`/firms/${ticket.firm.id}`}
                className="inline-flex max-w-full items-center gap-1.5 font-semibold text-heading wrap-anywhere hover:underline"
              >
                {ticket.firm.name}
                <ArrowSquareOut aria-hidden weight="bold" className="size-4 shrink-0 text-action" />
                <span className="sr-only">(open firm profile)</span>
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-text">{primary ? 'Primary Contact' : 'Contact'}</dt>
            <dd className="text-base text-link">{ticket.contact.name}</dd>
          </div>
          <div>
            <dt className="text-text">Email</dt>
            <dd>
              {ticket.contact.email ? (
                <a
                  href={`mailto:${ticket.contact.email}`}
                  className="text-base text-link wrap-anywhere hover:underline"
                >
                  {ticket.contact.email}
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-4">
            <dt className="text-text">Phone</dt>
            <dd>
              {ticket.contact.phone ? (
                <a
                  href={`tel:${ticket.contact.phone.replace(/[^\d+]/g, '')}`}
                  className="text-base text-link hover:underline"
                >
                  {ticket.contact.phone}
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}

export function QuickActions({
  actions,
}: {
  actions: { label: string; icon: Icon; onSelect: () => void; hidden?: boolean }[];
}) {
  return (
    <Panel label="Quick Actions" testId="quick-actions" className="p-5">
      <h2 className="mb-4 text-lg font-bold text-heading">Quick Actions</h2>
      <ul className="flex flex-col gap-2">
        {actions
          .filter((action) => !action.hidden)
          .map((action) => (
            <li key={action.label}>
              <button
                type="button"
                onClick={action.onSelect}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 text-sm text-text hover:bg-canvas"
              >
                <action.icon aria-hidden weight="fill" className="size-5 text-heading" />
                {action.label}
              </button>
            </li>
          ))}
      </ul>
    </Panel>
  );
}

export const QUICK_ICONS = {
  note: FileText,
  attach: Paperclip,
  status: ArrowUpRight,
  merge: ArrowsMerge,
} satisfies Record<string, Icon>;
