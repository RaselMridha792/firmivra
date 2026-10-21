'use client';

import { DOCUMENT_ERRORS } from '@firmivra/types';
import { Button, Modal, PageHeader, Stepper } from '@firmivra/ui';
import { ArrowLeft, ArrowRight, CaretRight, CheckCircle } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { uploadFile } from '../../../../../../lib/upload';
import { DocumentInfo } from './document-info';
import { FilePicker } from './file-picker';
import { DetailsStep, OrganizeStep, ReviewStep } from './upload-steps';
import { baseName, EMPTY_INFO, savedName, type QueuedFile, type SharedInfo } from './upload-state';

const STEPS = [
  { id: 'files', label: 'Upload Files' },
  { id: 'details', label: 'Document Details' },
  { id: 'organize', label: 'Organize & Assign' },
  { id: 'review', label: 'Review & Upload' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

let nextKey = 0;

/**
 * Upload Document (Documents design, Frame 1): choose files, say whose they are and how to file
 * them, check each file's details, then upload. Every step's required fields are seen before the
 * last one (docx C06); a file is saved only by the final Upload, one by one, each with its own
 * result. Uploads go to a client's open service (the library API's `serviceId`).
 */
export function UploadDocumentScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';

  const [step, setStep] = useState<StepId>('files');
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [shared, setShared] = useState<SharedInfo>(EMPTY_INFO);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Opened from a client's profile (`?clientId=`): that client is chosen until another is.
  const presetId = params.get('clientId');
  const preset = useQuery({
    queryKey: ['upload-document', 'client', presetId],
    queryFn: () => api.clients.get(presetId ?? ''),
    enabled: Boolean(presetId),
  });
  const info: SharedInfo = { ...shared, client: shared.client ?? preset.data ?? null };
  const clientId = info.client?.id;

  const categories = useApiQuery(['document-categories'], () => api.documents.categories());
  const folders = useApiQuery(['document-folders'], () => api.documentLibrary.folders());
  const team = useQuery({ queryKey: ['team'], queryFn: () => api.team.list(), enabled: manager });
  const engagements = useQuery({
    queryKey: ['engagements', clientId, 'ACTIVE'],
    queryFn: () => api.engagements.listForClient(clientId ?? '', { status: 'ACTIVE' }),
    enabled: Boolean(clientId),
  });
  const open = engagements.data ?? [];

  const index = STEPS.findIndex((s) => s.id === step);
  const done = files.length > 0 && files.every((f) => f.state === 'DONE');
  const failed = files.filter((f) => f.state === 'FAILED').length;
  const dirty = files.length > 0 || info.client !== null || shared.description !== '';

  const patchFile = (key: string, next: Partial<QueuedFile>) =>
    setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...next } : f)));
  const patchInfo = (next: Partial<SharedInfo>) => {
    setShared((current) => ({ ...current, client: info.client, ...next }));
    // Another client's services differ: the files' service is chosen again.
    if (next.client && next.client.id !== clientId) {
      setFiles((list) => list.map((f) => ({ ...f, serviceId: '' })));
    }
  };

  function addFiles(picked: File[]) {
    setFiles((list) => [
      ...list,
      ...picked.map((file) => ({
        key: `file-${nextKey++}`,
        file,
        name: '',
        categoryId: '',
        serviceId: '',
        taxYear: '',
        state: 'QUEUED' as const,
        percent: 0,
        error: null,
      })),
    ]);
  }

  /** The required fields of this step; empty when it may move on. */
  function check(at: StepId): Record<string, string> {
    const found: Record<string, string> = {};
    if (at === 'files') {
      if (!files.length) found['files'] = 'Choose at least one file.';
      if (!info.client) found['client'] = 'Choose the client these files belong to.';
      if (!info.categoryId) found['categoryId'] = 'Choose a document type.';
      if (!info.folderId) found['folderId'] = 'Choose a folder.';
    }
    if (at === 'details') {
      for (const f of files) {
        if (!f.name.trim()) found[`${f.key}-name`] = 'Enter a name.';
        if (!f.categoryId) found[`${f.key}-categoryId`] = 'Choose a type.';
        if (!f.serviceId) found[`${f.key}-serviceId`] = 'Choose a service.';
      }
    }
    if (at === 'organize' && !info.folderId) found['folderId'] = 'Choose a folder.';
    return found;
  }

  function next() {
    const found = check(step);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (step === 'files') {
      // Each file starts from what was chosen for all of them; one file takes the typed name.
      const only = open.length === 1 ? open[0] : undefined;
      setFiles((list) =>
        list.map((f) => ({
          ...f,
          name: f.name || (list.length === 1 && info.name.trim()) || baseName(f.file.name),
          categoryId: f.categoryId || info.categoryId,
          serviceId: f.serviceId || only?.id || '',
          taxYear: f.taxYear || (only?.taxYear ? String(only.taxYear) : ''),
        })),
      );
    }
    setStep(STEPS[index + 1]?.id ?? step);
  }

  async function upload() {
    if (!clientId) return;
    setBusy(true);
    for (const item of files) {
      if (item.state === 'DONE') continue;
      patchFile(item.key, { state: 'UPLOADING', percent: 0, error: null });
      try {
        await uploadFile(item.file, {
          start: (facts) =>
            api.documentLibrary.createUpload({
              clientId,
              serviceId: item.serviceId,
              categoryId: item.categoryId || null,
              folderId: info.folderId || null,
              taxYear: item.taxYear ? Number(item.taxYear) : null,
              ...(info.description.trim() ? { description: info.description.trim() } : {}),
              tags: info.tags,
              reviewerUserId: info.reviewerUserId || null,
              shareWithClient: info.shareWithClient,
              notifyClient: info.shareWithClient && info.notifyClient,
              ...facts,
              fileName: savedName(item.name, item.file.name),
            }),
          finish: (uploadToken) => api.documents.confirmUpload({ uploadToken }),
          onProgress: (percent) => patchFile(item.key, { percent }),
        });
        patchFile(item.key, { state: 'DONE', percent: 100 });
      } catch (error) {
        patchFile(item.key, { state: 'FAILED', error: errorMessage(error, DOCUMENT_ERRORS) });
      }
    }
    setBusy(false);
    void queryClient.invalidateQueries({ queryKey: ['documents'] });
  }

  function leave() {
    if (dirty && !done) setLeaving(true);
    else router.push('/documents');
  }

  const locked = busy || done;
  return (
    <div data-testid="upload-document" className="flex min-w-0 flex-col gap-5">
      <PageHeader
        above={
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-2 text-sm">
              <li>
                <Link href="/documents" className="text-text hover:text-action hover:underline">
                  Documents
                </Link>
              </li>
              <li aria-hidden>
                <CaretRight weight="bold" className="size-3 text-muted" />
              </li>
              <li aria-current="page" className="font-medium text-heading">
                Upload Document
              </li>
            </ol>
          </nav>
        }
        title="Upload Document"
        subtitle="Securely upload and organize documents for your clients, leads, or firm."
        actions={
          <Button variant="outline" onClick={leave}>
            <ArrowLeft aria-hidden weight="bold" className="size-5" />
            Back to Documents
          </Button>
        }
      />

      <div className="flex min-w-0 flex-col gap-6 rounded-card bg-surface p-4 shadow-card sm:p-6">
        <div className="overflow-x-auto pb-1">
          <div className="min-w-[36rem]">
            <Stepper steps={[...STEPS]} current={step} variant="wizard" label="Upload steps" />
          </div>
        </div>

        {step === 'files' ? (
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              <FilePicker
                files={files}
                disabled={locked}
                onAdd={addFiles}
                onRemove={(key) => setFiles((list) => list.filter((f) => f.key !== key))}
                onClear={() => setFiles([])}
              />
              {errors['files'] ? (
                <p role="alert" className="text-sm font-medium text-danger">
                  {errors['files']}
                </p>
              ) : null}
            </div>
            <DocumentInfo
              info={info}
              onChange={patchInfo}
              categories={categories.data}
              folders={folders.data}
              fileCount={files.length}
              errors={errors}
              disabled={locked}
            />
          </div>
        ) : step === 'details' ? (
          <DetailsStep
            files={files}
            onChange={patchFile}
            categories={categories.data ?? []}
            engagements={open}
            engagementsState={
              engagements.isPending ? 'loading' : engagements.isError ? 'error' : 'ready'
            }
            errors={errors}
          />
        ) : step === 'organize' ? (
          <OrganizeStep
            info={info}
            onChange={patchInfo}
            folders={folders.data ?? []}
            team={manager ? (team.data ?? []) : null}
            errors={errors}
          />
        ) : (
          <ReviewStep
            info={info}
            files={files}
            categories={categories.data ?? []}
            engagements={open}
            folders={folders.data ?? []}
            team={manager ? (team.data ?? []) : null}
          />
        )}

        {done ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-card bg-success-soft px-4 py-3 text-heading"
          >
            <CheckCircle aria-hidden weight="fill" className="size-6 text-success" />
            <span className="flex-1">
              {files.length === 1 ? 'The document was' : `${files.length} documents were`} uploaded
              to {info.client?.displayName}.
            </span>
          </div>
        ) : failed && !busy ? (
          <p role="alert" className="rounded-card bg-danger-soft px-4 py-3 text-sm text-heading">
            {failed === 1 ? 'One file was' : `${failed} files were`} not uploaded. Check the reason
            beside each, then try again.
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-3">
          {done ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setFiles([]);
                  setShared(EMPTY_INFO);
                  setStep('files');
                }}
              >
                Upload More
              </Button>
              <Button onClick={() => router.push('/documents')}>Back to Documents</Button>
            </>
          ) : (
            <>
              {index > 0 ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setStep(STEPS[index - 1]!.id)}
                >
                  <ArrowLeft aria-hidden weight="bold" className="size-4" />
                  Back
                </Button>
              ) : null}
              <Button variant="secondary" disabled={busy} onClick={leave}>
                Cancel
              </Button>
              {step === 'review' ? (
                <Button disabled={busy} onClick={() => void upload()}>
                  {busy
                    ? 'Uploading…'
                    : failed
                      ? 'Try Again'
                      : `Upload ${files.length === 1 ? 'Document' : `${files.length} Documents`}`}
                </Button>
              ) : (
                <Button onClick={next}>
                  Next: {STEPS[index + 1]?.label}
                  <ArrowRight aria-hidden weight="bold" className="size-4" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <Modal
        open={leaving}
        title="Leave without uploading?"
        onClose={() => setLeaving(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLeaving(false)}>
              Keep Editing
            </Button>
            <Button onClick={() => router.push('/documents')}>Leave</Button>
          </>
        }
      >
        <p className="text-sm text-text">
          {files.some((f) => f.state === 'DONE')
            ? 'Files already uploaded stay saved; the others are not uploaded.'
            : 'The chosen files and details are not saved. Nothing has been uploaded yet.'}
        </p>
      </Modal>
    </div>
  );
}
