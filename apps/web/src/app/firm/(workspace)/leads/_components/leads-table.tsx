'use client';

import type { LeadRow } from '@firmivra/types';
import { ActionMenu, Avatar, Badge, Button, IconButton, Table, type Column } from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  Archive,
  CalendarBlank,
  ChartLine,
  ChatCircleDots,
  DotsThreeVertical,
  EnvelopeSimple,
  Eye,
  NotePencil,
  Phone,
  PencilSimple,
  Tag,
  UserPlus,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  dateLabel,
  fullName,
  PRIORITY_LABELS,
  priorityTone,
  SOURCE_LABELS,
  STAGE_LABELS,
  stageTone,
} from './lead-shared';

export type LeadRowAction = 'APPOINTMENT' | 'ASSIGN' | 'ARCHIVE' | 'EDIT' | 'STAGE' | 'TAGS';

interface LeadsTableProps {
  rows: LeadRow[];
  /** Instead of "No leads match these filters" (the list could not load: say why). */
  empty?: { title: string; text: string } | undefined;
  total: number;
  page: number;
  pageSize: number;
  selected: string[];
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  onSelectionChange: (keys: string[]) => void;
  onCall: (lead: LeadRow) => void;
  onMessage: (lead: LeadRow, channel: 'EMAIL' | 'SMS') => void;
  onRowAction: (lead: LeadRow, action: LeadRowAction) => void;
  /**
   * Archived Leads (L10): names are not links (an archived lead has no workspace until it is
   * restored) and Restore is the only action, when the member may restore.
   */
  archived?: { onRestore: (lead: LeadRow) => void; canRestore: boolean };
  /** Archive (Delete) in the row's menu: Firm Admin only, the Owner and the Admin (L11). */
  canDelete?: boolean;
}

