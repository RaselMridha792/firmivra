'use client';

import type { StaffImportField, StaffImportPreview, StaffImportResult } from '@firmivra/types';
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
import { useApiMutation } from '../../../../../../lib/query';
import { NeedHelpCard } from '../../_components/need-help-card';
import { type CsvFile, FIELDS, guessMap, parseCsv } from './csv';

const STEPS = [
  { id: 'upload', label: 'Template & Upload' },
  { id: 'map', label: 'Map Columns' },
  { id: 'preview', label: 'Validate & Preview' },
  { id: 'results', label: 'Results' },
] as const;
type Step = (typeof STEPS)[number]['id'];

const MAX_ROWS = 500;
const MAX_BYTES = 1024 * 1024;

const IMPORT_ERRORS: Record<string, string> = {
  IMPORT_PREVIEW_EXPIRED: 'This preview expired. Upload the file again.',
  FORBIDDEN: 'Only an Owner or an Admin can import staff.',
  VALIDATION_FAILED: 'The file could not be checked. Make sure it has at most 500 rows.',
};

const BEFORE = [
  'Use the template, one person per row.',
  'Work Email must be unique; an existing email updates that person.',
  'Role and Department must match the ones in Staff Management.',
  'Up to 500 rows and 1 MB per file.',
  'Nothing is imported until you check the preview.',
];

