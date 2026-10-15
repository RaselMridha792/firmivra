'use client';

import {
  ArrowRight,
  CheckCircle,
  Clock,
  DotsThreeVertical,
  Eye,
  FileText,
  Funnel,
  GearSix,
  Lightbulb,
  MagnifyingGlass,
  PaperPlaneTilt,
  Plus,
  PlusSquare,
  type Icon,
  XCircle,
} from '@phosphor-icons/react';
import {
  INTAKE_STATUS_LABELS,
  type AssignedFormRow,
  type AssignedFormTab,
  type AssignedFormsQuery,
  type FormCategory,
  type IntakeDashboardSummary,
  type IntakeFormListItem,
  type IntakeStatus,
} from '@firmivra/types';
import {
  ActionMenu,
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  DonutChart,
  IconButton,
  Input,
  KpiCard,
  Select,
  Tabs,
  Toast,
  type Column,
  Table,
} from '@firmivra/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useMemo, useState } from 'react';
import { PageState as ApiPageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';

const INTAKE_KEY = ['intake-forms'] as const;
const PAGE_SIZES = [8, 12, 24];

const tabs: { id: AssignedFormTab; label: string }[] = [
  { id: 'all', label: 'All Forms' },
  { id: 'sent', label: 'Sent' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'completed', label: 'Completed' },
  { id: 'expired', label: 'Expired' },
];

const metrics = [
  { key: 'total', label: 'Total Forms', icon: FileText, tone: 'red', positive: true },
  { key: 'sent', label: 'Sent', icon: PaperPlaneTilt, tone: 'blue', positive: true },
  { key: 'inProgress', label: 'In Progress', icon: Clock, tone: 'amber', positive: false },
  { key: 'completed', label: 'Completed', icon: CheckCircle, tone: 'green', positive: true },
  { key: 'expired', label: 'Expired', icon: XCircle, tone: 'red', positive: false },
] as const;

const statusTones: Record<
  IntakeStatus,
  'neutral' | 'warning' | 'info' | 'danger' | 'purple' | 'success'
> = {
  DRAFT: 'neutral',
  SENT: 'neutral',
  IN_PROGRESS: 'warning',
  SUBMITTED: 'info',
  NEEDS_CORRECTION: 'danger',
  UNDER_REVIEW: 'purple',
  COMPLETED: 'success',
  EXPIRED: 'danger',
  ARCHIVED: 'neutral',
};

function dateLabel(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function dateTimeLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date),
    time: new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date),
  };
}

function trend(value: number, previous: number | null, positive: boolean) {
  if (previous === null) return undefined;
  if (previous === 0) {
    return value === 0
      ? { text: 'No change', direction: 'flat' as const }
      : { text: 'New', direction: 'up' as const, good: positive };
  }
  const delta = value - previous;
  const percent = Math.round((Math.abs(delta) / previous) * 100);
  if (delta === 0) return { text: '0%', direction: 'flat' as const };
  const direction = delta > 0 ? 'up' : 'down';
  return { text: `${percent}%`, direction, good: delta > 0 === positive };
}

function MetricCards({ summary }: { summary: IntakeDashboardSummary }) {
  return (
    <section
      aria-label="Intake form summary"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      data-testid="intake-form-metrics"
    >
      {metrics.map(({ key, label, icon, tone, positive }) => {
        const item = summary[key];
        return (
          <KpiCard
            key={key}
            icon={icon}
            tone={tone}
            value={item.value}
            label={label}
            trend={trend(item.value, item.previous, positive)}
            note="vs last month"
          />
        );
      })}
    </section>
  );
}

function serviceTone(name: string): 'info' | 'success' | 'warning' | 'purple' {
  if (name.toLowerCase().includes('bookkeeping')) return 'purple';
  if (name.toLowerCase().includes('business')) return 'success';
  if (name.toLowerCase().includes('payroll')) return 'warning';
  return 'info';
}

