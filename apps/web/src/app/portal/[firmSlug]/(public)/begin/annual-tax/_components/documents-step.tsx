'use client';

import { Checkbox } from '@firmivra/ui';
import * as Icons from 'lucide-react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { SectionPanel } from '../../_blocks/form-blocks';
import { UploadTile } from '../../_blocks/upload-tile';
import { documentCategories, hasBusiness, identitySlots, type DocumentId } from './annual-data';
import { requiredDocumentIds, type AnnualValues } from './annual-schema';
import styles from './annual-tax.module.css';

function DocumentField({
  id,
  label,
  description,
  compact = false,
}: {
  id: DocumentId;
  label: string;
  description?: string;
  compact?: boolean;
}) {
  const form = useFormContext<AnnualValues>();
  const values = useWatch({ control: form.control });
  const required = requiredDocumentIds(form.getValues()).includes(id);
  const reasonError = form.getFieldState(`documents.${id}.reason`, form.formState).error?.message;
  return (
    <Controller
      control={form.control}
      name={`documents.${id}`}
      render={({ field, fieldState }) => (
        <UploadTile
          label={label}
          description={description}
          value={field.value}
          onChange={field.onChange}
          required={required}
          error={fieldState.error?.message}
          reasonError={reasonError}
          compact={compact}
          key={`${id}-${values.filingStatus}`}
        />
      )}
    />
  );
}
export function DocumentsStep() {
  const form = useFormContext<AnnualValues>();
  const values = useWatch({ control: form.control });
  const business = hasBusiness(values.returnTypes ?? []);
  return (
    <div className="space-y-2">
      <SectionPanel title="Required Document Uploads" className={styles.panel}>
        <p className="text-sm text-firm-primary">
          Please select all applicable documents based on the information you provided on the
          previous page.
        </p>
        <p className="text-sm text-firm-primary">
          If a document does not apply or you do not have it, select “I don&apos;t have this
          document” and provide an explanation.
        </p>
        <div className="mt-2 flex gap-3 rounded-control bg-accent-soft p-3">
          <Icons.Info aria-hidden="true" className="size-8 shrink-0 text-accent" />
          <h3 className="font-display text-lg font-bold text-heading">Important:</h3>
          <ul className="list-disc pl-4 text-xs text-firm-primary">
            <li>Select clear, legible files (PDF, JPG, or PNG).</li>
            <li>You can select multiple files for each item (as many as needed).</li>
            <li>Maximum file size: 10 MB per file.</li>
            <li>Make sure each document is labeled correctly.</li>
            <li>
              All required documents must be selected or marked as “I don&apos;t have this document”
              with an explanation.
            </li>
          </ul>
        </div>
      </SectionPanel>
      <SectionPanel
        title="Identity Verification Documents"
        subtitle="Select government-issued IDs, Social Security cards, and dependent verification documents."
        icon={<Icons.ContactRound className="size-8" />}
        className={styles.panel}
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {identitySlots.map(({ id, title, description }) => (
            <div
              key={id}
              className="row-span-5 grid min-w-0 grid-rows-subgrid rounded-control border border-folder-border p-2"
            >
              <DocumentField id={id} label={title} description={description} compact />
            </div>
          ))}
        </div>
      </SectionPanel>
      {documentCategories
        .filter(({ id }) => business || (id !== 'businessDocuments' && id !== 'formationDocuments'))
        .map(({ id, title, subtitle, examples, icon }) => {
          const Icon =
            icon === 'business'
              ? Icons.BriefcaseBusiness
              : icon === 'building'
                ? Icons.Building2
                : Icons.FileText;
          return (
            <SectionPanel
              key={id}
              title={title}
              subtitle={subtitle}
              icon={<Icon className="size-8" />}
              iconPosition="start"
              className={styles.panel}
              aside={
                <div className="rounded-control bg-folder-surface p-3 text-xs text-firm-primary">
                  <p className="mb-1 flex gap-2 font-semibold">
                    <Icons.FileText aria-hidden="true" className="size-6 shrink-0" />
                    Examples of {title}:
                  </p>
                  <ul
                    className={`grid list-disc gap-x-5 pl-4 ${id === 'formationDocuments' ? '' : 'sm:grid-cols-2'}`}
                  >
                    {examples.map((example) => (
                      <li key={example}>{example}</li>
                    ))}
                  </ul>
                  {id === 'businessDocuments' && (
                    <div className="mt-2 rounded-control bg-accent-soft p-2">
                      <strong>Required for Business Filings:</strong>
                      <ul className="list-disc pl-4">
                        <li>A categorized list of all business expenses</li>
                        <li>A summary of year-to-date business income</li>
                      </ul>
                    </div>
                  )}
                </div>
              }
            >
              <DocumentField id={id} label={title} />
            </SectionPanel>
          );
        })}
      <div className="rounded-control bg-accent-soft p-2">
        <Controller
          control={form.control}
          name="certified"
          render={({ field, fieldState }) => (
            <>
              <Checkbox
                label="Yes, I certify that I have provided all required documents and that the information provided is true and accurate to the best of my knowledge. I understand that failure to provide the required documents may delay the preparation of my tax return."
                checked={field.value}
                onChange={field.onChange}
                className="text-xs!"
              />
              {fieldState.error && (
                <p className="text-xs text-danger">{fieldState.error.message}</p>
              )}
            </>
          )}
        />
      </div>
    </div>
  );
}
