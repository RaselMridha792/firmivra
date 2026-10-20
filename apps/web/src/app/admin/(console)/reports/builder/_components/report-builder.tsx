'use client';

import type {
  AdminReportField,
  AdminReportResult,
  AdminSavedReport,
  PlatformReportType,
} from '@firmivra/types';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  Pagination,
  SearchField,
  Select,
  Textarea,
  Toggle,
} from '@firmivra/ui';
import {
  Buildings,
  ChartBar,
  CurrencyDollar,
  FileCsv,
  FilePdf,
  FileText,
  FileXls,
  FloppyDisk,
  Headset,
  type Icon,
  Play,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  count,
  dateTimeText,
  dayText,
  loadError,
  moneyWhole,
  QuietLine,
  ReportsHeader,
  ReportsTabs,
  RP,
  saveFile,
  useRange,
} from '../../_components/reports-common';

export type BuilderStep = 1 | 2 | 3 | 4;

const TYPES: { type: PlatformReportType; label: string; icon: Icon }[] = [
  { type: 'FIRMS', label: 'Firms', icon: Buildings },
  { type: 'USERS', label: 'Users', icon: UsersThree },
  { type: 'SUBSCRIPTIONS_REVENUE', label: 'Subscriptions & Revenue', icon: CurrencyDollar },
  { type: 'SUPPORT', label: 'Support', icon: Headset },
  { type: 'FEATURE_USAGE', label: 'Feature Usage', icon: ChartBar },
  { type: 'ACTIVITY_LOG', label: 'Activity Log', icon: FileText },
];
const STATUS_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  ACTIVE: 'success',
  PENDING_SETUP: 'warning',
  TRIALING: 'info',
  PAST_DUE: 'danger',
  SUSPENDED: 'danger',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
  OPEN: 'info',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
};
const words = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll('_', ' ');
const PAGE_SIZES = [10, 25, 50];

function cell(field: AdminReportField, v: string | number | null) {
  if (v === null || v === '') return <span className="text-muted">—</span>;
  switch (field.type) {
    case 'money':
      return moneyWhole(Number(v));
    case 'number':
      return count(Number(v));
    case 'date':
      return dayText(String(v));
    case 'datetime':
      return dateTimeText(String(v));
    case 'status':
      return <Badge tone={STATUS_TONES[String(v)] ?? 'neutral'}>{words(String(v))}</Badge>;
    default:
      return String(v);
  }
}

/**
 * The Custom Report Builder (docx §4 to §6; custom-report-builder-dashboard.jpg): the four steps
 * side by side, the preview under them, Export to CSV (built and audited by the API) and Save
 * Report. `/reports/builder/fields`, `/filters` and `/run` open the same page at that step.
 * `?saved=<id>` opens a saved report to run or change; `?type=` starts with a report type. The
 * period is the page's (the URL's), the same the other tabs use.
 */