function FormTemplates({
  templates,
  loading,
  onCreateFromTemplate,
  onCreateTemplate,
}: {
  templates: IntakeFormListItem[];
  loading: boolean;
  onCreateFromTemplate: (form: IntakeFormListItem) => void;
  onCreateTemplate: () => void;
}) {
  const router = useRouter();
  const quickEntries = [
    {
      category: 'PERSONAL_TAX',
      title: 'Personal Tax Intake Form',
      tone: 'bg-success-soft text-success',
    },
    {
      category: 'BUSINESS_TAX',
      title: 'Business Tax Intake Form',
      tone: 'bg-purple-soft text-purple',
    },
    {
      category: 'BOOKKEEPING',
      title: 'Bookkeeping Intake Form',
      tone: 'bg-danger-soft text-danger',
    },
    {
      category: 'CLIENT_ONBOARDING',
      title: 'New Client Intake Form',
      tone: 'bg-warning-soft text-gold',
    },
  ] as const;
  const customForm = templates.find((item) => item.custom);

  return (
    <Card className="!p-4" data-testid="intake-form-templates">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-heading">Form Templates</h2>
        <Link href="/intake-forms/templates" className="text-sm font-medium text-link underline">
          View All
        </Link>
      </div>
      {loading ? (
        <div className="space-y-2" aria-label="Loading templates" aria-busy="true">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="h-12 animate-pulse rounded-control bg-subtle" />
          ))}
        </div>
      ) : templates.length ? (
        <ul className="divide-y divide-divider">
          {quickEntries.map((entry) => {
            const form = templates.find((item) => item.category === entry.category);
            return form ? (
              <TemplateRow
                key={form.id}
                form={form}
                title={form.name || entry.title}
                tone={entry.tone}
                onUse={() => onCreateFromTemplate(form)}
                onViewAll={() => router.push('/intake-forms/templates')}
              />
            ) : null;
          })}
          {customForm ? (
            <TemplateRow
              form={customForm}
              title="Custom Form"
              tone="bg-info-soft text-info"
              onUse={() => onCreateFromTemplate(customForm)}
              onViewAll={() => router.push('/intake-forms/templates')}
              subtitle="Create your own form"
            />
          ) : (
            <li className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCreateTemplate}
                className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left hover:bg-subtle"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info">
                  <FileText aria-hidden weight="fill" className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text">Custom Form</span>
                  <span className="block text-xs text-muted">Create your own form</span>
                </span>
              </button>
              <ActionMenu
                label="Custom Form actions"
                trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
                className="[&>button]:size-8 [&>button]:min-h-0 [&>button]:w-8 [&>button]:justify-center [&>button]:p-0 [&>button>svg:last-child]:hidden"
                sections={[
                  {
                    items: [
                      { label: 'Create template', icon: Plus, onSelect: onCreateTemplate },
                      {
                        label: 'View templates',
                        icon: Eye,
                        onSelect: () => router.push('/intake-forms/templates'),
                      },
                    ],
                  },
                ]}
              />
            </li>
          )}
        </ul>
      ) : (
        <p className="rounded-lg bg-subtle p-4 text-sm text-muted">
          No form templates yet. Create a form template to get started.
        </p>
      )}
    </Card>
  );
}

function TemplateRow({
  form,
  title,
  tone,
  onUse,
  onViewAll,
  subtitle,
}: {
  form: IntakeFormListItem;
  title: string;
  tone: string;
  onUse: () => void;
  onViewAll: () => void;
  subtitle?: string;
}) {
  return (
    <li className="flex items-center gap-2 py-2">
      <button
        type="button"
        onClick={onUse}
        className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-link"
      >
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
          <FileText aria-hidden weight="fill" className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-text">{title}</span>
          <span className="block text-xs text-muted">
            {subtitle ?? `${form.questionCount} questions`}
          </span>
        </span>
      </button>
      <ActionMenu
        label={`${title} actions`}
        trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
        className="[&>button]:size-8 [&>button]:min-h-0 [&>button]:w-8 [&>button]:justify-center [&>button]:p-0 [&>button>svg:last-child]:hidden"
        sections={[
          {
            items: [
              { label: 'Use template', icon: Plus, onSelect: onUse },
              {
                label: 'View templates',
                icon: Eye,
                onSelect: onViewAll,
              },
            ],
          },
        ]}
      />
    </li>
  );
}

