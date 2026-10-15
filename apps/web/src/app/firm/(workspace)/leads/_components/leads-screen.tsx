'use client';

import type {
  LeadPipelineQuery,
  LeadPriority,
  LeadRow,
  LeadSource,
  LeadStage,
} from '@firmivra/types';
import { BulkBar, Button, Checkbox, FilterBar, FilterGroup, KpiCard, Select } from '@firmivra/ui';
import {
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
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { LeadBulkDialog, type LeadBulkDialogState } from './lead-bulk-dialog';
import { LeadAppointmentDialog } from './lead-appointment-dialog';
import { LeadsActionLegend } from './leads-action-legend';
import { LeadCreateDialog } from './lead-create-dialog';
import { LeadEditDialog } from './lead-edit-dialog';
import { LeadMessageDialog } from './lead-message-dialog';
import { LeadsDateFilter } from './leads-date-filter';
import { LEAD_PIPELINE_KEY, PRIORITIES, SOURCES, STAGES, summaryTrend } from './lead-shared';
import { LeadsTable, type LeadRowAction } from './leads-table';

interface LeadFilters {
  source: LeadSource | '';
  serviceId: string;
  stage: LeadStage | '';
  assignedUserId: string;
  from: string;
  to: string;
  priority: LeadPriority | '';
  campaignId: string;
  tag: string;
  overdue: boolean;
}

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
};

function LeadsSummary({
  summary,
  filters,
  onFilter,
}: {
  summary: Awaited<ReturnType<typeof api.leadPipeline.summary>>;
  filters: LeadFilters;
  onFilter: (patch: Partial<LeadFilters>) => void;
}) {
  const cards = [
    {
      key: 'total',
      label: 'Total Leads',
      metric: summary.total,
      icon: Users,
      tone: 'blue' as const,
      active: !filters.stage && !filters.overdue,
      select: () => onFilter({ stage: '', overdue: false }),
      decreasesAreGood: false,
    },
    {
      key: 'new',
      label: 'New Leads',
      metric: summary.new,
      icon: UserPlus,
      tone: 'amber' as const,
      active: filters.stage === 'NEW',
      select: () => onFilter({ stage: 'NEW', overdue: false }),
      decreasesAreGood: false,
    },
    {
      key: 'follow-up',
      label: 'In Follow-Up',
      metric: summary.inFollowUp,
      icon: Clock,
      tone: 'purple' as const,
      active: filters.stage === 'IN_FOLLOW_UP',
      select: () => onFilter({ stage: 'IN_FOLLOW_UP', overdue: false }),
      decreasesAreGood: false,
    },
    {
      key: 'converted',
      label: 'Converted to Clients',
      metric: summary.converted,
      icon: Handshake,
      tone: 'green' as const,
      active: filters.stage === 'CONVERTED',
      select: () => onFilter({ stage: 'CONVERTED', overdue: false }),
      decreasesAreGood: false,
    },
    {
      key: 'not-qualified',
      label: 'Not Qualified',
      metric: summary.notQualified,
      icon: XCircle,
      tone: 'red' as const,
      active: filters.stage === 'NOT_QUALIFIED',
      select: () => onFilter({ stage: 'NOT_QUALIFIED', overdue: false }),
      decreasesAreGood: true,
    },
    {
      key: 'overdue',
      label: 'Overdue Follow-Ups',
      metric: summary.overdueFollowUps,
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
            value={card.metric.value.toLocaleString('en-US')}
            label={card.label}
            trend={summaryTrend(card.metric, card.decreasesAreGood)}
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
          onChange={(event) => onFilter({ overdue: event.target.checked, stage: '' })}
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
          onChange={(event) =>
            onFilter({ stage: event.target.value as LeadStage | '', overdue: false })
          }
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
  const [message, setMessage] = useState<{ ids: string[]; channel: 'EMAIL' | 'SMS' } | null>(null);
  const [bulkDialog, setBulkDialog] = useState<LeadBulkDialogState>(null);
  const [editingLead, setEditingLead] = useState<LeadRow | null>(null);
  const [appointmentLead, setAppointmentLead] = useState<LeadRow | null>(null);
  const summary = useApiQuery([...LEAD_PIPELINE_KEY, 'summary'], () => api.leadPipeline.summary());
  const options = useApiQuery([...LEAD_PIPELINE_KEY, 'options'], () => api.leadPipeline.options());
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
    }),
    [filters, page, pageSize],
  );
  const leads = useApiQuery([...LEAD_PIPELINE_KEY, 'list', query], () =>
    api.leadPipeline.list(query),
  );
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

      <PageState query={summary}>
        {(data) => <LeadsSummary summary={data} filters={filters} onFilter={changeFilters} />}
      </PageState>

      <PageState query={options}>
        {(data) => (
          <LeadFilters
            filters={filters}
            options={data}
            onFilter={changeFilters}
            onReset={resetFilters}
          />
        )}
      </PageState>

      <PageState query={leads}>
        {(data) => {
          const rowIds = data.items.map((lead) => lead.id);
          const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.includes(id));
          const bulkActions = [
            {
              label: 'Send Email',
              icon: EnvelopeSimple,
              onClick: () => setMessage({ ids: selected, channel: 'EMAIL' as const }),
            },
            {
              label: 'Send SMS',
              icon: ChatCircleDots,
              onClick: () => setMessage({ ids: selected, channel: 'SMS' as const }),
            },
            { label: 'Assign Staff', icon: UserPlus, onClick: () => openBulk('ASSIGN') },
            { label: 'Change Status', icon: ArrowsClockwise, onClick: () => openBulk('STAGE') },
            { label: 'Add to Campaign', icon: EnvelopeSimple, onClick: () => openBulk('CAMPAIGN') },
            { label: 'Add Tags', icon: Tag, onClick: () => openBulk('TAGS') },
            { label: 'Delete', icon: Trash, danger: true, onClick: () => openBulk('ARCHIVE') },
          ];
          const updateSelection = (checked: boolean) =>
            setSelected((current) =>
              checked
                ? [...new Set([...current, ...rowIds])]
                : current.filter((id) => !rowIds.includes(id)),
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
                <BulkBar count={selected.length} noun="leads" actions={bulkActions} />
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
                  {bulkActions.map(({ label, icon: Icon, onClick, danger }) => (
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
                onSelectionChange={setSelected}
                onCall={(lead) => {
                  if (!lead.phone) return;
                  void logCall
                    .mutateAsync({ id: lead.id })
                    .catch(() => undefined)
                    .then(() => window.location.assign(`tel:${lead.phone}`));
                }}
                onMessage={(lead, channel) => setMessage({ ids: [lead.id], channel })}
                onRowAction={onRowAction}
              />
            </>
          );
        }}
      </PageState>

      <LeadsActionLegend />
      {createOpen ? (
        <LeadCreateDialog open options={options.data} onClose={() => setCreateOpen(false)} />
      ) : null}
      {message ? (
        <LeadMessageDialog
          open
          ids={message.ids}
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
