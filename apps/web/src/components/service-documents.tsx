'use client';

import { DOCUMENT_ERRORS, megabytes, UPLOAD_LIMITS } from '@firmivra/types';
import { Button, Checkbox, FileDropzone, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { createContext, type ReactNode, use, useState } from 'react';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useApiQuery } from '../lib/query';
import { useUnsavedChanges } from '../lib/unsaved';
import { uploadFile } from '../lib/upload';

/** The client and service a request or upload is for, as the workspace knows them. */
export interface ServiceDocumentTarget {
  clientId: string;
  clientName: string;
  /** The client's engagement for the service: the documents API's `serviceId`. */
  engagementId: string;
  /** "Payroll", "Bookkeeping", "Tax Returns". */
  service: string;
  /** "October 2026", "Tax year 2025": the period the workspace is on, when it knows one. */
  period?: string;
  taxYear?: number | null;
}

type Kind = 'request' | 'upload';
interface ServiceDocuments {
  /** Opens Request Documents or Upload Document here, for `target` or the workspace's client. */
  open: (kind: Kind, target?: ServiceDocumentTarget) => void;
}

const Context = createContext<ServiceDocuments | null>(null);

/** Request Documents and Upload Document of the nearest workspace (SH3). */
export function useServiceDocuments(): ServiceDocuments {
  const value = use(Context);
  if (!value) throw new Error('useServiceDocuments needs a ServiceDocumentsProvider');
  return value;
}

/**
 * Request Documents and Upload Document in place (Octavia's SH3): the dialog opens on the current
 * tab, prefilled with the client, the service and its period, and Save, Cancel or close stay
 * there. One record: the request or file is the client's, in Documents, the client's profile,
 * the service and the client's portal. Without a client (a module's main page), the dialog asks
 * which client first, from `choices`.
 */
