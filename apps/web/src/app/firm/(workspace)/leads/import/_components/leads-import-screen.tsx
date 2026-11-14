'use client';

import {
  guessImportField,
  LEAD_IMPORT_FIELD_LABELS,
  LEAD_IMPORT_FIELDS,
  LEAD_IMPORT_MAX_ROWS,
  type LeadImportField,
  type LeadImportResult,
  type LeadImportRowResult,
  parseCsv,
} from '@firmivra/types';
import {
  Button,
  Callout,
  Checkbox,
  ChecklistCard,
  FileDropzone,
  Select,
  Stepper,
  Table,
} from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  DownloadSimple,
  FileCsv,
  Info,
  ListChecks,
  UploadSimple,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { LEAD_PIPELINE_KEY } from '../../_components/lead-shared';

const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Map Columns' },
  { id: 'preview', label: 'Check & Preview' },
  { id: 'results', label: 'Results' },
] as const;
type Step = (typeof STEPS)[number]['id'];

const MAX_BYTES = 1024 * 1024;
const REQUIRED: LeadImportField[] = ['firstName', 'lastName', 'email'];

const TEMPLATE = `data:text/csv;charset=utf-8,${encodeURIComponent(
  `${LEAD_IMPORT_FIELDS.map((f) => LEAD_IMPORT_FIELD_LABELS[f]).join(',')}\r\n`,
)}`;

const BEFORE = [
  'One lead per row, with a header row. CSV only; save an Excel sheet as CSV first.',
  'Required: First Name, Last Name and Email.',
  'Lead Source: one of the sources on Add New Lead, such as Website Form or Referral. Empty is Other.',
  'Priority: Hot, Warm or Cold. Empty is Warm.',
  'Service: the name of one of your services. Empty uses the default service you choose.',
  `Up to ${LEAD_IMPORT_MAX_ROWS} rows and 1 MB per file.`,
  'A row whose email or phone matches one of your leads, or an earlier row, is a possible duplicate: skipped, or added for Review Duplicates if you choose. An import never changes a lead you already have.',
  'Nothing is imported until you check the rows and press Import.',
];

const IMPORT_ERRORS: Record<string, string> = {
  FORBIDDEN: 'You do not have permission to add leads.',
  NOT_FOUND: 'The default service is no longer available. Choose another.',
};