export function ReportBuilder({ step = 1 }: { step?: BuilderStep }) {
  const params = useSearchParams();
  const router = useRouter();
  const { from, to, keep } = useRange();
  const savedId = params.get('saved');
  const startType = TYPES.find((t) => t.type === params.get('type'))?.type ?? 'FIRMS';
  const [type, setType] = useState<PlatformReportType>(startType);
  const [fields, setFields] = useState<string[] | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [fieldSearch, setFieldSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [ran, setRan] = useState<{
    fields: string[];
    filters: Record<string, string>;
    /** A saved report run as saved: its run stamps Last Run. */
    saved?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const saved = useApiQuery([...RP, 'saved'], () => api.adminReports.saved());
  const editing: AdminSavedReport | undefined = savedId
    ? saved.data?.items.find((s) => s.id === savedId)
    : undefined;
  const catalog = useApiQuery([...RP, 'fields', type], () => api.adminReports.fields(type));

  // A saved report fills the builder once it has loaded; a new type starts with its defaults.
  const loadedSavedRef = useRef<string | null>(null);
  useEffect(() => {
    if (editing && loadedSavedRef.current !== editing.id) {
      loadedSavedRef.current = editing.id;
      setType(editing.type);
      setFields(editing.fields);
      setFilters(editing.filters);
      setRan({ fields: editing.fields, filters: editing.filters, saved: editing.id });
    }
  }, [editing]);
  useEffect(() => {
    document.getElementById(`builder-step-${step}`)?.scrollIntoView({ block: 'nearest' });
  }, [step]);

  const chosen = fields ?? catalog.data?.defaultFields ?? [];
  const dateRange = { from, to };
  const definition = (f = chosen, fl = filters) => ({
    type,
    fields: f,
    filters: Object.fromEntries(Object.entries(fl).filter(([, v]) => v !== '')),
    dateRange,
    sort: [],
  });
  const preview = useApiQuery<AdminReportResult | null>(
    [...RP, 'run', type, ran, dateRange, page, pageSize],
    () =>
      !ran
        ? Promise.resolve(null)
        : ran.saved
          ? api.adminReports.runSaved(ran.saved, { page, pageSize })
          : api.adminReports.run({ ...definition(ran.fields, ran.filters), page, pageSize }),
  );
  const exporter = useApiMutation(() =>
    api.adminReports.export({
      ...definition(),
      format: 'CSV',
      title: editing?.name ?? `${TYPES.find((t) => t.type === type)!.label} report`,
    }),
  );
  const update = useApiMutation(
    () => api.adminReports.updateSaved(editing!.id, { ...definition(), dateRange }),
    { invalidate: [...RP, 'saved'] },
  );

  const shownFields = useMemo(
    () =>
      (catalog.data?.fields ?? []).filter((f) =>
        f.label.toLowerCase().includes(fieldSearch.trim().toLowerCase()),
      ),
    [catalog.data, fieldSearch],
  );
  const choose = (t: PlatformReportType) => {
    if (t === type) return;
    setType(t);
    setFields(null);
    setFilters({});
    setRan(null);
    setPage(1);
  };
  const toggle = (key: string, on: boolean) =>
    setFields((now) => {
      const base = now ?? chosen;
      return on ? [...base.filter((k) => k !== key), key] : base.filter((k) => k !== key);
    });
  const generate = () => {
    setNotice(null);
    setPage(1);
    setRan({ fields: chosen, filters });
  };
  const ring = (n: BuilderStep) => (n === step ? 'ring-2 ring-action/40' : '');

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ReportsHeader
        back
        title="Custom Report Builder"
        subtitle="Create, customize, and export reports with the data that matters most."
        actions={
          <Link
            href={keep('/reports/saved')}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-divider bg-surface px-4 text-sm font-medium text-text hover:bg-canvas"
          >
            <FileText aria-hidden weight="regular" className="size-4" />
            Saved Reports
          </Link>
        }
      />
      <ReportsTabs />
      {editing ? (
        <p className="text-sm text-text" data-testid="editing-saved">
          Saved report: <span className="font-semibold">{editing.name}</span>
          {editing.isYours ? '' : ` (shared by ${editing.owner.name}; save a copy to change it)`}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Card
          id="builder-step-1"
          className={`flex flex-col gap-4 p-5! ${ring(1)}`}
          data-testid="step-type"
        >
          <StepHead
            n={1}
            title="Select Report Type"
            text="Choose the main category for your report."
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Report type</legend>
            {TYPES.map((t) => {
              const on = t.type === type;
              return (
                <label
                  key={t.type}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${on ? 'border-action bg-info-soft' : 'border-divider bg-surface hover:bg-canvas'}`}
                >
                  <t.icon aria-hidden weight="fill" className="size-6 text-action" />
                  <span className="flex-1 text-base text-heading">{t.label}</span>
                  <input
                    type="radio"
                    name="report-type"
                    checked={on}
                    onChange={() => choose(t.type)}
                    className="size-5 accent-action"
                  />
                </label>
              );
            })}
          </fieldset>
        </Card>

        <Card
          id="builder-step-2"
          className={`flex flex-col gap-3 p-5! ${ring(2)}`}
          data-testid="step-fields"
        >
          <StepHead
            n={2}
            title="Choose Data Fields"
            text="Select the information you want to include."
          />
          <div>
            <SearchField
              label="Search fields"
              placeholder="Search fields…"
              minWidth="8rem"
              value={fieldSearch}
              onChange={(e) => setFieldSearch(e.target.value)}
            />
          </div>
          <div className="flex max-h-96 flex-col overflow-y-auto">
            {catalog.isError ? (
              <QuietLine>{loadError(catalog.error)}</QuietLine>
            ) : !catalog.data ? (
              <QuietLine>Loading fields…</QuietLine>
            ) : !shownFields.length ? (
              <QuietLine>No field matches.</QuietLine>
            ) : (
              shownFields.map((f) => (
                <Checkbox
                  key={f.key}
                  label={f.sensitive ? `${f.label} (personal)` : f.label}
                  checked={chosen.includes(f.key)}
                  onChange={(e) => toggle(f.key, e.target.checked)}
                />
              ))
            )}
          </div>
          <p className="text-xs text-muted">
            {chosen.length} selected. The selected fields are the report's and the export's columns.
          </p>
        </Card>

        <Card
          id="builder-step-3"
          className={`flex flex-col gap-4 p-5! ${ring(3)}`}
          data-testid="step-filters"
        >
          <StepHead n={3} title="Set Filters" text="Narrow your results (optional)." />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-text">Date Range</legend>
            {(['from', 'to'] as const).map((k) => (
              <Input
                key={k}
                type="date"
                label={k === 'from' ? 'From' : 'To'}
                value={k === 'from' ? from : to}
                onChange={(e) => {
                  const next = { from, to, [k]: e.target.value };
                  if (!next.from || !next.to || next.from > next.to) return;
                  const q = new URLSearchParams(params.toString());
                  q.set('from', next.from);
                  q.set('to', next.to);
                  router.replace(`?${q.toString()}`);
                }}
              />
            ))}
          </fieldset>
          {catalog.data?.filters
            .filter((f) => f.key !== 'search')
            .map((f) =>
              f.type === 'select' ? (
                <Select
                  key={f.key}
                  label={f.label}
                  value={filters[f.key] ?? ''}
                  onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })}
                  options={[
                    {
                      value: '',
                      label: `All ${f.label === 'Status' ? 'Statuses' : `${f.label}s`}`,
                    },
                    ...f.options.map((o) => ({
                      value: o.value,
                      label: f.key.endsWith('tatus') ? words(o.label) : o.label,
                    })),
                  ]}
                />
              ) : (
                <Input
                  key={f.key}
                  type="date"
                  label={f.label}
                  value={filters[f.key] ?? ''}
                  onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })}
                />
              ),
            )}
          {type === 'FIRMS' ? (
            <Select
              label="Location"
              value=""
              disabled
              title="Firms have no location on record yet"
              onChange={() => undefined}
              options={[{ value: '', label: 'All Locations' }]}
            />
          ) : null}
          {catalog.data?.filters.some((f) => f.key === 'search') ? (
            <div>
              <span aria-hidden className="mb-1 block text-sm font-medium text-text">
                {type === 'SUPPORT' ? 'Search Tickets' : 'Search Firm'}
              </span>
              <SearchField
                label={type === 'SUPPORT' ? 'Search Tickets' : 'Search Firm'}
                placeholder={
                  type === 'SUPPORT' ? 'Search by subject or firm…' : 'Search by firm name…'
                }
                minWidth="8rem"
                value={filters.search ?? ''}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              />
            </div>
          ) : null}
        </Card>

        <Card
          id="builder-step-4"
          className={`flex flex-col gap-3 p-5! ${ring(4)}`}
          data-testid="step-run"
        >
          <StepHead n={4} title="Run Report" text="Generate and export your report." />
          <Button disabled={!chosen.length} onClick={generate}>
            <span className="inline-flex items-center gap-2">
              <Play aria-hidden weight="fill" className="size-4" />
              Generate Report
            </span>
          </Button>
          <Button
            variant="secondary"
            disabled={!chosen.length || exporter.isPending}
            onClick={() =>
              exporter.mutate(undefined, {
                onSuccess: (file) => {
                  saveFile(file);
                  setNotice(
                    `Exported ${count(file.rowCount)} rows as CSV. The export was added to the audit log.`,
                  );
                },
              })
            }
          >
            <span className="inline-flex items-center gap-2 text-text">
              <FileCsv aria-hidden weight="regular" className="size-5" />
              {exporter.isPending ? 'Exporting…' : 'Export to CSV'}
            </span>
          </Button>
          <Button
            variant="secondary"
            disabled
            title="Excel export needs a spreadsheet writer the API does not have yet; use CSV"
          >
            <span className="inline-flex items-center gap-2">
              <FileXls aria-hidden weight="regular" className="size-5" />
              Export to Excel
            </span>
          </Button>
          <Button
            variant="secondary"
            disabled
            title="PDF export needs a PDF writer the API does not have yet; use CSV"
          >
            <span className="inline-flex items-center gap-2">
              <FilePdf aria-hidden weight="regular" className="size-5" />
              Export to PDF
            </span>
          </Button>
          <Button
            variant="secondary"
            disabled={!chosen.length || update.isPending}
            onClick={() =>
              editing?.isYours
                ? update.mutate(undefined, {
                    onSuccess: () => setNotice(`Saved changes to “${editing.name}”.`),
                  })
                : setSaving(true)
            }
          >
            <span className="inline-flex items-center gap-2 text-text">
              <FloppyDisk aria-hidden weight="regular" className="size-5" />
              {editing?.isYours ? 'Save Changes' : 'Save Report'}
            </span>
          </Button>
          <p className="text-xs text-muted">Excel and PDF are not available yet: export to CSV.</p>
          {exporter.isError || update.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(exporter.error ?? update.error)}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-sm text-success">
              {notice}
            </p>
          ) : null}
        </Card>
      </div>

      <Preview
        result={preview}
        ran={ran !== null}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />

      <SaveModal
        open={saving}
        onClose={() => setSaving(false)}
        body={definition()}
        onSaved={(s) => {
          setSaving(false);
          router.replace(keep(`/reports/builder?saved=${s.id}`));
          setNotice(`Saved “${s.name}”. Find it under Saved Reports.`);
        }}
      />
    </div>
  );
}

function StepHead({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-heading">
        {n}. {title}
      </h2>
      <p className="text-sm text-muted">{text}</p>
    </div>
  );
}

function Preview({
  result,
  ran,
  pageSize,
  onPage,
  onPageSize,
}: {
  result: {
    data?: AdminReportResult | null;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    isFetching: boolean;
  };
  ran: boolean;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
}) {
  const r = result.data;
  return (
    <Card className="flex min-w-0 flex-col gap-4 p-5!" data-testid="report-preview">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-heading">Report Preview</h2>
          <p className="text-sm text-muted">
            Showing a preview of your report based on the selected fields and filters.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Rows per page:</span>
          <div className="w-20">
            <Select
              label="Rows per page"
              hideLabel
              value={String(pageSize)}
              onChange={(e) => onPageSize(Number(e.target.value))}
              options={PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
            />
          </div>
        </div>
      </div>
      {!ran ? (
        <QuietLine>Choose a report type and fields, then Generate Report.</QuietLine>
      ) : result.isError ? (
        <QuietLine>{errorMessage(result.error)}</QuietLine>
      ) : !r ? (
        <QuietLine>Generating…</QuietLine>
      ) : !r.rows.length ? (
        <QuietLine>No records match these fields and filters.</QuietLine>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-table-head text-text">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2 font-medium">
                    #
                  </th>
                  {r.columns.map((c) => (
                    <th key={c.key} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {r.rows.map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2.5 text-text">{(r.page - 1) * r.pageSize + i + 1}</td>
                    {r.columns.map((c) => (
                      <td key={c.key} className="px-3 py-2.5 text-text">
                        {cell(c, row[c.key] ?? null)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={r.page}
            pageCount={Math.max(1, Math.ceil(r.total / r.pageSize))}
            onPage={onPage}
            summary={`Showing ${(r.page - 1) * r.pageSize + 1} to ${Math.min(r.total, r.page * r.pageSize)} of ${count(r.total)} results`}
          />
        </>
      )}
    </Card>
  );
}

function SaveModal({
  open,
  onClose,
  body,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  body: {
    type: PlatformReportType;
    fields: string[];
    filters: Record<string, string>;
    dateRange: { from: string; to: string };
    sort: never[];
  };
  onSaved: (s: AdminSavedReport) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [shared, setShared] = useState(false);
  const save = useApiMutation(
    () => api.adminReports.save({ ...body, name, description: description.trim() || null, shared }),
    { invalidate: [...RP, 'saved'] },
  );
  return (
    <Modal
      open={open}
      title="Save Report"
      subtitle="Saves the report type, fields, filters and date range, not the results: it runs against current data."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onSaved })}
          >
            {save.isPending ? 'Saving…' : 'Save Report'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Report Name"
          required
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          label="Description (optional)"
          rows={3}
          value={description}
          maxLength={1000}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Toggle label="Share with other Super Admins" checked={shared} onChange={setShared} />
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, {
              DUPLICATE_NAME: 'You already have a saved report with this name.',
            })}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
