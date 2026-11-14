'use client';

import {
  LEAD_EXPORT_FIELD_LABELS,
  LEAD_EXPORT_FIELDS,
  type LeadExportField,
  type LeadExportLink,
  type LeadPipelineQuery,
} from '@firmivra/types';
import { Button, Checkbox, Modal } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';

type Scope = 'SELECTED' | 'FILTERED' | 'ALL';

/**
 * Export (Leads R2 16): the scope (the selected leads, the list as filtered now, or all the leads
 * the member reaches) and the columns are chosen and shown with their count before the file is
 * made. Private fields (date of birth, address) are never offered. The Owner, or Leads EXPORT.
 */
export function LeadExportDialog({
  selectedIds,
  query,
  filteredTotal,
  onClose,
}: {
  selectedIds: string[];
  query: LeadPipelineQuery;
  filteredTotal: number;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>(selectedIds.length ? 'SELECTED' : 'FILTERED');
  const [fields, setFields] = useState<LeadExportField[]>([...LEAD_EXPORT_FIELDS]);
  const [link, setLink] = useState<LeadExportLink | null>(null);
  const { page: _page, pageSize: _size, ...filters } = query;
  const make = useApiMutation(() =>
    api.leadTransfer.export({
      scope,
      fields,
      ...(scope === 'SELECTED' ? { ids: selectedIds } : {}),
      ...(scope === 'FILTERED' ? { filters } : {}),
    }),
  );
  const scopes: { value: Scope; label: string; disabled?: boolean }[] = [
    {
      value: 'SELECTED',
      label: `Selected leads (${selectedIds.length})`,
      disabled: selectedIds.length === 0,
    },
    { value: 'FILTERED', label: `The list as filtered now (${filteredTotal})` },
    { value: 'ALL', label: 'All the leads you can see' },
  ];
  return (
    <Modal
      open
      title="Export Leads"
      subtitle="A CSV file you can open in a spreadsheet."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={make.isPending || fields.length === 0}
            onClick={() => make.mutate(undefined, { onSuccess: setLink })}
            data-testid="export-make"
          >
            Create File
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="lead-export">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-heading">Which leads</legend>
          {scopes.map((s) => (
            <label key={s.value} className="flex items-center gap-2 text-sm text-text">
              <input
                type="radio"
                name="export-scope"
                checked={scope === s.value}
                disabled={s.disabled}
                onChange={() => {
                  setScope(s.value);
                  setLink(null);
                }}
                className="size-4"
              />
              {s.label}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-heading">Columns</legend>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {LEAD_EXPORT_FIELDS.map((f) => (
              <Checkbox
                key={f}
                label={LEAD_EXPORT_FIELD_LABELS[f]}
                checked={fields.includes(f)}
                onChange={(e) => {
                  setLink(null);
                  setFields((all) =>
                    e.target.checked
                      ? LEAD_EXPORT_FIELDS.filter((x) => x === f || all.includes(x))
                      : all.filter((x) => x !== f),
                  );
                }}
              />
            ))}
          </div>
          <p className="text-xs text-muted">Dates of birth and addresses are never exported.</p>
        </fieldset>
        {make.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(make.error)}
          </p>
        ) : null}
        {link ? (
          <p role="status" className="text-sm text-heading" data-testid="export-ready">
            {link.rowCount} {link.rowCount === 1 ? 'lead' : 'leads'} in{' '}
            <a href={link.url} className="text-link underline" download={link.fileName}>
              {link.fileName}
            </a>
            . The link works for five minutes.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
