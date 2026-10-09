'use client';

import { DOCUMENT_ERRORS, UPLOAD_LIMITS, type UploadTargets } from '@firmivra/types';
import { Button, Modal, Select } from '@firmivra/ui';
import { BriefcaseBusiness, ChevronRight, CircleX, FileUser, type LucideIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { uploadFile } from '../../../../../../../lib/upload';
import { usePortal } from '../../../../layout';

type Kind = keyof UploadTargets;
/** What a request's "Upload" button opens the form with. */
export interface Preset {
  serviceId: string;
  requestId: string;
}

const ACCEPT = Object.entries(UPLOAD_LIMITS.types)
  .flatMap(([type, endings]) => [type, ...endings])
  .join(',');

/**
 * The Upload Documents pop-up (docs/mockups/client-portal/Upload docs popup.png): the reason
 * first (an open tax or business service; none is the STOP card), then the file. The file
 * shows as "Checking…" in the list until its scan is done.
 */
export function UploadDialog({
  slug,
  open,
  preset,
  onClose,
  onUploaded,
}: {
  slug: string;
  open: boolean;
  preset?: Preset;
  onClose: () => void;
  onUploaded: (fileName: string) => void;
}) {
  const targets = useApiQuery(['my-upload-targets', slug], () =>
    api.myDocuments(slug).uploadTargets(),
  );
  const [kind, setKind] = useState<Kind | null>(null);
  const kindOf = (t: UploadTargets): Kind | null => {
    if (!preset) return kind;
    if (t.tax.some((s) => s.serviceId === preset.serviceId)) return 'tax';
    return t.business.some((s) => s.serviceId === preset.serviceId) ? 'business' : null;
  };
  const close = () => {
    setKind(null);
    onClose();
  };
  return (
    <Modal open={open} title="Upload Documents" onClose={close}>
      <div className="grid max-w-modal gap-4">
        <PageState query={targets}>
          {(t) => {
            const chosen = kindOf(t);
            return chosen ? (
              <UploadForm
                key={`${chosen}-${preset?.requestId ?? ''}`}
                slug={slug}
                targets={t[chosen]}
                preset={preset}
                onBack={preset ? close : () => setKind(null)}
                onUploaded={(name) => {
                  close();
                  onUploaded(name);
                }}
              />
            ) : (
              <Reasons targets={t} onPick={setKind} />
            );
          }}
        </PageState>
      </div>
    </Modal>
  );
}

function Reasons({ targets, onPick }: { targets: UploadTargets; onPick: (kind: Kind) => void }) {
  const { business } = usePortal();
  const reasons: [Kind, LucideIcon, string, string][] = [
    [
      'tax',
      FileUser,
      'Upload more tax documents for my tax preparer',
      `I am currently working with ${business.name} for an individual tax return or tax related service.`,
    ],
    [
      'business',
      BriefcaseBusiness,
      'Upload more documents for my business services',
      `I am currently working with ${business.name} for a business service (e.g., bookkeeping, payroll, business formation, etc.).`,
    ],
  ];
  return (
    <>
      <p className="text-text">Please select the reason for your document upload.</p>
      {reasons.map(([kind, Icon, title, text]) => (
        <button
          key={kind}
          type="button"
          disabled={targets[kind].length === 0}
          onClick={() => onPick(kind)}
          className="flex items-center gap-4 rounded-card border border-folder-border bg-folder-surface p-4 text-left hover:bg-folder-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon aria-hidden className="size-12 shrink-0 text-firm-primary" />
          <span className="flex-1">
            <span className="block font-display text-lg font-bold text-heading">{title}</span>
            <span className="block text-sm text-text">
              {targets[kind].length === 0 ? 'You have no open service of this kind.' : text}
            </span>
          </span>
          <ChevronRight aria-hidden className="size-6 shrink-0 text-firm-accent" />
        </button>
      ))}
      <div role="note" className="flex gap-4 rounded-card border border-danger bg-danger-soft p-4">
        <CircleX aria-hidden className="size-12 shrink-0 text-danger" />
        <div className="text-sm text-text">
          <p className="font-display text-lg font-bold text-heading">
            I don&apos;t have an open service with {business.name}
          </p>
          <p className="font-bold text-danger">STOP.</p>
          <p>You cannot upload documents just for safekeeping to this portal.</p>
          <p>
            This document upload tab is only to upload documents so that we can provide services.
          </p>
        </div>
      </div>
    </>
  );
}

function UploadForm({
  slug,
  targets,
  preset,
  onBack,
  onUploaded,
}: {
  slug: string;
  targets: UploadTargets[Kind];
  preset?: Preset;
  onBack: () => void;
  onUploaded: (fileName: string) => void;
}) {
  const [serviceId, setServiceId] = useState(preset?.serviceId ?? targets[0]?.serviceId ?? '');
  const [requestId, setRequestId] = useState(preset?.requestId ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [percent, setPercent] = useState(0);
  const categories = useApiQuery(['my-document-categories', slug], () =>
    api.myDocuments(slug).categories(),
  );
  const service = targets.find((t) => t.serviceId === serviceId);
  const upload = useApiMutation(
    (picked: File) =>
      uploadFile(picked, {
        start: (facts) =>
          api.myDocuments(slug).createUpload({
            serviceId,
            requestId: requestId || null,
            categoryId: categoryId || null,
            taxYear: service?.taxYear ?? null,
            ...facts,
          }),
        finish: (uploadToken) => api.myDocuments(slug).confirmUpload({ uploadToken }),
        onProgress: setPercent,
      }),
    { invalidate: ['my-documents', slug] },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (file) upload.mutate(file, { onSuccess: (doc) => onUploaded(doc.fileName) });
  };
  return (
    <form noValidate onSubmit={submit} className="grid gap-4" data-testid="upload-form">
      <fieldset className="contents" disabled={upload.isPending}>
        <Select
          label="Service"
          value={serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
            setRequestId('');
          }}
          options={targets.map((t) => ({ value: t.serviceId, label: t.title }))}
        />
        {service && service.openRequests.length > 0 ? (
          <Select
            label="For a document request (optional)"
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            options={[
              { value: '', label: 'No request' },
              ...service.openRequests.map((r) => ({ value: r.id, label: r.title })),
            ]}
          />
        ) : null}
        <Select
          label="Category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          options={[
            { value: '', label: 'Choose a category (optional)' },
            ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <label className="grid gap-1 text-sm font-medium text-text">
          File
          <input
            type="file"
            accept={ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="rounded-control border border-border p-2 text-base"
          />
          <span className="text-xs font-normal text-muted">
            {UPLOAD_LIMITS.typeNames}, up to 10 MB.
          </span>
        </label>
        {upload.isPending ? (
          <progress max={100} value={percent} aria-label="Upload progress" className="w-full" />
        ) : null}
        {upload.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(upload.error, DOCUMENT_ERRORS)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!file || !serviceId}>
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