function Card({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
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
 * Staff Management > Bulk Upload Staff (`/team/import`, guide §15): Template, Upload (CSV, read in
 * the browser), Map columns, Validate and Preview (`api.staff.previewImport`: create / update
 * counts and row errors), the Invitation option, Import (`api.staff.import`) and Results with the
 * error file. Nothing is saved before the preview is accepted.
 */
export function ImportScreen() {
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState<CsvFile | null>(null);
  const [fileError, setFileError] = useState('');
  const [map, setMap] = useState<Record<string, StaffImportField>>({});
  const [mapError, setMapError] = useState('');
  const [invite, setInvite] = useState(true);
  const [preview, setPreview] = useState<StaffImportPreview | null>(null);
  const [result, setResult] = useState<StaffImportResult | null>(null);
  const check = useApiMutation((body: Parameters<typeof api.staff.previewImport>[0]) =>
    api.staff.previewImport(body),
  );
  const run = useApiMutation(
    (body: Parameters<typeof api.staff.import>[0]) => api.staff.import(body),
    {
      invalidate: ['staff'],
    },
  );

  const read = async (file: File) => {
    setFileError('');
    const parsed = parseCsv(await file.text());
    if (!parsed.headers.length || !parsed.rows.length) {
      setFileError('This file has no rows under its header. Use the template.');
      return;
    }
    if (parsed.rows.length > MAX_ROWS) {
      setFileError(`This file has ${parsed.rows.length} rows. Split it into files of ${MAX_ROWS}.`);
      return;
    }
    setFileName(file.name);
    setCsv(parsed);
    setMap(guessMap(parsed.headers));
    setPreview(null);
    setStep('map');
  };

  const mapped = new Set(Object.values(map));
  const missing = FIELDS.filter((f) => f.required && !mapped.has(f.field));
  const validate = () => {
    if (!csv) return;
    if (missing.length) {
      setMapError(`Map a column to ${missing.map((f) => f.label).join(', ')}.`);
      return;
    }
    setMapError('');
    check.mutate(
      { fileName, columnMap: map, rows: csv.rows },
      {
        onSuccess: (p) => {
          setPreview(p);
          setStep('preview');
        },
      },
    );
  };
  const startOver = () => {
    setCsv(null);
    setFileName('');
    setPreview(null);
    setResult(null);
    setMap({});
    setStep('upload');
  };
  const fieldLabel = (f: StaffImportField | null) =>
    FIELDS.find((x) => x.field === f)?.label ?? 'Row';

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-4">
        <Link
          href="/team"
          className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back to Staff Management
        </Link>
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            <UploadSimple aria-hidden weight="fill" className="size-9" />
          </span>
          <div className="min-w-0">
            <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
              Bulk Upload Staff
            </h1>
            <p className="text-link">
              Add or update many staff members from a CSV file. Check the preview before anything is
              imported.
            </p>
          </div>
        </div>
        <div className="py-1">
          <Stepper
            variant="wizard"
            label="Bulk upload steps"
            steps={STEPS.map((s) => ({ id: s.id, label: s.label }))}
            current={step}
          />
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 min-[1440px]:col-span-2">
          {step === 'upload' ? (
            <>
              <Card title="1. Download the Template" testId="import-template">
                <p className="text-sm text-text">
                  The template has the columns Bulk Upload reads. Fill one person per row; Work
                  Email, First Name, Last Name, Role and Department are required.
                </p>
                <a
                  href={api.staff.importTemplateUrl()}
                  download="staff-import-template.csv"
                  className="inline-flex min-h-11 w-fit items-center gap-2 rounded-control border border-action px-5 text-sm font-semibold text-action hover:bg-folder-surface"
                >
                  <DownloadSimple aria-hidden weight="bold" className="size-4" />
                  Download CSV Template
                </a>
              </Card>
              <Card title="2. Upload Your File" testId="import-upload">
                <FileDropzone
                  label="Staff file"
                  icon={FileCsv}
                  accept={['.csv']}
                  maxBytes={MAX_BYTES}
                  title="Drag & drop your CSV here or click to upload"
                  hints={['Accepted format: CSV', 'Max size: 1MB, up to 500 rows']}
                  onFiles={(files) => {
                    const file = files[0];
                    if (file) void read(file);
                  }}
                  onReject={(rejections) =>
                    setFileError(
                      rejections[0]?.reason === 'size'
                        ? 'This file is larger than 1 MB. Split it into smaller files.'
                        : 'Upload a CSV file. Save a spreadsheet as CSV first.',
                    )
                  }
                />
                {fileError ? (
                  <p role="alert" className="text-sm text-danger">
                    {fileError}
                  </p>
                ) : null}
              </Card>
            </>
          ) : null}

          {step === 'map' && csv ? (
            <Card title="Map Columns" testId="import-map">
              <p className="text-sm text-text">
                <span className="font-semibold text-heading">{fileName}</span>: {csv.rows.length}{' '}
                row{csv.rows.length === 1 ? '' : 's'}. Choose the field each column fills; columns
                set to “Don’t import” are left out.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {csv.headers.map((h) => (
                  <Select
                    key={h}
                    label={h || '(no name)'}
                    options={[
                      { value: '', label: 'Don’t import' },
                      ...FIELDS.map((f) => ({
                        value: f.field,
                        label: f.required ? `${f.label} *` : f.label,
                      })),
                    ]}
                    value={map[h] ?? ''}
                    onChange={(event) => {
                      const next = { ...map };
                      const field = event.target.value as StaffImportField | '';
                      // One column per field: picking it here frees the other column.
                      for (const [k, v] of Object.entries(next)) if (v === field) delete next[k];
                      if (field) next[h] = field;
                      else delete next[h];
                      setMap(next);
                    }}
                  />
                ))}
              </div>
              {mapError || check.error ? (
                <p role="alert" className="text-sm text-danger">
                  {mapError || errorMessage(check.error, IMPORT_ERRORS)}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={startOver}>
                  <ArrowLeft aria-hidden weight="bold" className="size-4" />
                  Choose Another File
                </Button>
                <Button className="ml-auto" disabled={check.isPending} onClick={validate}>
                  Validate &amp; Preview
                  <ArrowRight aria-hidden weight="bold" className="size-4" />
                </Button>
              </div>
            </Card>
          ) : null}

          {step === 'preview' && preview ? (
            <Card title="Validate & Preview" testId="import-preview">
              <div className="grid gap-3 sm:grid-cols-3">
                <Count label="New staff to create" value={preview.toCreate} tone="text-success" />
                <Count label="Existing staff to update" value={preview.toUpdate} tone="text-link" />
                <Count label="Rows with errors" value={preview.invalid} tone="text-danger" />
              </div>
              <Table
                rows={preview.errors}
                rowKey={(e) => `${e.row}-${e.field ?? ''}-${e.message}`}
                caption="Rows with errors"
                dense
                pageSize={10}
                emptyTitle="No errors"
                emptyText="Every row can be imported."
                columns={[
                  { id: 'row', label: 'Row', cell: (e) => e.row },
                  { id: 'field', label: 'Field', cell: (e) => fieldLabel(e.field) },
                  { id: 'message', label: 'Problem', cell: (e) => e.message },
                ]}
              />
              {preview.invalid ? (
                <Callout icon={WarningCircle} tone="amber" surface="warning" size="compact">
                  Rows with errors are skipped. Fix them in the file and upload it again, or import
                  the valid rows now.
                </Callout>
              ) : null}
              <Checkbox
                label="Send invitations to the new staff now"
                checked={invite}
                onChange={(event) => setInvite(event.target.checked)}
                className="text-sm"
              />
              <p className="text-xs text-muted">
                Each invitation is a secure, time-limited link; no password is ever sent. Without
                it, they are added as Invited and you can send the invitation later.
              </p>
              {run.error ? (
                <p role="alert" className="text-sm text-danger">
                  {errorMessage(run.error, IMPORT_ERRORS)}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={() => setStep('map')}>
                  <ArrowLeft aria-hidden weight="bold" className="size-4" />
                  Back to Mapping
                </Button>
                <Button
                  className="ml-auto"
                  disabled={run.isPending || preview.toCreate + preview.toUpdate === 0}
                  onClick={() =>
                    run.mutate(
                      { previewToken: preview.previewToken, sendInvitations: invite },
                      {
                        onSuccess: (r) => {
                          setResult(r);
                          setStep('results');
                        },
                      },
                    )
                  }
                >
                  Import {preview.toCreate + preview.toUpdate} Staff
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
              <div className="grid gap-3 sm:grid-cols-4">
                <Count label="Created" value={result.created} tone="text-success" />
                <Count label="Updated" value={result.updated} tone="text-link" />
                <Count label="Failed" value={result.failed} tone="text-danger" />
                <Count
                  label="Invitations sent"
                  value={result.invitationsSent}
                  tone="text-heading"
                />
              </div>
              {result.errorFileUrl ? (
                <a
                  href={result.errorFileUrl}
                  className="inline-flex min-h-11 w-fit items-center gap-2 rounded-control border border-danger px-5 text-sm font-semibold text-danger"
                >
                  <DownloadSimple aria-hidden weight="bold" className="size-4" />
                  Download Error File
                </a>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={startOver}>
                  Upload Another File
                </Button>
                <Link
                  href="/team"
                  className="ml-auto inline-flex min-h-11 items-center rounded-control bg-action px-6 text-sm font-semibold text-on-action hover:bg-action-hover"
                >
                  Go to Staff Management
                </Link>
              </div>
            </Card>
          ) : null}
        </div>

        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          <ChecklistCard
            title="Before You Upload"
            icon={ListChecks}
            iconTone="blue"
            items={BEFORE.map((label) => ({ id: label, label, done: true }))}
          />
          <Callout icon={Info} tone="navy" surface="plain" size="compact">
            The file stays in your browser: only its rows are sent to be checked. The import is
            recorded in the audit log with the file name and counts.
          </Callout>
          <NeedHelpCard />
        </aside>
      </div>
    </div>
  );
}