export function ServiceDocumentsProvider({
  target,
  choices,
  onDone,
  children,
}: {
  target?: ServiceDocumentTarget;
  choices?: readonly ServiceDocumentTarget[];
  onDone: (text: string) => void;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState<{ kind: Kind; target?: ServiceDocumentTarget }>();
  const close = () => setOpened(undefined);
  const done = (text: string) => {
    close();
    onDone(text);
  };
  const chosen = opened?.target ?? target;
  return (
    <Context value={{ open: (kind, t) => setOpened({ kind, target: t }) }}>
      {children}
      {opened?.kind === 'request' ? (
        <RequestDocumentsDialog
          target={chosen}
          choices={chosen ? undefined : choices}
          onClose={close}
          onDone={done}
        />
      ) : null}
      {opened?.kind === 'upload' ? (
        <UploadDocumentDialog
          target={chosen}
          choices={chosen ? undefined : choices}
          onClose={close}
          onDone={done}
        />
      ) : null}
    </Context>
  );
}

const docError = (e: unknown) => errorMessage(e, DOCUMENT_ERRORS);

/** Who and what, before anything is sent. */
function Summary({ target, extra }: { target: ServiceDocumentTarget; extra?: ReactNode }) {
  return (
    <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-control bg-canvas px-4 py-3 text-sm">
      <dt className="font-semibold text-heading">Client</dt>
      <dd className="text-text">{target.clientName}</dd>
      <dt className="font-semibold text-heading">Service</dt>
      <dd className="text-text">{target.service}</dd>
      {target.period ? (
        <>
          <dt className="font-semibold text-heading">Period</dt>
          <dd className="text-text">{target.period}</dd>
        </>
      ) : null}
      {extra}
    </dl>
  );
}

/** The client picker of a main page's dialog; null when the workspace knows the client. */
function useTarget(
  target: ServiceDocumentTarget | undefined,
  choices: readonly ServiceDocumentTarget[] | undefined,
) {
  const [clientId, setClientId] = useState('');
  const picked = target ?? choices?.find((c) => c.clientId === clientId);
  const picker = !target ? (
    choices?.length ? (
      <Select
        label="Client"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        options={[
          { value: '', label: 'Choose a client' },
          ...choices.map((c) => ({ value: c.clientId, label: c.clientName })),
        ]}
      />
    ) : (
      <p className="text-sm text-muted">No clients with this service yet.</p>
    )
  ) : null;
  return { picked, picker };
}

function useCategories() {
  const categories = useApiQuery(['documents', 'categories'], () => api.documents.categories());
  const active = (categories.data ?? []).filter((c) => !c.archivedAt);
  const none = categories.isSuccess && active.length === 0;
  return { categories, active, none };
}

function NoTypes() {
  return (
    <p className="text-xs text-muted">
      The firm has no document types yet, so this is saved without one.{' '}
      <Link href="/documents/settings?tab=general" className="font-medium text-action underline">
        Add document types
      </Link>
    </p>
  );
}

function RequestDocumentsDialog({
  target,
  choices,
  onClose,
  onDone,
}: {
  target?: ServiceDocumentTarget;
  choices?: readonly ServiceDocumentTarget[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const qc = useQueryClient();
  const { picked, picker } = useTarget(target, choices);
  const { active, none } = useCategories();
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [instructions, setInstructions] = useState(target?.period ? `For ${target.period}.` : '');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  useUnsavedChanges(title.trim() !== '');
  const send = async () => {
    if (!picked || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await api.documents.createRequest(picked.clientId, {
        serviceId: picked.engagementId,
        title: title.trim(),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(due ? { dueOn: due } : {}),
      });
      await qc.invalidateQueries();
      onDone(`Requested "${title.trim()}" from ${picked.clientName}.`);
    } catch (e) {
      setError(docError(e));
    } finally {
      setSending(false);
    }
  };
  return (
    <Modal
      open
      title="Request Documents"
      subtitle="The client sees the request in their portal and uploads the file there."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!picked || !title.trim() || sending} onClick={() => void send()}>
            {sending ? 'Sending…' : 'Send Request'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="request-documents">
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {picker}
        {picked ? (
          <Summary
            target={picked}
            extra={
              <>
                <dt className="font-semibold text-heading">Recipient</dt>
                <dd className="text-text">{picked.clientName}&apos;s portal login</dd>
                <dt className="font-semibold text-heading">Channel</dt>
                <dd className="text-text">
                  Client portal, with an email that a request is waiting
                </dd>
              </>
            }
          />
        ) : null}
        <Input
          label="Document needed"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Select
          label="Type"
          disabled={none}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          options={[
            { value: '', label: 'Not set' },
            ...active.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        {none ? <NoTypes /> : null}
        <Textarea
          label="Instructions for the client"
          rows={3}
          maxLength={1000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <Input label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
    </Modal>
  );
}

function UploadDocumentDialog({
  target,
  choices,
  onClose,
  onDone,
}: {
  target?: ServiceDocumentTarget;
  choices?: readonly ServiceDocumentTarget[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const qc = useQueryClient();
  const { picked, picker } = useTarget(target, choices);
  const { active, none } = useCategories();
  const [categoryId, setCategoryId] = useState('');
  const [taxYear, setTaxYear] = useState(target?.taxYear ? String(target.taxYear) : '');
  const [share, setShare] = useState(false);
  const [file, setFile] = useState<File>();
  const [percent, setPercent] = useState<number>();
  const [error, setError] = useState<string>();
  useUnsavedChanges(file !== undefined);
  const year = Number(taxYear);
  const send = async () => {
    if (!file || !picked) return;
    setError(undefined);
    try {
      await uploadFile(file, {
        start: (facts) =>
          api.documents.createUpload(picked.clientId, {
            serviceId: picked.engagementId,
            shareWithClient: share,
            ...(categoryId ? { categoryId } : {}),
            ...(taxYear && Number.isInteger(year) ? { taxYear: year } : {}),
            ...facts,
          }),
        finish: (uploadToken) => api.documents.confirmUpload({ uploadToken }),
        maxBytes: UPLOAD_LIMITS.maxBytes,
        onProgress: setPercent,
      });
      await qc.invalidateQueries();
      onDone(`Uploaded ${file.name} to ${picked.clientName}'s ${picked.service} documents.`);
    } catch (e) {
      setPercent(undefined);
      setError(docError(e));
    }
  };
  return (
    <Modal
      open
      title="Upload Document"
      subtitle="Kept in the firm's private storage for this client and service."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!file || !picked || percent !== undefined} onClick={() => void send()}>
            {percent === undefined ? 'Upload' : `Uploading ${percent}%`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="upload-document">
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {picker}
        {picked ? <Summary target={picked} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Type"
            disabled={none}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={[
              { value: '', label: 'Not set' },
              ...active.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Input
            label="Tax year"
            inputMode="numeric"
            maxLength={4}
            value={taxYear}
            onChange={(e) => setTaxYear(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        {none ? <NoTypes /> : null}
        <FileDropzone
          label="File"
          onFiles={(files) => setFile(files[0])}
          onReject={() =>
            setError(
              `Use a PDF, JPG, PNG, Excel or Word file up to ${megabytes(UPLOAD_LIMITS.maxBytes)}.`,
            )
          }
          maxBytes={UPLOAD_LIMITS.maxBytes}
          multiple={false}
          hints={[
            file
              ? `Chosen: ${file.name}`
              : `PDF, JPG, PNG, Excel or Word, up to ${megabytes(UPLOAD_LIMITS.maxBytes)}`,
          ]}
        />
        <Checkbox
          label="Share with the client (shows in their portal)"
          checked={share}
          onChange={(e) => setShare(e.target.checked)}
        />
      </div>
    </Modal>
  );
}