const columns: Column<LeadRow>[] = [
  {
    id: 'name',
    label: 'Name',
    className: 'w-24',
    cell: (lead) => {
      const name = fullName(lead.firstName, lead.lastName, lead.email);
      return (
        <Link
          href={`/leads/${lead.id}`}
          className="flex min-w-0 items-center gap-1 text-navigation hover:underline"
        >
          <Avatar name={name} src={lead.avatarUrl ?? undefined} size="md" />
          <span className="min-w-0 truncate text-xs font-semibold">{name}</span>
        </Link>
      );
    },
  },
  {
    id: 'contact',
    label: 'Contact Info',
    className: 'w-31',
    cell: (lead) => (
      <span className="block min-w-0">
        {lead.phone ? (
          <span className="block truncate text-xs font-semibold text-navigation">{lead.phone}</span>
        ) : null}
        <span className="block truncate text-muted" title={lead.email}>
          {lead.email}
        </span>
      </span>
    ),
  },
  {
    id: 'source',
    label: 'Lead Source / Campaign',
    className: 'w-27',
    cell: (lead) => (
      <span className="block min-w-0">
        <span className="block truncate text-xs font-semibold text-navigation">
          {SOURCE_LABELS[lead.source]}
        </span>
        {lead.campaign?.name || lead.sourceDetail ? (
          <span
            className="block truncate text-xs font-normal text-muted"
            title={lead.campaign?.name ?? lead.sourceDetail ?? undefined}
          >
            {lead.campaign?.name ?? lead.sourceDetail}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: 'services',
    label: 'Services Interested In',
    className: 'w-32',
    cell: (lead) => (
      <span className="flex min-w-0 flex-wrap gap-1">
        {lead.services.length ? (
          lead.services.map((service) => (
            <Badge key={service.id} tone="info">
              {service.name}
            </Badge>
          ))
        ) : (
          <span className="text-muted">—</span>
        )}
      </span>
    ),
  },
  {
    id: 'priority',
    label: 'Priority',
    className: 'w-15',
    cell: (lead) => (
      <Badge tone={priorityTone(lead.priority)}>{PRIORITY_LABELS[lead.priority]}</Badge>
    ),
  },
  {
    id: 'stage',
    label: 'Status',
    className: 'w-19',
    cell: (lead) => <Badge tone={stageTone(lead.stage)}>{STAGE_LABELS[lead.stage]}</Badge>,
  },
  {
    id: 'lastContact',
    label: 'Last Contact',
    className: 'w-18',
    cell: (lead) => (
      <span className="block min-w-0">
        {lead.lastContact ? (
          <time dateTime={lead.lastContact.at} className="block">
            <span className="block">
              {new Date(lead.lastContact.at).toLocaleDateString('en-US', { dateStyle: 'medium' })}
            </span>
            <span className="block text-muted">
              {new Date(lead.lastContact.at).toLocaleTimeString('en-US', { timeStyle: 'short' })}
            </span>
          </time>
        ) : (
          <span className="text-muted">No contact yet</span>
        )}
      </span>
    ),
  },
  {
    id: 'nextAction',
    label: 'Next Action',
    className: 'w-25',
    cell: (lead) => {
      const action = lead.nextAction;
      if (!action) return <span className="min-w-28 text-muted">No further action</span>;
      const label = action.type
        .replaceAll('_', ' ')
        .toLowerCase()
        .replace(/^./, (char) => char.toUpperCase());
      return (
        <span
          className={`block min-w-0 ${action.overdue ? 'rounded-md bg-danger-soft px-1 py-1 text-danger' : ''}`}
        >
          <span
            className={`${action.overdue ? 'block font-medium' : 'block text-xs font-semibold text-navigation'}`}
          >
            {action.overdue ? `Overdue: ${label}` : label}
          </span>
          {action.dueAt ? (
            <time dateTime={action.dueAt} className={action.overdue ? 'block' : 'block text-muted'}>
              {dateLabel(action.dueAt, true)}
            </time>
          ) : null}
        </span>
      );
    },
  },
  {
    id: 'assigned',
    label: 'Assigned To',
    className: 'w-18',
    cell: (lead) =>
      lead.assignedTo ? (
        <span className="flex min-w-0 items-center gap-1">
          <Avatar name={lead.assignedTo.name} size="sm" />
          <span className="min-w-0 truncate text-xs font-semibold">{lead.assignedTo.name}</span>
        </span>
      ) : (
        <span className="text-muted">Unassigned</span>
      ),
  },
  {
    id: 'createdAt',
    label: 'Date Added',
    className: 'w-17',
    cell: (lead) => (
      <time dateTime={lead.createdAt} className="block truncate" title={dateLabel(lead.createdAt)}>
        {dateLabel(lead.createdAt)}
      </time>
    ),
  },
];

/** The archived view's columns: the name as text, not a link to a workspace (L10). */
const archivedColumns: Column<LeadRow>[] = columns.map((column) =>
  column.id === 'name'
    ? {
        ...column,
        cell: (lead) => {
          const name = fullName(lead.firstName, lead.lastName, lead.email);
          return (
            <span className="flex min-w-0 items-center gap-1 text-navigation">
              <Avatar name={name} src={lead.avatarUrl ?? undefined} size="md" />
              <span className="min-w-0 truncate text-xs font-semibold">{name}</span>
            </span>
          );
        },
      }
    : column,
);

export function LeadsTable({
  rows,
  empty,
  total,
  page,
  pageSize,
  selected,
  onPage,
  onPageSize,
  onSelectionChange,
  onCall,
  onMessage,
  onRowAction,
  archived,
  canDelete = false,
}: LeadsTableProps) {
  const router = useRouter();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="min-w-0 rounded-card border border-border bg-surface [&_nav]:!pl-3 [&_nav]:!pr-3 [&_nav]:!pb-3 [&_td_span.rounded-pill]:!rounded-md">
      <Table
        caption="Leads"
        rows={rows}
        columns={archived ? archivedColumns : columns}
        rowKey={(lead) => lead.id}
        dense
        noun="leads"
        // Column widths and 12 px text from leads/source/leads.jpg, so every column fits at 1440 px
        // (R1 firm audit, Oct 20).
        tableClassName="table-fixed [&_thead]:!text-navigation [&_th]:!whitespace-normal [&_th]:!px-1 [&_th]:!text-xs [&_th]:!font-semibold [&_th]:!text-navigation [&_th:first-child]:!w-10 [&_th:first-child]:!pl-3 [&_td:first-child]:!pl-3 [&_th:last-child]:!w-50 [&_th:last-child]:!text-left [&_td]:!px-1 [&_td]:!py-2 [&_td:last-child]:!w-50 [&_td:last-child>div]:!justify-start"
        pageSize={pageSize}
        pageSizes={[8, 16, 24]}
        onPageSize={onPageSize}
        server={{
          page,
          hasPrevious: page > 1,
          hasNext: page < pageCount,
          total,
          onPage,
          onNext: () => onPage(page + 1),
          onPrevious: () => onPage(page - 1),
          onSort: () => undefined,
        }}
        selection={{ selected, onChange: onSelectionChange }}
        emptyTitle={empty?.title ?? 'No leads match these filters'}
        emptyText={empty?.text ?? 'Try another search or clear a filter to see more leads.'}
        rowActions={(lead) =>
          archived ? (
            archived.canRestore ? (
              <Button
                variant="secondary"
                onClick={() => archived.onRestore(lead)}
                aria-label={`Restore ${fullName(lead.firstName, lead.lastName, lead.email)}`}
              >
                <ArrowCounterClockwise aria-hidden weight="bold" className="size-4" />
                Restore
              </Button>
            ) : null
          ) : (
            <>
              <IconButton
                icon={Phone}
                label={`Call ${fullName(lead.firstName, lead.lastName, lead.email)}`}
                disabled={!lead.phone}
                className="!size-6"
                onClick={() => onCall(lead)}
              />
              <IconButton
                icon={EnvelopeSimple}
                tone="danger"
                label={`Send email to ${lead.email}`}
                className="!size-6"
                onClick={() => onMessage(lead, 'EMAIL')}
              />
              <IconButton
                icon={ChatCircleDots}
                tone="action"
                label={`Send SMS to ${fullName(lead.firstName, lead.lastName, lead.email)}`}
                disabled={!lead.phone}
                className="!size-6"
                onClick={() => onMessage(lead, 'SMS')}
              />
              <IconButton
                icon={CalendarBlank}
                tone="action"
                label={`Schedule an appointment with ${fullName(lead.firstName, lead.lastName, lead.email)}`}
                className="!size-6"
                onClick={() => onRowAction(lead, 'APPOINTMENT')}
              />
              <IconButton
                icon={NotePencil}
                tone="accent"
                label={`View notes for ${fullName(lead.firstName, lead.lastName, lead.email)}`}
                className="!size-6"
                onClick={() => router.push(`/leads/${lead.id}/notes`)}
              />
              <IconButton
                icon={ChartLine}
                tone="action"
                label={`View activity for ${fullName(lead.firstName, lead.lastName, lead.email)}`}
                className="!size-6"
                onClick={() => router.push(`/leads/${lead.id}/activity`)}
              />
              <ActionMenu
                label={`More actions for ${fullName(lead.firstName, lead.lastName, lead.email)}`}
                className="[&>button>svg:last-child]:hidden [&>button]:!size-6 [&>button]:!min-h-0 [&>button]:!gap-0 [&>button]:!justify-center [&>button]:!px-0"
                trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
                sections={[
                  {
                    title: 'Lead',
                    items: [
                      {
                        label: 'View',
                        icon: Eye,
                        onSelect: () => router.push(`/leads/${lead.id}`),
                      },
                      {
                        label: 'Edit',
                        icon: PencilSimple,
                        onSelect: () => onRowAction(lead, 'EDIT'),
                      },
                      {
                        label: 'Assign',
                        icon: UserPlus,
                        onSelect: () => onRowAction(lead, 'ASSIGN'),
                      },
                      { label: 'Tags', icon: Tag, onSelect: () => onRowAction(lead, 'TAGS') },
                      {
                        label: 'Change Status',
                        icon: ArrowsClockwise,
                        onSelect: () => onRowAction(lead, 'STAGE'),
                      },
                      ...(lead.stage === 'CONVERTED' || lead.stage === 'DECLINED'
                        ? []
                        : [
                            {
                              label: 'Convert to Client',
                              icon: UserPlus,
                              onSelect: () => router.push(`/leads/${lead.id}/convert`),
                            },
                          ]),
                      ...(canDelete
                        ? [
                            {
                              label: 'Archive',
                              icon: Archive,
                              danger: true,
                              onSelect: () => onRowAction(lead, 'ARCHIVE'),
                            },
                          ]
                        : []),
                    ],
                  },
                ]}
              />
            </>
          )
        }
      />
    </div>
  );
}