function Card({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <h2 className="text-xl font-bold text-heading">{title}</h2>
      {children}
    </section>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-divider p-3">
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

/**
 * Import Leads (`/leads/import`, Leads R2 16), from the Leads list: a CSV read in the browser, its
 * columns mapped to lead fields (guessed from the headers), then every row checked on the server
 * (what would be created, what may duplicate a lead, what is invalid and why) before Import
 * creates the new leads on purpose. Skipped duplicates can be reviewed in Review Duplicates.
 */
export function LeadsImportScreen() {
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [lines, setLines] = useState<string[][]>([]);
  const [fileError, setFileError] = useState('');
  /** Column index → the field it fills. */
  const [map, setMap] = useState<Record<number, LeadImportField>>({});
  const [serviceId, setServiceId] = useState('');
  const [mapError, setMapError] = useState('');
  const [preview, setPreview] = useState<LeadImportResult | null>(null);
  const [result, setResult] = useState<LeadImportResult | null>(null);
  /** Add the possible duplicates too, for Review Duplicates (else they are skipped). */
  const [review, setReview] = useState(false);
  const options = useApiQuery([...LEAD_PIPELINE_KEY, 'options'], () => api.leadPipeline.options());
  const services = options.data?.services ?? [];
  const rowsOf = () =>
    lines.map((line) => {
      const row: Partial<Record<LeadImportField, string>> = {};
      for (const [index, field] of Object.entries(map)) row[field] = line[Number(index)] ?? '';
      return row;
    });

  const send = useApiMutation(
    (dryRun: boolean) =>
      api.leadTransfer.import({
        rows: rowsOf(),
        defaultServiceId: serviceId,
        dryRun,
        duplicates: review ? 'REVIEW' : 'SKIP',
      }),
    { invalidate: LEAD_PIPELINE_KEY },
  );

  const read = async (file: File) => {
    setFileError('');
    const [head, ...body] = parseCsv(await file.text());
    if (!head || body.length === 0) {
      setFileError('This file has no rows under its header row.');
      return;
    }
    if (body.length > LEAD_IMPORT_MAX_ROWS) {
      setFileError(
        `This file has ${body.length} rows. Split it into files of ${LEAD_IMPORT_MAX_ROWS}.`,
      );
      return;
    }
    const guessed: Record<number, LeadImportField> = {};
    head.forEach((h, i) => {
      const field = guessImportField(h);
      if (field && !Object.values(guessed).includes(field)) guessed[i] = field;
    });
    setFileName(file.name);
    setHeaders(head);
    setLines(body);
    setMap(guessed);
    setPreview(null);
    setStep('map');
  };

  const columns = headers.map((name, index) => ({ id: `${index}:${name}`, name, index }));
  const mapped = new Set(Object.values(map));
  const missing = REQUIRED.filter((f) => !mapped.has(f));
  const check = () => {
    if (missing.length) {
      setMapError(`Map a column to ${missing.map((f) => LEAD_IMPORT_FIELD_LABELS[f]).join(', ')}.`);
      return;
    }
    if (!serviceId) {
      setMapError('Choose the default service.');
      return;
    }
    setMapError('');
    send.mutate(true, {
      onSuccess: (r) => {
        setPreview(r);
        setStep('preview');
      },
    });
  };
  const startOver = () => {
    setHeaders([]);
    setLines([]);
    setFileName('');
    setMap({});
    setPreview(null);
    setResult(null);
    setReview(false);
    send.reset();
    setStep('upload');
  };
  const cell = (row: number, field: LeadImportField) => {
    const index = Object.entries(map).find(([, f]) => f === field)?.[0];
    return index === undefined ? '' : (lines[row - 1]?.[Number(index)] ?? '');
  };
  const toCreate = preview ? preview.rows.filter((x) => x.status === 'CREATE').length : 0;
  const toAdd = toCreate + (review && preview ? preview.duplicates : 0);
  const problems = (r: LeadImportResult) => r.rows.filter((x) => x.status !== 'CREATE');
  const outcome = (x: LeadImportRowResult, done: boolean) => {
    if (x.status !== 'DUPLICATE') return x.issues.join('; ');
    const of = x.duplicateOf ? ` of ${x.duplicateOf.name}` : ' of an earlier row';
    const added = done ? x.leadId !== null : review;
    return `Possible duplicate${of}: ${added ? 'added for Review Duplicates' : 'skipped'}`;
  };
  const table = (r: LeadImportResult, done: boolean) => (
    <Table
      rows={problems(r)}
      rowKey={(x) => String(x.row)}
      caption="Possible duplicates and rows with problems"
      dense
      pageSize={10}
      emptyTitle="Every row can be imported"
      emptyText="No duplicates and no problems."
      columns={[
        { id: 'row', label: 'Row', cell: (x) => x.row },
        {
          id: 'lead',
          label: 'Lead',
          cell: (x) =>
            `${cell(x.row, 'firstName')} ${cell(x.row, 'lastName')}`.trim() ||
            cell(x.row, 'email') ||
            '—',
        },
        { id: 'email', label: 'Email', cell: (x) => cell(x.row, 'email') || '—' },
        { id: 'why', label: 'Why', cell: (x) => outcome(x, done) },
      ]}
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="leads-import">
      <header className="flex flex-col gap-4">
        <Link
          href="/leads"
          className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back to Leads
        </Link>
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            <UploadSimple aria-hidden weight="fill" className="size-9" />
          </span>
          <div className="min-w-0">
            <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
              Import Leads
            </h1>
            <p className="text-link">
              Add many leads from a CSV file. Every row is checked before anything is imported.
            </p>
          </div>
        </div>
        <div className="py-1">
          <Stepper
            variant="wizard"
            label="Import steps"
            steps={STEPS.map((s) => ({ id: s.id, label: s.label }))}
            current={step}
          />
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 min-[1440px]:col-span-2">
          {step === 'upload' ? (
            <Card title="Upload Your File" testId="import-upload">
              <a
                href={TEMPLATE}
                download="leads-import-template.csv"
                className="inline-flex min-h-11 w-fit items-center gap-2 rounded-control border border-action px-5 text-sm font-semibold text-action hover:bg-folder-surface"
              >
                <DownloadSimple aria-hidden weight="bold" className="size-4" />
                Download CSV Template
              </a>
              <FileDropzone
                label="Leads file"
                icon={FileCsv}
                accept={['.csv']}
                multiple={false}
                maxBytes={MAX_BYTES}
                title="Drag & drop your CSV file here or click to upload"
                hints={[
                  'Accepted format: CSV',
                  `Max size: 1MB, up to ${LEAD_IMPORT_MAX_ROWS} rows`,
                ]}
                onFiles={(files) => {
                  const file = files[0];
                  if (file) void read(file);
                }}
                onReject={(rejections) =>
                  setFileError(
                    rejections[0]?.reason === 'size'
                      ? 'This file is larger than 1 MB. Split it into smaller files.'
                      : 'Upload a CSV file.',
                  )
                }
              />
              {fileError ? (
                <p role="alert" className="text-sm text-danger">
                  {fileError}
                </p>
              ) : null}
            </Card>
          ) : null}

          {step === 'map' ? (
            <Card title="Map Columns" testId="import-map">
              <p className="text-sm text-text">
                <span className="font-semibold text-heading">{fileName}</span>: {lines.length} row
                {lines.length === 1 ? '' : 's'}. Choose the field each column fills; columns set to
                “Don’t import” are left out.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {columns.map(({ id, name: h, index: i }) => (
                  <Select
                    key={id}
                    label={h || `Column ${i + 1}`}
                    options={[
                      { value: '', label: 'Don’t import' },
                      ...LEAD_IMPORT_FIELDS.map((f) => ({
                        value: f,
                        label: REQUIRED.includes(f)
                          ? `${LEAD_IMPORT_FIELD_LABELS[f]} *`
                          : LEAD_IMPORT_FIELD_LABELS[f],
                      })),
                    ]}
                    value={map[i] ?? ''}
                    onChange={(event) => {
                      const field = event.target.value as LeadImportField | '';
                      const next = { ...map };
                      // One column per field: picking it here frees the other column.
                      for (const [k, v] of Object.entries(next))
                        if (v === field) delete next[Number(k)];
                      if (field) next[i] = field;
                      else delete next[i];
                      setMap(next);
                    }}
                  />
                ))}
              </div>
              <Select
                label="Default service *"
                hint="For rows with no service column or an empty one."
                options={[
                  { value: '', label: 'Choose a service' },
                  ...services.map((s) => ({ value: s.id, label: s.name })),
                ]}
                value={serviceId}
                onChange={(event) => setServiceId(event.target.value)}
                data-testid="import-default-service"
              />
              {mapError || send.error ? (
                <p role="alert" className="text-sm text-danger">
                  {mapError || errorMessage(send.error, IMPORT_ERRORS)}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={startOver}>
                  <ArrowLeft aria-hidden weight="bold" className="size-4" />
                  Choose Another File
                </Button>
                <Button
                  className="ml-auto"
                  disabled={send.isPending}
                  onClick={check}
                  data-testid="import-check"
                >
                  Check Rows
                  <ArrowRight aria-hidden weight="bold" className="size-4" />
                </Button>
              </div>
            </Card>
          ) : null}

          {step === 'preview' && preview ? (
            <Card title="Check & Preview" testId="import-preview">
              <div className="grid gap-3 sm:grid-cols-3">
                <Count label="New leads to create" value={toCreate} tone="text-success" />
                <Count label="Possible duplicates" value={preview.duplicates} tone="text-link" />
                <Count label="Rows with problems" value={preview.invalid} tone="text-danger" />
              </div>
              {table(preview, false)}
              {preview.duplicates ? (
                <div className="flex flex-col gap-1">
                  <Checkbox
                    label="Add the possible duplicates too, to compare and merge in Review Duplicates"
                    checked={review}
                    onChange={(event) => setReview(event.target.checked)}
                    data-testid="import-review-duplicates"
                  />
                  <p className="text-xs text-muted">
                    Otherwise they are skipped. An import never changes a lead you already have.
                  </p>
                </div>
              ) : null}
              {toCreate + preview.duplicates === 0 ? (
                <Callout icon={WarningCircle} tone="amber" surface="warning" size="compact">
                  No row can be imported. Fix the file and upload it again.
                </Callout>
              ) : preview.invalid ? (
                <Callout icon={WarningCircle} tone="amber" surface="warning" size="compact">
                  Rows with problems are skipped. Fix them in the file and upload it again, or
                  import the other rows now.
                </Callout>
              ) : null}
              {send.error ? (
                <p role="alert" className="text-sm text-danger">
                  {errorMessage(send.error, IMPORT_ERRORS)}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={() => setStep('map')}>
                  <ArrowLeft aria-hidden weight="bold" className="size-4" />
                  Back to Mapping
                </Button>
                <Button
                  className="ml-auto"
                  data-testid="import-run"
                  disabled={send.isPending || toAdd === 0}
                  onClick={() =>
                    send.mutate(false, {
                      onSuccess: (r) => {
                        setResult(r);
                        setStep('results');
                      },
                    })
                  }
                >
                  Import {toAdd} {toAdd === 1 ? 'Lead' : 'Leads'}
                </Button>
              </div>
            </Card>
          ) : null}

          {step === 'results' && result ? (
            <Card title="Results" testId="import-results">
              <p className="flex items-center gap-2 text-lg font-bold text-heading">
                <CheckCircle aria-hidden weight="fill" className="size-6 text-success" />
                Import finished
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Count label="Created" value={result.created} tone="text-success" />
                <Count
                  label="Duplicates skipped"
                  value={result.rows.filter((x) => x.status === 'DUPLICATE' && !x.leadId).length}
                  tone="text-link"
                />
                <Count label="Not imported" value={result.invalid} tone="text-danger" />
              </div>
              {table(result, true)}
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={startOver}>
                  Import Another File
                </Button>
                {result.rows.some((x) => x.status === 'DUPLICATE' && x.leadId) ? (
                  <Link
                    href="/leads/duplicates"
                    className="inline-flex min-h-11 items-center rounded-control border border-border bg-surface px-5 text-sm font-semibold text-heading hover:bg-canvas"
                  >
                    Review Duplicates
                  </Link>
                ) : null}
                <Link
                  href="/leads"
                  className="ml-auto inline-flex min-h-11 items-center rounded-control bg-action px-6 text-sm font-semibold text-on-action hover:bg-action-hover"
                >
                  Go to Leads
                </Link>
              </div>
            </Card>
          ) : null}
        </div>

        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          <ChecklistCard
            title="Before You Import"
            icon={ListChecks}
            iconTone="blue"
            items={BEFORE.map((label) => ({ id: label, label, done: true }))}
          />
          <Callout icon={Info} tone="navy" surface="plain" size="compact">
            The file stays in your browser: only its mapped rows are sent to be checked. Each new
            lead is added as Add New Lead adds one, so your lead assignment rules apply. The import
            is recorded in the audit log with its counts.
          </Callout>
        </aside>
      </div>
    </div>
  );
}
