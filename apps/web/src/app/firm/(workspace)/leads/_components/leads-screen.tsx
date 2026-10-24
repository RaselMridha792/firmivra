'use client';

import type {
  LeadPipelineQuery,
  LeadPriority,
  LeadRow,
  LeadSource,
  LeadPipelineStatus,
} from '@firmivra/types';
import {
  BulkBar,
  Button,
  Checkbox,
  FilterBar,
  FilterChip,
  FilterGroup,
  KpiCard,
  Select,
} from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  Clock,
  ClockCountdown,
  Handshake,
  Plus,
  Tag,
  Trash,
  UserPlus,
  Users,
  XCircle,
  ChatCircleDots,
  EnvelopeSimple,
} from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useFirm } from '../../../../../components/firm-context';
import { errorCode, errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { LeadBulkDialog, type LeadBulkDialogState } from './lead-bulk-dialog';
import { LeadAppointmentDialog } from './lead-appointment-dialog';
import { LeadsActionLegend } from './leads-action-legend';
import { LeadCreateDialog } from './lead-create-dialog';
import { LeadEditDialog } from './lead-edit-dialog';
import { LeadMessageDialog, type MessageRecipient, recipientOf } from './lead-message-dialog';
import { LeadsDateFilter } from './leads-date-filter';
import { LEAD_PIPELINE_KEY, PRIORITIES, SOURCES, STAGES, summaryTrend } from './lead-shared';
import { LeadsTable, type LeadRowAction } from './leads-table';

interface LeadFilters {
  source: LeadSource | '';
  serviceId: string;
  stage: LeadPipelineStatus | '';
  assignedUserId: string;
  from: string;
  to: string;
  priority: LeadPriority | '';
  campaignId: string;
  tag: string;
  overdue: boolean;
  /** Archived Leads (L10): only the archived ones, with Restore. */
  archived: boolean;
}

/** The dropdowns' choices before (or without) GET /business/leads/options: the "All …" entries. */
const NO_OPTIONS = { services: [], staff: [], campaigns: [], tags: [] };

const EMPTY_FILTERS: LeadFilters = {
  source: '',
  serviceId: '',
  stage: '',
  assignedUserId: '',
  from: '',
  to: '',
  priority: '',
  campaignId: '',
  tag: '',
  overdue: false,
  archived: false,
};

function LeadsSummary({
  summary,
  filters,
  onFilter,
}: {
  /** Undefined while loading or when the counts could not load: each card shows a dash. */
  summary: Awaited<ReturnType<typeof api.leadPipeline.summary>> | undefined;
  filters: LeadFilters;
  onFilter: (patch: Partial<LeadFilters>) => void;
}) {
  const cards = [
    {
      key: 'total',
      label: 'Total Leads',
      metric: summary?.total,
      icon: Users,
      tone: 'blue' as const,
      active: !filters.stage && !filters.overdue,
      select: () => onFilter({ stage: '', overdue: false }),
      decreasesAreGood: false,
    },
    {
      key: 'new',
      label: 'New Leads',
      metric: summary?.new,
      icon: UserPlus,
      tone: 'amber' as const,
      active: filters.stage === 'SUBMITTED',
      select: () => onFilter({ stage: 'SUBMITTED', overdue: false }),
      decreasesAreGood: false,
    },
    {
      key: 'follow-up',
      label: 'In Follow-Up',
      metric: summary?.inFollowUp,
      icon: Clock,
      tone: 'purple' as const,
      active: filters.stage === 'IN_FOLLOW_UP',
      select: () => onFilter({ stage: 'IN_FOLLOW_UP', overdue: false }),
      decreasesAreGood: false,
    },
    {
      key: 'converted',
      label: 'Converted to Clients',
      metric: summary?.converted,
      icon: Handshake,
      tone: 'green' as const,
      active: filters.stage === 'CONVERTED',
      select: () => onFilter({ stage: 'CONVERTED', overdue: false }),
      decreasesAreGood: false,
    },
    {
      key: 'not-qualified',
      label: 'Not Qualified',
      metric: summary?.notQualified,
      icon: XCircle,
      tone: 'red' as const,
      active: filters.stage === 'DECLINED',
      select: () => onFilter({ stage: 'DECLINED', overdue: false }),
      decreasesAreGood: true,
    },
    {
      key: 'overdue',
      label: 'Overdue Follow-Ups',
      metric: summary?.overdueFollowUps,
      icon: ClockCountdown,
      tone: 'red' as const,
      active: filters.overdue,
      select: () => onFilter({ stage: '', overdue: true }),
      decreasesAreGood: true,
    },
  ];

  return (
    <section
      aria-label="Lead summary"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6"
    >
      {cards.map((card) => (
        <button
          key={card.key}
          type="button"
          aria-pressed={card.active}
          onClick={card.select}
          className={`rounded-xl text-left focus-visible:outline-2 focus-visible:outline-focus ${card.active ? 'ring-2 ring-action' : ''}`}
        >
          <KpiCard
            icon={card.icon}
            tone={card.tone}
            value={card.metric ? card.metric.value.toLocaleString('en-US') : '—'}
            label={card.label}
            trend={card.metric ? summaryTrend(card.metric, card.decreasesAreGood) : undefined}
            note="vs last month"
          />
        </button>
      ))}
    </section>
  );
}

function LeadFilters({
  filters,
  options,
  onFilter,
  onReset,
}: {
  filters: LeadFilters;
  options: NonNullable<Awaited<ReturnType<typeof api.leadPipeline.options>>>;
  onFilter: (patch: Partial<LeadFilters>) => void;
  onReset: () => void;
}) {
  const more = (
    <>
      <FilterGroup title="Priority">
        <Select
          label="All Priorities"
          hideLabel
          value={filters.priority}
          onChange={(event) => onFilter({ priority: event.target.value as LeadPriority | '' })}
          options={[{ value: '', label: 'All Priorities' }, ...PRIORITIES]}
        />
      </FilterGroup>
      <FilterGroup title="Campaign">
        <Select
          label="All Campaigns"
          hideLabel
          value={filters.campaignId}
          onChange={(event) => onFilter({ campaignId: event.target.value })}
          options={[
            { value: '', label: 'All Campaigns' },
            ...(options.campaigns?.map((campaign) => ({
              value: campaign.id,
              label: campaign.name,
            })) ?? []),
          ]}
        />
      </FilterGroup>
      <FilterGroup title="Tag">
        <Select
          label="All Tags"
          hideLabel
          value={filters.tag}
          onChange={(event) => onFilter({ tag: event.target.value })}
          options={[
            { value: '', label: 'All Tags' },
            ...options.tags.map((tag) => ({ value: tag, label: tag })),
          ]}
        />
      </FilterGroup>
      <FilterGroup title="Follow-Up">
        <Checkbox
          label="Overdue only"
          checked={filters.overdue}
          onChange={(event) => onFilter({ overdue: event.target.checked })}
        />
      </FilterGroup>
      <FilterGroup title="Archive">
        <Checkbox
          label="Archived leads"
          checked={filters.archived}
          onChange={(event) => onFilter({ archived: event.target.checked })}
        />
      </FilterGroup>
    </>
  );

  return (
    <FilterBar more={more} onReset={onReset}>
      <div className="w-full min-w-40 flex-1 sm:w-auto">
        <Select
          label="All Lead Sources"
          hideLabel
          value={filters.source}
          onChange={(event) => onFilter({ source: event.target.value as LeadSource | '' })}
          options={[{ value: '', label: 'All Lead Sources' }, ...SOURCES]}
        />
      </div>
      <div className="w-full min-w-40 flex-1 sm:w-auto">
        <Select
          label="All Services Interested In"
          hideLabel
          value={filters.serviceId}
          onChange={(event) => onFilter({ serviceId: event.target.value })}
          options={[
            { value: '', label: 'All Services Interested In' },
            ...options.services.map((service) => ({ value: service.id, label: service.name })),
          ]}
        />
      </div>
      <div className="w-full min-w-40 flex-1 sm:w-auto">
        <Select
          label="All Lead Statuses"
          hideLabel
          value={filters.stage}
          onChange={(event) => onFilter({ stage: event.target.value as LeadPipelineStatus | '' })}
          options={[{ value: '', label: 'All Lead Statuses' }, ...STAGES]}
        />
      </div>
      <div className="w-full min-w-40 flex-1 sm:w-auto">
        <Select
          label="All Staff Members"
          hideLabel
          value={filters.assignedUserId}
          onChange={(event) => onFilter({ assignedUserId: event.target.value })}
          options={[
            { value: '', label: 'All Staff Members' },
            ...options.staff.map((member) => ({ value: member.userId, label: member.name })),
          ]}
        />
      </div>
      <LeadsDateFilter
        value={{ from: filters.from, to: filters.to }}
        onChange={(range) => onFilter({ from: range.from, to: range.to })}
      />
    </FilterBar>
  );
}

export function LeadsScreen() {
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [selected, setSelected] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState<{
    recipients: MessageRecipient[];
    channel: 'EMAIL' | 'SMS';
  } | null>(null);
  const [bulkDialog, setBulkDialog] = useState<LeadBulkDialogState>(null);
  const [editingLead, setEditingLead] = useState<LeadRow | null>(null);
  const [appointmentLead, setAppointmentLead] = useState<LeadRow | null>(null);
  const summary = useApiQuery([...LEAD_PIPELINE_KEY, 'summary'], () => api.leadPipeline.summary());
  const options = useApiQuery([...LEAD_PIPELINE_KEY, 'options'], () => api.leadPipeline.options());
  // Delete (the archive) and Restore: Firm Admin only, the Owner and the Admin (L11).
  const { role } = useFirm();
  const canDelete = role === 'OWNER' || role === 'ADMIN';
  const canRestore = canDelete;
  const restore = useApiMutation(
    (ids: string[]) => api.leadPipeline.bulk({ action: 'RESTORE', ids }),
    { invalidate: LEAD_PIPELINE_KEY },
  );
  const query = useMemo<LeadPipelineQuery>(
    () => ({
      page,
      pageSize,
      ...(filters.source ? { source: filters.source } : {}),
      ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
      ...(filters.stage ? { stage: filters.stage } : {}),
      ...(filters.assignedUserId ? { assignedUserId: filters.assignedUserId } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
      ...(filters.tag ? { tag: filters.tag } : {}),
      ...(filters.overdue ? { overdue: true } : {}),
      ...(filters.archived ? { archived: true } : {}),
    }),
    [filters, page, pageSize],
  );
  const leads = useApiQuery([...LEAD_PIPELINE_KEY, 'list', query], () =>
    api.leadPipeline.list(query),
  );
  // Each selected row as it was picked, so a selection kept across pages still knows each lead's
  // number and email for the composer.
  const [chosen, setChosen] = useState<Map<string, LeadRow>>(() => new Map());
  const select = (ids: string[]) => {
    const rows = leads.data?.items ?? [];
    setChosen((before) => {
      const next = new Map<string, LeadRow>();
      for (const id of ids) {
        const row = before.get(id) ?? rows.find((r) => r.id === id);
        if (row) next.set(id, row);
      }
      return next;
    });
    setSelected(ids);
  };
  const recipientsOf = (ids: string[]) =>
    ids.flatMap((id) => {
      const row = chosen.get(id);
      return row ? [recipientOf(row)] : [];
    });
  const logCall = useApiMutation(
    ({ id }: { id: string }) =>
      api.leadPipeline.logActivity(id, { kind: 'CALL', summary: 'Called lead' }),
    { invalidate: LEAD_PIPELINE_KEY },
  );

  const changeFilters = (patch: Partial<LeadFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
    setSelected([]);
  };
  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
    setSelected([]);
  };

  const openBulk = (action: NonNullable<LeadBulkDialogState>['action'], ids = selected) =>
    setBulkDialog({ action, ids });
  const onRowAction = (lead: LeadRow, action: LeadRowAction) => {
    if (action === 'APPOINTMENT') {
      setAppointmentLead(lead);
      return;
    }
    if (action === 'EDIT') {
      setEditingLead(lead);
      return;
    }
    openBulk(action, [lead.id]);
  };

  const sourceTitle = 'Capture. Nurture. Convert.';
  /** The bulk bar and the table for one page of leads (or an empty page with the reason). */
  const renderLeads = (data: NonNullable<typeof leads.data>) => {
    const rowIds = data.items.map((lead) => lead.id);
    const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.includes(id));
    const bulkActions = [
      {
        label: 'Send Email',
        icon: EnvelopeSimple,
        onClick: () =>
          setMessage({ recipients: recipientsOf(selected), channel: 'EMAIL' as const }),
      },
      {
        label: 'Send SMS',
        icon: ChatCircleDots,
        onClick: () => setMessage({ recipients: recipientsOf(selected), channel: 'SMS' as const }),
      },
      { label: 'Assign Staff', icon: UserPlus, onClick: () => openBulk('ASSIGN') },
      { label: 'Change Status', icon: ArrowsClockwise, onClick: () => openBulk('STAGE') },
      { label: 'Add to Campaign', icon: EnvelopeSimple, onClick: () => openBulk('CAMPAIGN') },
      { label: 'Add Tags', icon: Tag, onClick: () => openBulk('TAGS') },
      ...(canDelete
        ? [{ label: 'Delete', icon: Trash, danger: true, onClick: () => openBulk('ARCHIVE') }]
        : []),
    ];
    // Archived Leads (L10): Restore is the only bulk action, for those who may restore.
    const archivedActions = canRestore
      ? [{ label: 'Restore', icon: ArrowCounterClockwise, onClick: () => restore.mutate(selected) }]
      : [];
    const actions: typeof bulkActions = filters.archived ? archivedActions : bulkActions;
    const updateSelection = (checked: boolean) =>
      select(
        checked
          ? [...new Set([...selected, ...rowIds])]
          : selected.filter((id) => !rowIds.includes(id)),
      );
    const setCheckboxIndeterminate = (box: HTMLInputElement | null) => {
      if (box) box.indeterminate = !allSelected && rowIds.some((id) => selected.includes(id));
    };
    return (
      <>
        <div className="hidden flex-wrap items-center gap-2 xl:flex">
          <label className="inline-flex size-9 items-center justify-center rounded-lg border border-divider bg-surface">
            <input
              type="checkbox"
              aria-label="Select all leads on this page"
              className="size-4 cursor-pointer rounded-sm"
              checked={allSelected}
              ref={setCheckboxIndeterminate}
              onChange={(event) => updateSelection(event.target.checked)}
            />
          </label>
          <BulkBar count={selected.length} noun="leads" actions={actions} />
        </div>
        <div className="min-w-0 xl:hidden">
          <div className="flex items-center gap-2">
            <label className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-divider bg-surface">
              <input
                type="checkbox"
                aria-label="Select all leads on this page"
                className="size-4 cursor-pointer rounded-sm"
                checked={allSelected}
                ref={setCheckboxIndeterminate}
                onChange={(event) => updateSelection(event.target.checked)}
              />
            </label>
            <p aria-live="polite" className="text-sm font-semibold text-heading">
              {selected.length} leads selected
            </p>
          </div>
          <div
            role="toolbar"
            aria-label="Bulk actions"
            className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3"
          >
            {actions.map(({ label, icon: Icon, onClick, danger }) => (
              <Button
                key={label}
                variant="secondary"
                disabled={!selected.length}
                onClick={onClick}
                className={`!min-h-9 !w-full !justify-start !px-3 !py-2 text-left whitespace-normal disabled:cursor-not-allowed disabled:opacity-60 ${danger ? '!border-danger-soft !text-danger' : '!border-divider !text-text'}`}
              >
                <Icon
                  aria-hidden
                  weight="fill"
                  className={`size-4 shrink-0 ${danger ? '' : 'text-action'}`}
                />
                <span className="min-w-0">{label}</span>
              </Button>
            ))}
          </div>
        </div>
        <LeadsTable
          canDelete={canDelete}
          archived={
            filters.archived
              ? { canRestore, onRestore: (lead) => restore.mutate([lead.id]) }
              : undefined
          }
          rows={data.items}
          total={data.total}
          page={data.page}
          pageSize={pageSize}
          selected={selected}
          onPage={(next) => setPage(next)}
          onPageSize={(size) => {
            setPageSize(size);
            setPage(1);
            setSelected([]);
          }}
          onSelectionChange={select}
          onCall={(lead) => {
            if (!lead.phone) return;
            void logCall
              .mutateAsync({ id: lead.id })
              .catch(() => undefined)
              .then(() => window.location.assign(`tel:${lead.phone}`));
          }}
          onMessage={(lead, channel) => setMessage({ recipients: [recipientOf(lead)], channel })}
          onRowAction={onRowAction}
          empty={
            leads.isError
              ? {
                  title: 'The leads are not available right now.',
                  text: errorMessage(leads.error),
                }
              : undefined
          }
        />
        {leads.isError ? (
          <Button variant="secondary" className="w-fit" onClick={() => void leads.refetch()}>
            Try again
          </Button>
        ) : null}
      </>
    );
  };
  // A list that cannot be reached keeps the table's frame with the reason inside it; a refusal
  // (permission, firm setup, an open in-person signing) is still PageState's whole-page answer.
  const unreachable = leads.isError && !leads.data && errorCode(leads.error) === undefined;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
            Leads
          </h1>
          <p className="mt-1 font-semibold text-heading">{sourceTitle}</p>
          <p className="mt-1 text-sm text-muted">
            Manage your leads, track their progress, and turn opportunities into clients.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="add-lead">
          <Plus aria-hidden weight="fill" className="size-4" />
          Add New Lead
        </Button>
      </header>

      {/* Every widget keeps its frame when its data cannot load (design rule 2). */}
      <LeadsSummary summary={summary.data} filters={filters} onFilter={changeFilters} />
      {summary.isError ? (
        <p role="status" className="-mt-2 text-sm text-muted">
          The counts are not available right now.
        </p>
      ) : null}
      <LeadFilters
        filters={filters}
        options={options.data ?? NO_OPTIONS}
        onFilter={changeFilters}
        onReset={resetFilters}
      />
      {filters.archived ? (
        <div aria-label="Archived filter" className="-mt-2 flex flex-wrap items-center gap-3">
          <FilterChip label="Archived Leads" onRemove={() => changeFilters({ archived: false })} />
          {restore.data ? (
            <p role="status" className="text-sm text-success">
              {restore.data.changed === 1
                ? '1 lead restored, with its status and history.'
                : `${restore.data.changed} leads restored, with their status and history.`}
            </p>
          ) : null}
          {restore.error ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(restore.error)}
            </p>
          ) : null}
        </div>
      ) : null}
      {filters.overdue ? (
        // The Overdue Follow-Ups card's filter, visible on the page (Octavia's review, item 2);
        // it combines with any status, which it never changes.
        <div aria-label="Active filters" className="-mt-2 flex flex-wrap gap-2">
          <FilterChip
            label="Overdue Follow-Ups"
            onRemove={() => changeFilters({ overdue: false })}
          />
        </div>
      ) : null}

      {unreachable ? (
        renderLeads({ items: [], total: 0, page, pageSize })
      ) : (
        <PageState query={leads}>{renderLeads}</PageState>
      )}

      <LeadsActionLegend />
      {createOpen ? (
        <LeadCreateDialog open options={options.data} onClose={() => setCreateOpen(false)} />
      ) : null}
      {message ? (
        <LeadMessageDialog
          open
          recipients={message.recipients}
          channel={message.channel}
          onClose={() => setMessage(null)}
        />
      ) : null}
      {bulkDialog ? (
        <LeadBulkDialog
          state={bulkDialog}
          options={options.data}
          onClose={() => setBulkDialog(null)}
        />
      ) : null}
      {editingLead ? (
        <LeadEditDialog lead={editingLead} onClose={() => setEditingLead(null)} />
      ) : null}
      {appointmentLead ? (
        <LeadAppointmentDialog lead={appointmentLead} onClose={() => setAppointmentLead(null)} />
      ) : null}
    </div>
  );
}
