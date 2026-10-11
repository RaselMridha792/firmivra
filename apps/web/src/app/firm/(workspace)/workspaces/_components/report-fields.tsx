'use client';
import { type CreateReportRequest, type Workspace } from '@firmivra/types';
import { Button, Input, Textarea } from '@firmivra/ui';
import { useState } from 'react';
import { useFieldArray, type UseFormReturn } from 'react-hook-form';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { Pages } from './workspace-parts';

const amount = (value: string | number | null | undefined) => {
  if (value == null || typeof value === 'number') return value ?? null;
  if (!value.trim()) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(value.trim())) return NaN;
  const [whole, fraction = ''] = value.trim().replace('-', '').split('.');
  return (
    (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) *
    (value.trim().startsWith('-') ? -1 : 1)
  );
};

export function ReportFigures({ form }: { form: UseFormReturn<CreateReportRequest> }) {
  const lines = useFieldArray({ control: form.control, name: 'data.lines' });
  return (
    <section className="space-y-3" aria-label="Report figures" data-testid="report-figures">
      <h3 className="font-semibold text-heading">Figures (optional)</h3>
      {lines.fields.map((line, index) => (
        <div
          key={line.id}
          className="space-y-3 rounded-card border border-border p-3"
          data-testid="report-line"
        >
          <Input
            label={`Figure label ${index + 1}`}
            maxLength={120}
            error={form.formState.errors.data?.lines?.[index]?.label?.message}
            {...form.register(`data.lines.${index}.label`)}
          />
          <Input
            label={`Amount ${index + 1} (USD, optional)`}
            type="text"
            inputMode="decimal"
            error={
              form.formState.errors.data?.lines?.[index]?.amountCents
                ? 'Enter an amount with at most two decimal places, within the supported limit.'
                : undefined
            }
            {...form.register(`data.lines.${index}.amountCents`, { setValueAs: amount })}
          />
          <Textarea
            label={`Figure note ${index + 1} (optional)`}
            maxLength={400}
            error={form.formState.errors.data?.lines?.[index]?.note?.message}
            {...form.register(`data.lines.${index}.note`)}
          />
          <Button
            variant="secondary"
            onClick={() => lines.remove(index)}
            aria-label={`Remove figure ${index + 1}`}
          >
            Remove figure
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        disabled={lines.fields.length >= 50}
        onClick={() => lines.append({ label: '', amountCents: null, note: '' })}
      >
        Add figure
      </Button>
    </section>
  );
}

export function ReportDocument({
  workspace,
  form,
}: {
  workspace: Workspace;
  form: UseFormReturn<CreateReportRequest>;
}) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const documents = useApiQuery(
    ['workspaces', workspace.engagementId, 'report-documents', cursors.at(-1)],
    () =>
      api.documents.list(workspace.client.id, {
        serviceId: workspace.engagementId,
        cursor: cursors.at(-1),
      }),
  );
  const selected = form.watch('documentId');
  return (
    <section className="space-y-3" data-testid="report-document-picker">
      <p className="text-sm text-muted">
        Attach a client-visible document from this service. Internal files cannot be attached.
      </p>
      {selected ? (
        <Button
          variant="secondary"
          data-testid="report-selected-document"
          onClick={() => form.setValue('documentId', undefined, { shouldValidate: true })}
        >
          Remove attachment
        </Button>
      ) : null}
      <PageState
        query={documents}
        empty="No documents for this service."
        isEmpty={(data) => !data.items.length}
      >
        {(data) => (
          <>
            <ul className="space-y-2">
              {data.items
                .filter((doc) => doc.direction !== 'INTERNAL')
                .map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-col gap-2 rounded-card border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p className="min-w-0 wrap-anywhere">{doc.fileName}</p>
                    <Button
                      variant="secondary"
                      disabled={selected === doc.id}
                      onClick={() => form.setValue('documentId', doc.id, { shouldValidate: true })}
                      aria-label={`Attach ${doc.fileName}`}
                    >
                      {selected === doc.id ? 'Selected' : 'Attach'}
                    </Button>
                  </li>
                ))}
            </ul>
            {!data.items.some((doc) => doc.direction !== 'INTERNAL') ? (
              <p className="text-sm text-muted">No client-visible documents on this page.</p>
            ) : null}
            <Pages
              cursors={cursors}
              next={data.nextCursor}
              set={setCursors}
              label="Attachment pages"
            />
          </>
        )}
      </PageState>
      {form.formState.errors.documentId ? (
        <p role="alert" className="text-sm text-danger">
          {form.formState.errors.documentId.message}
        </p>
      ) : null}
    </section>
  );
}