function FormStatusChart({ summary }: { summary: IntakeDashboardSummary }) {
  const segments = [
    {
      label: 'Completed',
      value: summary.byStatus.completed,
      tone: 'green' as const,
      dot: 'bg-chart-green',
    },
    {
      label: 'Submitted',
      value: summary.byStatus.submitted,
      tone: 'blue' as const,
      dot: 'bg-chart-blue',
    },
    {
      label: 'In Progress',
      value: summary.byStatus.inProgress,
      tone: 'yellow' as const,
      dot: 'bg-chart-yellow',
    },
    {
      label: 'Not Started',
      value: summary.byStatus.notStarted,
      tone: 'grey' as const,
      dot: 'bg-chart-grey',
    },
    {
      label: 'Expired',
      value: summary.byStatus.expired,
      tone: 'red' as const,
      dot: 'bg-chart-red',
    },
  ];
  const total = segments.reduce((count, segment) => count + segment.value, 0);

  return (
    <Card className="!p-4" data-testid="intake-form-status-chart">
      <h2 className="mb-3 text-base font-bold text-heading">Form Status Chart</h2>
      <div className="grid grid-cols-1 items-center gap-4 2xl:grid-cols-[7rem_minmax(0,1fr)] 2xl:gap-3">
        <div className="flex justify-center">
          <DonutChart
            segments={segments}
            centerValue={summary.total.value}
            centerLabel="Total Forms"
            legend={false}
            size="sm"
            label="Intake forms by status"
            emptyText="No forms yet"
          />
        </div>
        {total > 0 ? (
          <ul className="min-w-0 space-y-3">
            {segments.map((segment) => (
              <li
                key={segment.label}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5 text-[11px] text-text"
              >
                <span className="flex min-w-0 items-center gap-2 leading-tight">
                  <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${segment.dot}`} />
                  <span>{segment.label}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end leading-tight tabular-nums">
                  <span>{segment.value}</span>
                  <span className="text-muted">({Math.round((segment.value / total) * 100)}%)</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function FormRowActions({
  row,
  onResend,
  onRemind,
}: {
  row: AssignedFormRow;
  onResend: (row: AssignedFormRow) => void;
  onRemind: (row: AssignedFormRow) => void;
}) {
  const router = useRouter();
  const canSendAgain = ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'].includes(row.status);
  return (
    <>
      <IconButton
        icon={Eye}
        label="View form submission"
        onClick={() => router.push(`/intake-forms/${row.id}`)}
        tone="action"
        className="size-8"
      />
      <IconButton
        icon={PaperPlaneTilt}
        label="Open send form"
        onClick={() => router.push('/intake-forms/send')}
        tone="action"
        className="size-8"
      />
      <ActionMenu
        label={`Actions for ${row.recipient.name}`}
        trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4 text-heading" />}
        className="[&>button]:size-8 [&>button]:min-h-0 [&>button]:w-8 [&>button]:justify-center [&>button]:p-0 [&>button>svg:last-child]:hidden"
        sections={[
          {
            items: [
              {
                label: 'View form',
                icon: Eye,
                onSelect: () => router.push(`/intake-forms/${row.id}`),
              },
              {
                label: 'Open send workflow',
                icon: PaperPlaneTilt,
                onSelect: () => router.push('/intake-forms/send'),
              },
              ...(canSendAgain
                ? [
                    { label: 'Resend form', icon: PaperPlaneTilt, onSelect: () => onResend(row) },
                    { label: 'Send reminder', icon: Clock, onSelect: () => onRemind(row) },
                  ]
                : []),
            ],
          },
        ]}
      />
    </>
  );
}

export function IntakeFormsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<AssignedFormTab>('all');
  const [searchText, setSearchText] = useState('');
  const search = useDeferredValue(searchText.trim());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0] ?? 8);
  const [selected, setSelected] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    staffId: '',
    formId: '',
    serviceId: '',
    from: '',
    to: '',
  });
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const query = useMemo<AssignedFormsQuery>(
    () => ({
      tab,
      search: search || undefined,
      assignedUserId: filters.staffId || undefined,
      formId: filters.formId || undefined,
      serviceId: filters.serviceId || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      page,
      pageSize,
    }),
    [filters, page, pageSize, search, tab],
  );
  const summary = useApiQuery([...INTAKE_KEY, 'summary'], () => api.intakeForms.summary());
  const assignedForms = useApiQuery([...INTAKE_KEY, 'list', query], () =>
    api.intakeForms.list(query),
  );
  const templates = useApiQuery([...INTAKE_KEY, 'templates'], () =>
    api.intakeForms.forms({ templates: 'true', sort: 'used' }),
  );
  const createDraft = useApiMutation(
    (input: { isTemplate: boolean; templateId?: string; category: FormCategory }) =>
      api.intakeForms.createForm({
        name: input.isTemplate ? 'Untitled Form Template' : 'Untitled Intake Form',
        category: input.category,
        description: null,
        internalNotes: null,
        isTemplate: input.isTemplate,
        startFrom: input.templateId
          ? { kind: 'TEMPLATE', formId: input.templateId }
          : { kind: 'SCRATCH' },
      }),
    { invalidate: INTAKE_KEY },
  );
  const resend = useApiMutation((id: string) => api.intakeForms.resend(id), {
    invalidate: INTAKE_KEY,
  });
  const remind = useApiMutation((id: string) => api.intakeForms.remind(id), {
    invalidate: INTAKE_KEY,
  });

  function updateFilters(next: (current: typeof filters) => typeof filters) {
    setFilters(next);
    setPage(1);
    setSelected([]);
  }

  const visibleRows = assignedForms.data?.items ?? [];
  const staffById = new Map<string, string>();
  const servicesById = new Map<string, string>();
  visibleRows.forEach((row) => {
    if (row.assignedTo) staffById.set(row.assignedTo.userId, row.assignedTo.name);
    if (row.service) servicesById.set(row.service.id, row.service.name);
  });
  const availableStaff = Array.from(staffById, ([value, label]) => ({ value, label }));
  const availableServices = Array.from(servicesById, ([value, label]) => ({ value, label }));
  const availableForms = templates.data ?? [];
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const columns: Column<AssignedFormRow>[] = [
    {
      id: 'recipient',
      label: 'Client / Lead',
      className: 'min-w-36',
      cell: (row) => {
        const href =
          row.recipient.kind === 'LEAD'
            ? `/leads/${row.recipient.id}`
            : `/clients/${row.recipient.id}`;
        return (
          <div className="flex min-w-0 items-center gap-2">
            <Avatar name={row.recipient.name} size="md" />
            <div className="min-w-0">
              <Link
                href={href}
                className="block truncate text-sm font-semibold text-link hover:underline"
              >
                {row.recipient.name}
              </Link>
              <span className="block truncate text-xs text-muted">
                {row.recipient.email ?? row.recipient.phone ?? '—'}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      id: 'form',
      label: 'Form Name',
      className: 'min-w-32',
      cell: (row) => (
        <Link
          href={`/intake-forms/${row.id}`}
          className="text-sm font-semibold text-text hover:text-link"
        >
          {row.form.name}
        </Link>
      ),
    },
    {
      id: 'service',
      label: 'Service',
      className: 'min-w-28',
      cell: (row) =>
        row.service ? (
          <Badge tone={serviceTone(row.service.name)}>{row.service.name}</Badge>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      id: 'status',
      label: 'Status',
      className: 'min-w-28',
      cell: (row) => (
        <Badge tone={statusTones[row.status]}>{INTAKE_STATUS_LABELS[row.status]}</Badge>
      ),
    },
    {
      id: 'sentAt',
      label: 'Date Sent',
      className: 'min-w-24 whitespace-nowrap',
      cell: (row) => dateLabel(row.sentAt),
    },
    {
      id: 'lastActivityAt',
      label: 'Last Activity',
      className: 'min-w-28',
      cell: (row) => {
        const value = dateTimeLabel(row.lastActivityAt);
        return value ? (
          <span className="flex flex-col whitespace-nowrap">
            <span>{value.date}</span>
            <span className="text-muted">{value.time}</span>
          </span>
        ) : (
          <span className="text-muted">—</span>
        );
      },
    },
    {
      id: 'assignedTo',
      label: 'Assigned To',
      className: 'min-w-28',
      cell: (row) =>
        row.assignedTo ? (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <Avatar name={row.assignedTo.name} size="sm" />
            <span className="text-sm font-semibold">{row.assignedTo.name}</span>
          </span>
        ) : (
          <span className="text-muted">Unassigned</span>
        ),
    },
  ];

  function startCreate(isTemplate = false, templateId?: string, category: FormCategory = 'OTHER') {
    setNotice(null);
    createDraft.mutate(
      { isTemplate, templateId, category },
      {
        onSuccess: (form) => router.push(`/intake-forms/builder/${form.id}`),
        onError: (error) => setNotice({ message: errorMessage(error), tone: 'error' }),
      },
    );
  }

  function sendAgain(row: AssignedFormRow, action: 'resend' | 'remind') {
    const mutation = action === 'resend' ? resend : remind;
    mutation.mutate(row.id, {
      onSuccess: () =>
        setNotice({
          message: action === 'resend' ? 'Form resent.' : 'Reminder sent.',
          tone: 'success',
        }),
      onError: (error) => setNotice({ message: errorMessage(error), tone: 'error' }),
    });
  }

  const selectedTab = tabs.find((item) => item.id === tab)?.id ?? 'all';

  return (
    <div className="space-y-4" data-testid="intake-forms-page">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 data-testid="page-title" className="font-display text-4xl font-bold text-heading">
              Intake Forms
            </h1>
            <p className="text-base font-semibold text-heading">Collect. Organize. Serve Better.</p>
            <p className="text-sm text-muted">
              Create, send, and manage client intake forms. Track submissions and turn information
              into action.
            </p>
          </div>
          <Button className="px-5" disabled={createDraft.isPending} onClick={() => startCreate()}>
            <Plus aria-hidden weight="bold" className="size-5" />
            Create Intake Form
          </Button>
        </div>
      </header>

      {notice ? (
        <Toast message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}

      <ApiPageState query={summary} isEmpty={() => false}>
        {(data) => <MetricCards summary={data} />}
      </ApiPageState>

      <section aria-label="Intake form filters" className="space-y-3">
        <div className="flex flex-col gap-3 border-b border-divider pb-3 xl:flex-row xl:items-center">
          <div className="min-w-0 flex-1 overflow-x-auto">
            <Tabs
              items={tabs}
              value={selectedTab}
              onChange={(value) => {
                setTab(value as AssignedFormTab);
                setPage(1);
                setSelected([]);
              }}
              label="Filter intake forms by status"
              variant="segmented"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row xl:flex-none">
            <div className="relative min-w-0 sm:w-56">
              <MagnifyingGlass
                aria-hidden
                weight="bold"
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              />
              <Input
                label="Search forms"
                hideLabel
                type="search"
                placeholder="Search forms..."
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value);
                  setPage(1);
                  setSelected([]);
                }}
                className="min-h-10 py-2 pl-10 text-sm"
              />
            </div>
            <Button
              variant="secondary"
              className="min-h-10 whitespace-nowrap"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <Funnel aria-hidden weight="fill" className="size-4" />
              More Filters
              {activeFilterCount ? <Badge tone="info">{activeFilterCount}</Badge> : null}
            </Button>
          </div>
          <Button
            className="min-h-10 shrink-0 px-5"
            disabled={createDraft.isPending}
            onClick={() => startCreate()}
          >
            <Plus aria-hidden weight="bold" className="size-5" />
            Create New Form
          </Button>
        </div>

        {filtersOpen ? (
          <div className="grid grid-cols-1 gap-3 rounded-card border border-border bg-surface p-4 shadow-card sm:grid-cols-2 xl:grid-cols-5">
            <Select
              label="Assigned staff"
              hideLabel
              aria-label="Filter by assigned staff"
              value={filters.staffId}
              onChange={(event) =>
                updateFilters((current) => ({ ...current, staffId: event.target.value }))
              }
              options={[{ value: '', label: 'All Staff' }, ...availableStaff]}
              className="min-h-10 text-sm"
            />
            <Select
              label="Template"
              hideLabel
              aria-label="Filter by form template"
              value={filters.formId}
              onChange={(event) =>
                updateFilters((current) => ({ ...current, formId: event.target.value }))
              }
              options={[
                { value: '', label: 'All Templates' },
                ...availableForms.map((form) => ({ value: form.id, label: form.name })),
              ]}
              className="min-h-10 text-sm"
            />
            <Select
              label="Service"
              hideLabel
              aria-label="Filter by service"
              value={filters.serviceId}
              onChange={(event) =>
                updateFilters((current) => ({ ...current, serviceId: event.target.value }))
              }
              options={[{ value: '', label: 'All Services' }, ...availableServices]}
              className="min-h-10 text-sm"
            />
            <Input
              label="Sent from"
              hideLabel
              aria-label="Filter sent from date"
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) =>
                updateFilters((current) => ({ ...current, from: event.target.value }))
              }
              className="min-h-10 text-sm"
            />
            <div className="flex items-end gap-2">
              <Input
                label="Sent to"
                hideLabel
                aria-label="Filter sent to date"
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(event) =>
                  updateFilters((current) => ({ ...current, to: event.target.value }))
                }
                className="min-h-10 text-sm"
              />
              <Button
                variant="ghost"
                className="min-h-10 shrink-0 px-2"
                onClick={() =>
                  updateFilters(() => ({
                    staffId: '',
                    formId: '',
                    serviceId: '',
                    from: '',
                    to: '',
                  }))
                }
              >
                Reset
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-5">
        <section className="min-w-0 space-y-4 xl:col-span-4" aria-label="Intake form submissions">
          <div className="overflow-hidden rounded-card border border-border bg-surface pb-3 shadow-card [&_[aria-label=Pagination]]:px-3">
            <ApiPageState query={assignedForms} isEmpty={() => false}>
              {(data) => (
                <Table
                  rows={data.items}
                  columns={columns}
                  rowKey={(row) => row.id}
                  caption="Client intake forms"
                  dense
                  loading={assignedForms.isFetching && !assignedForms.isPending}
                  tableClassName="[&_thead_th]:text-sm [&_thead_th]:font-semibold [&_th:nth-child(4)]:px-2 [&_td:nth-child(4)]:px-2 [&_th:nth-child(5)]:px-2 [&_td:nth-child(5)]:px-2 [&_th:last-child]:px-1 [&_td:last-child]:px-1 [&_td:last-child>div]:gap-1"
                  emptyTitle={
                    search || activeFilterCount || tab !== 'all'
                      ? 'No matching forms'
                      : 'No intake forms yet'
                  }
                  emptyText={
                    search || activeFilterCount || tab !== 'all'
                      ? 'Try another search or adjust the filters.'
                      : 'Forms sent to clients and leads will appear here.'
                  }
                  emptyAction={
                    !search && !activeFilterCount && tab === 'all' ? (
                      <Button disabled={createDraft.isPending} onClick={() => startCreate()}>
                        <Plus aria-hidden weight="bold" className="size-4" />
                        Create New Form
                      </Button>
                    ) : undefined
                  }
                  server={{
                    page: data.page,
                    hasNext: data.page * data.pageSize < data.total,
                    hasPrevious: data.page > 1,
                    total: data.total,
                    onPage: setPage,
                    onNext: () => setPage((current) => current + 1),
                    onPrevious: () => setPage((current) => Math.max(1, current - 1)),
                    onSort: () => {},
                  }}
                  pageSize={data.pageSize}
                  pageSizes={[...PAGE_SIZES]}
                  onPageSize={(size) => {
                    setPageSize(size);
                    setPage(1);
                    setSelected([]);
                  }}
                  selection={{ selected, onChange: setSelected }}
                  rowActions={(row) => (
                    <FormRowActions
                      row={row}
                      onResend={(target) => sendAgain(target, 'resend')}
                      onRemind={(target) => sendAgain(target, 'remind')}
                    />
                  )}
                  noun="forms"
                />
              )}
            </ApiPageState>
          </div>

          <Card className="!p-4" data-testid="intake-form-quick-actions">
            <h2 className="mb-3 text-base font-bold text-heading">Quick Actions</h2>
            <div className="grid grid-cols-1 divide-y divide-divider sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x xl:divide-y-0">
              <QuickAction
                icon={PaperPlaneTilt}
                label="Send Form to Client"
                onClick={() => router.push('/intake-forms/send')}
              />
              <QuickAction
                icon={FileText}
                label="View Form Submissions"
                onClick={() => {
                  setTab('submitted');
                  setPage(1);
                  setSelected([]);
                }}
              />
              <QuickAction
                icon={PlusSquare}
                label="Create Form Template"
                disabled={createDraft.isPending}
                onClick={() => startCreate(true)}
              />
              <QuickAction
                icon={GearSix}
                label="Manage Form Settings"
                onClick={() => router.push('/intake-forms/settings')}
              />
            </div>
          </Card>
        </section>

        <aside className="min-w-0 space-y-4" aria-label="Form templates and status summary">
          <ApiPageState query={templates} isEmpty={() => false}>
            {(items) => (
              <FormTemplates
                templates={items}
                loading={templates.isFetching && !templates.isPending}
                onCreateFromTemplate={(form) => startCreate(false, form.id, form.category)}
                onCreateTemplate={() => startCreate(true)}
              />
            )}
          </ApiPageState>

          <ApiPageState query={summary} isEmpty={() => false}>
            {(data) => <FormStatusChart summary={data} />}
          </ApiPageState>

          <Callout
            icon={Lightbulb}
            title="Pro Tip:"
            titleStyle="tip"
            surface="info"
            action={
              <Link href="/automations" className="font-medium text-link underline">
                Go to Automations <ArrowRight aria-hidden weight="bold" className="inline size-4" />
              </Link>
            }
          >
            Use automated reminders to follow up with clients who haven&apos;t completed their
            forms.
          </Callout>
        </aside>
      </div>
    </div>
  );
}

function QuickAction({
  icon: Glyph,
  label,
  onClick,
  disabled,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-14 items-center gap-3 px-3 py-2 text-left text-sm font-medium text-text hover:bg-subtle disabled:cursor-not-allowed disabled:text-muted xl:justify-center"
    >
      <Glyph aria-hidden weight="fill" className="size-6 shrink-0 text-action" />
      <span>{label}</span>
    </button>
  );
}
