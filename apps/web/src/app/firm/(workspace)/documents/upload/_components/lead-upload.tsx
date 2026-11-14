'use client';

import { DOCUMENT_ERRORS, type LeadRow, UPLOAD_LIMITS } from '@firmivra/types';
import { Avatar, Button, Skeleton } from '@firmivra/ui';
import { ArrowLeft, CaretDown, CheckCircle, MagnifyingGlass } from '@phosphor-icons/react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { uploadFile } from '../../../../../../lib/upload';
import { LEAD_PIPELINE_KEY } from '../../../leads/_components/lead-shared';
import { useSettled } from './client-picker';
import { FilePicker } from './file-picker';
import type { QueuedFile } from './upload-state';

type Lead = Pick<LeadRow, 'id' | 'firstName' | 'lastName' | 'email' | 'phone'>;
const nameOf = (lead: Lead) => `${lead.firstName} ${lead.lastName}`.trim();

/**
 * Upload For: Lead (Leads R2 4). The files are added to the lead (its Documents & Forms), without
 * a client's services or folders: R5's upload steps through the lead's own routes. Opened from a
 * lead (`?leadId=`), that lead is chosen and the way back is to it. At conversion each file
 * becomes a firm-only document of the new client.
 */
export function LeadUpload({
  presetLeadId,
  files,
  setFiles,
  onAdd,
  picker,
}: {
  presetLeadId: string | null;
  files: QueuedFile[];
  setFiles: (update: (list: QueuedFile[]) => QueuedFile[]) => void;
  onAdd: (picked: File[]) => void;
  /** The "Upload For" choice, so the member can go back to a client. */
  picker: React.ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const preset = useQuery({
    queryKey: ['upload-document', 'lead', presetLeadId],
    queryFn: () => api.leadPipeline.profile(presetLeadId ?? ''),
    enabled: Boolean(presetLeadId),
  });
  const [chosen, setChosen] = useState<Lead | null>(null);
  const lead = chosen ?? preset.data ?? null;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const done = files.length > 0 && files.every((f) => f.state === 'DONE');
  const failed = files.filter((f) => f.state === 'FAILED').length;
  const patch = (key: string, next: Partial<QueuedFile>) =>
    setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...next } : f)));
  const back = lead ? `/leads/${lead.id}/documents` : '/documents';

  async function upload() {
    if (!files.length) return setError('Choose at least one file.');
    if (!lead) return setError('Choose the lead these files belong to.');
    setError('');
    setBusy(true);
    for (const item of files) {
      if (item.state === 'DONE') continue;
      patch(item.key, { state: 'UPLOADING', percent: 0, error: null });
      try {
        await uploadFile(item.file, {
          maxBytes: UPLOAD_LIMITS.maxBytes,
          start: (facts) => api.leadPipeline.createFile(lead.id, facts),
          finish: (uploadToken) => api.leadPipeline.confirmFile(lead.id, { uploadToken }),
          onProgress: (percent) => patch(item.key, { percent }),
        });
        patch(item.key, { state: 'DONE', percent: 100 });
      } catch (e) {
        patch(item.key, { state: 'FAILED', error: errorMessage(e, DOCUMENT_ERRORS) });
      }
    }
    setBusy(false);
    // The lead's Documents & Forms (and the rest of its page) read again.
    void queryClient.invalidateQueries({ queryKey: LEAD_PIPELINE_KEY });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="lead-upload">
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <FilePicker
          files={files}
          disabled={busy || done}
          onAdd={onAdd}
          onRemove={(key) => setFiles((list) => list.filter((f) => f.key !== key))}
          onClear={() => setFiles(() => [])}
        />
        <section className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface p-5">
          <h2 className="font-display text-xl font-bold text-heading">Document Information</h2>
          {picker}
          <LeadPicker value={lead} onChange={setChosen} disabled={busy || done} />
          <p className="text-xs text-muted">
            Files added to a lead stay internal. When the lead becomes a client, they move to the
            client&apos;s documents, still internal until shared.
          </p>
        </section>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {done && lead ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-card bg-success-soft px-4 py-3 text-heading"
        >
          <CheckCircle aria-hidden weight="fill" className="size-6 text-success" />
          <span className="flex-1">
            {files.length === 1 ? 'The document was' : `${files.length} documents were`} added to{' '}
            {nameOf(lead)}.
          </span>
        </div>
      ) : failed && !busy ? (
        <p role="alert" className="rounded-card bg-danger-soft px-4 py-3 text-sm text-heading">
          {failed === 1 ? 'One file was' : `${failed} files were`} not uploaded. Check the reason
          beside each, then try again.
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        {lead ? (
          <Button variant="secondary" disabled={busy} onClick={() => router.push(back)}>
            <ArrowLeft aria-hidden weight="bold" className="size-4" />
            Back to {nameOf(lead)}
          </Button>
        ) : null}
        {done ? null : (
          <Button disabled={busy} onClick={() => void upload()}>
            {busy
              ? 'Uploading…'
              : failed
                ? 'Try Again'
                : files.length === 1
                  ? 'Upload Document'
                  : 'Upload Documents'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The lead the files are for: searched among the leads the member reaches. */
function LeadPicker({
  value,
  onChange,
  disabled,
}: {
  value: Lead | null;
  onChange: (lead: Lead) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const term = useSettled(text.trim());
  const leads = useQuery({
    queryKey: ['upload-document', 'leads', term],
    queryFn: () => api.leadPipeline.list({ search: term || undefined, pageSize: 8 }),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  return (
    <div
      className="relative flex flex-col gap-1.5"
      onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setOpen(false)}
    >
      <span id={`${id}-label`} className="text-sm font-semibold text-heading">
        Lead<span className="text-danger"> *</span>
      </span>
      <button
        type="button"
        aria-labelledby={`${id}-label`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-14 w-full items-center gap-3 rounded-control border border-border bg-surface px-3 py-2 text-left shadow-sm hover:border-control-border disabled:cursor-not-allowed disabled:bg-disabled"
      >
        {value ? (
          <>
            <Avatar name={nameOf(value)} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-heading">{nameOf(value)}</span>
              <span className="block truncate text-sm text-muted">{value.email}</span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-muted">Choose a lead</span>
        )}
        <CaretDown aria-hidden weight="bold" className="size-4 shrink-0 text-heading" />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Choose a lead"
          className="absolute top-full right-0 left-0 z-30 mt-1 rounded-card border border-border bg-surface p-2 shadow-card"
        >
          <label className="flex h-10 items-center gap-2 rounded-control border border-border bg-canvas px-3 text-sm">
            <MagnifyingGlass aria-hidden weight="bold" className="size-4 text-muted" />
            <span className="sr-only">Search leads</span>
            <input
              type="search"
              autoFocus
              maxLength={100}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Search by name, email or phone…"
              className="min-h-0 w-full bg-transparent text-text outline-none"
            />
          </label>
          <ul aria-label="Leads" className="mt-2 max-h-72 overflow-y-auto">
            {leads.isPending ? (
              <li>
                <Skeleton className="m-2 h-10" />
              </li>
            ) : leads.isError ? (
              <li className="px-3 py-2 text-sm text-muted">Could not load leads right now.</li>
            ) : leads.data.items.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">No matching leads.</li>
            ) : (
              leads.data.items.map((lead) => (
                <li key={lead.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(lead);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left hover:bg-canvas focus-visible:bg-canvas"
                  >
                    <Avatar name={nameOf(lead)} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-heading">
                        {nameOf(lead)}
                      </span>
                      <span className="block truncate text-xs text-muted">{lead.email}</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
