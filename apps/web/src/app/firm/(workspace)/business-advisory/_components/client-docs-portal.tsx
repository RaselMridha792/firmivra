'use client';

import {
  DOCUMENT_ERRORS,
  megabytes,
  UPLOAD_LIMITS,
  type FirmDocument,
  type FirmDocumentList,
  type FirmDocumentRequest,
} from '@firmivra/types';
import {
  Badge,
  Button,
  Checkbox,
  FileDropzone,
  Input,
  Modal,
  Select,
  Table,
  Textarea,
  type Column,
} from '@firmivra/ui';
import {
  ArrowRight,
  BookOpen,
  DownloadSimple,
  EyeSlash,
  FileArrowUp,
  FilePlus,
  FileText,
  Lightbulb,
  ListChecks,
  Paperclip,
  SealCheck,
  UserCircle,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { uploadFile } from '../../../../../lib/upload';
import { ErrorLine } from './ba-dialogs';
import { FilterSelect, SearchBox, useAct } from './ba-list-kit';
import {
  ActionStatusPill,
  BASE,
  BA_KEY,
  RecStatusPill,
  SectionHead,
  card,
  dayText,
  money,
  noneWhenMissing,
  outlined,
  primary,
  quiet,
} from './ba-shared';
import { ClientShell, useAdvisoryClient } from './client-shell';

const NO_DOCS: FirmDocumentList = { items: [], nextCursor: null, years: [] };
const DIRECTION: Record<FirmDocument['direction'], [string, 'info' | 'success' | 'neutral']> = {
  CLIENT_TO_FIRM: ['From client', 'info'],
  FIRM_TO_CLIENT: ['Shared with client', 'success'],
  INTERNAL: ['Internal', 'neutral'],
};
const SCAN: Record<FirmDocument['scanStatus'], [string, 'success' | 'warning' | 'danger']> = {
  CLEAN: ['Ready', 'success'],
  PENDING: ['Checking', 'warning'],
  INFECTED: ['Blocked', 'danger'],
  FAILED: ['Failed', 'danger'],
};
const REQUEST: Record<
  FirmDocumentRequest['status'],
  [string, 'info' | 'success' | 'warning' | 'danger' | 'neutral']
> = {
  REQUESTED: ['Requested', 'info'],
  SUBMITTED: ['Received', 'warning'],
  ACCEPTED: ['Accepted', 'success'],
  REJECTED: ['Asked again', 'danger'],
  NOT_AVAILABLE: ['Not available', 'neutral'],
  CANCELLED: ['Cancelled', 'neutral'],
};
const docError = (e: unknown) => errorMessage(e, DOCUMENT_ERRORS);

async function download(id: string) {
  const link = await api.documents.download(id);
  window.location.assign(link.url);
}

// ---------- Documents ----------

/**
 * /business-advisory/clients/[clientId]/documents: the client's files on their advisory services
 * (guide §6, §11), in the firm's private storage; upload (shared with the client or internal) and
 * request documents. Files live in the Documents module: reclassify and archive are done there.
 */
export function ClientDocumentsTab({ advisoryClientId }: { advisoryClientId: string }) {
  const client = useAdvisoryClient(advisoryClientId);
  const c = client.data;
  const firmClientId = c?.client.id;
  const services = c?.workstreams ?? [];
  const advisory = new Set(services.map((w) => w.serviceId));
  const { act, toast, say } = useAct();
  const [serviceId, setServiceId] = useState('');
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const [dialog, setDialog] = useState<'upload' | 'request'>();
  const term = useDeferredValue(search.trim());
  const cursor = cursors.at(-1);
  const docs = useApiQuery(
    [...BA_KEY, 'client-documents', firmClientId, serviceId, term, cursor],
    () =>
      firmClientId
        ? api.documents
            .list(firmClientId, {
              ...(serviceId ? { serviceId } : {}),
              ...(term ? { search: term } : {}),
              ...(cursor ? { cursor } : {}),
              limit: 25,
            })
            .catch(noneWhenMissing(NO_DOCS))
        : Promise.resolve(null),
  );
  const requests = useApiQuery([...BA_KEY, 'client-doc-requests', firmClientId], () =>
    firmClientId
      ? api.documents.requests(firmClientId).catch(noneWhenMissing([] as FirmDocumentRequest[]))
      : Promise.resolve(null),
  );
  const rows = (docs.data?.items ?? []).filter((d) => advisory.has(d.service.id));
  const openRequests = (requests.data ?? []).filter((r) => advisory.has(r.service.id));
  const failed = client.isError || docs.isError;
  const reset = (set: (v: string) => void) => (v: string) => {
    set(v);
    setCursors([]);
  };

  const cols: Column<FirmDocument>[] = [
    {
      id: 'name',
      label: 'Document Name',
      cell: (d) => (
        <span className="flex min-w-0 items-center gap-2 font-medium text-heading">
          <FileText aria-hidden weight="fill" className="size-4 shrink-0 text-action" />{' '}
          {d.fileName}
        </span>
      ),
    },
    { id: 'type', label: 'Type', cell: (d) => d.category?.name ?? '—' },
    { id: 'service', label: 'Service', cell: (d) => d.service.title },
    {
      id: 'shared',
      label: 'Shared',
      className: 'whitespace-nowrap',
      cell: (d) => <Badge tone={DIRECTION[d.direction][1]}>{DIRECTION[d.direction][0]}</Badge>,
    },
    {
      id: 'added',
      label: 'Date Added',
      className: 'whitespace-nowrap',
      cell: (d) => dayText(d.createdAt),
    },
    {
      id: 'scan',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (d) => <Badge tone={SCAN[d.scanStatus][1]}>{SCAN[d.scanStatus][0]}</Badge>,
    },
  ];
  const requestCols: Column<FirmDocumentRequest>[] = [
    {
      id: 'title',
      label: 'Requested Document',
      cell: (r) => <span className="font-medium text-heading">{r.title}</span>,
    },
    { id: 'service', label: 'Service', cell: (r) => r.service.title },
    { id: 'due', label: 'Due', className: 'whitespace-nowrap', cell: (r) => dayText(r.dueOn) },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (r) => <Badge tone={REQUEST[r.status][1]}>{REQUEST[r.status][0]}</Badge>,
    },
  ];

  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      {toast}
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Advisory documents"
        data-testid="tab-documents"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHead
            icon={Paperclip}
            title="Advisory Documents"
            subtitle="Business plans, financials, funding, formation, branding, banking and licenses: the files on this client's advisory services."
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={outlined}
              disabled={!c || !services.length}
              onClick={() => setDialog('request')}
            >
              <FilePlus aria-hidden weight="fill" className="size-4 text-action" /> Request Document
            </button>
            <button
              type="button"
              className={primary}
              disabled={!c || !services.length}
              onClick={() => setDialog('upload')}
            >
              <FileArrowUp aria-hidden weight="fill" className="size-4" /> Upload Document
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox value={search} onChange={reset(setSearch)} label="Search documents" />
          <FilterSelect
            label="Service"
            all="All Advisory Services"
            value={serviceId}
            onChange={reset(setServiceId)}
            options={services.map((w) => ({ value: w.serviceId, label: w.serviceName }))}
            width="w-60"
          />
        </div>
        <Table
          rows={rows}
          columns={cols}
          rowKey={(d) => d.id}
          caption="Advisory documents"
          dense
          noun="documents"
          pageSize={25}
          loading={Boolean(firmClientId) && docs.isPending}
          emptyTitle={failed ? 'Documents are not available' : 'No advisory documents'}
          emptyText={
            failed
              ? 'We could not load them. Try again in a moment.'
              : 'Upload one, or request one from the client.'
          }
          rowActions={(d) =>
            d.scanStatus === 'CLEAN' ? (
              <Button
                variant="secondary"
                aria-label={`Download ${d.fileName}`}
                onClick={() => void act(() => download(d.id), `Downloading ${d.fileName}.`)}
              >
                <DownloadSimple aria-hidden weight="bold" className="size-4" />
              </Button>
            ) : null
          }
          server={{
            page: cursors.length + 1,
            hasNext: Boolean(docs.data?.nextCursor),
            hasPrevious: cursors.length > 0,
            onNext: () => {
              const next = docs.data?.nextCursor;
              if (next) setCursors((cs) => [...cs, next]);
            },
            onPrevious: () => setCursors((cs) => cs.slice(0, -1)),
            onSort: () => undefined,
          }}
        />
        {firmClientId ? (
          <Link
            href={`/clients/${firmClientId}/documents`}
            className="inline-flex items-center gap-1 self-start text-sm font-medium text-link hover:underline"
          >
            Reclassify or archive files in the client&apos;s Documents{' '}
            <ArrowRight aria-hidden weight="bold" className="size-4" />
          </Link>
        ) : null}
      </section>
      <section className={card} aria-label="Document requests" data-testid="tab-doc-requests">
        <SectionHead
          icon={ListChecks}
          title="Document Requests"
          subtitle="What the firm asked the client for on these services."
        />
        <Table
          rows={openRequests}
          columns={requestCols}
          rowKey={(r) => r.id}
          caption="Document requests"
          dense
          noun="requests"
          pageSize={20}
          showPagination={false}
          loading={Boolean(firmClientId) && requests.isPending}
          emptyTitle={
            client.isError || requests.isError
              ? 'Requests are not available'
              : 'No document requests'
          }
          emptyText={
            client.isError || requests.isError
              ? 'We could not load them.'
              : 'Request a document from the client.'
          }
          rowActions={(r) =>
            r.status === 'REQUESTED' ? (
              <Button
                variant="secondary"
                onClick={() =>
                  void act(() => api.documents.cancelRequest(r.id), `Request cancelled: ${r.title}`)
                }
              >
                Cancel
              </Button>
            ) : null
          }
        />
      </section>
      {dialog === 'upload' && c && firmClientId ? (
        <UploadDocumentDialog
          firmClientId={firmClientId}
          services={services}
          onClose={() => setDialog(undefined)}
          onDone={(name) => {
            setDialog(undefined);
            say(`${name} uploaded.`);
          }}
        />
      ) : null}
      {dialog === 'request' && c && firmClientId ? (
        <RequestDocumentDialog
          firmClientId={firmClientId}
          services={services}
          onClose={() => setDialog(undefined)}
          onDone={(title) => {
            setDialog(undefined);
            say(`Requested: ${title}`);
          }}
        />
      ) : null}
    </ClientShell>
  );
}

type Workstreams = { serviceId: string; serviceName: string }[];

function UploadDocumentDialog({
  firmClientId,
  services,
  onClose,
  onDone,
}: {
  firmClientId: string;
  services: Workstreams;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const qc = useQueryClient();
  const categories = useApiQuery([...BA_KEY, 'doc-categories'], () => api.documents.categories());
  const [serviceId, setServiceId] = useState(services[0]?.serviceId ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [share, setShare] = useState(false);
  const [file, setFile] = useState<File>();
  const [percent, setPercent] = useState<number>();
  const [error, setError] = useState<string>();
  const send = async () => {
    if (!file) return;
    setError(undefined);
    try {
      await uploadFile(file, {
        start: (facts) =>
          api.documents.createUpload(firmClientId, {
            serviceId,
            shareWithClient: share,
            ...(categoryId ? { categoryId } : {}),
            ...facts,
          }),
        finish: (uploadToken) => api.documents.confirmUpload({ uploadToken }),
        maxBytes: UPLOAD_LIMITS.maxBytes,
        onProgress: setPercent,
      });
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
      onDone(file.name);
    } catch (e) {
      setPercent(undefined);
      setError(docError(e));
    }
  };
  return (
    <Modal
      open
      title="Upload Document"
      subtitle="Kept in the firm's private storage for this client."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!file || !serviceId || percent !== undefined}
            onClick={() => void send()}
          >
            {percent === undefined ? 'Upload' : `Uploading ${percent}%`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="upload-document">
        <ErrorLine text={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Service"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            options={services.map((w) => ({ value: w.serviceId, label: w.serviceName }))}
          />
          <Select
            label="Type"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={[
              { value: '', label: 'Not set' },
              ...(categories.data ?? [])
                .filter((x) => !x.archivedAt)
                .map((x) => ({ value: x.id, label: x.name })),
            ]}
          />
        </div>
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

function RequestDocumentDialog({
  firmClientId,
  services,
  onClose,
  onDone,
}: {
  firmClientId: string;
  services: Workstreams;
  onClose: () => void;
  onDone: (title: string) => void;
}) {
  const qc = useQueryClient();
  const [serviceId, setServiceId] = useState(services[0]?.serviceId ?? '');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const send = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await api.documents.createRequest(firmClientId, {
        serviceId,
        title: title.trim(),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        ...(due ? { dueOn: due } : {}),
      });
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
      onDone(title.trim());
    } catch (e) {
      setError(docError(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      title="Request Document"
      subtitle="The client sees the request in their portal and uploads the file there."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!serviceId || !title.trim() || saving} onClick={() => void send()}>
            Send Request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="request-document">
        <ErrorLine text={error} />
        <Select
          label="Service"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          options={services.map((w) => ({ value: w.serviceId, label: w.serviceName }))}
        />
        <Input
          label="Document needed"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
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

// ---------- Client Portal ----------

/**
 * /business-advisory/clients/[clientId]/portal: what the client sees in their portal (guide §6
 * "Client-facing plan/resources/tasks where enabled"): their access, the plans delivered, the
 * recommendations and tasks marked for them, the resources sent and the files shared.
 */
export function ClientPortalTab({ advisoryClientId }: { advisoryClientId: string }) {
  const client = useAdvisoryClient(advisoryClientId);
  const c = client.data;
  const firmClientId = c?.client.id;
  const advisory = new Set((c?.workstreams ?? []).map((w) => w.serviceId));
  const { act, toast } = useAct();
  const record = useApiQuery([...BA_KEY, 'client-record', firmClientId], () =>
    firmClientId
      ? api.clients.get(firmClientId).catch(noneWhenMissing(null))
      : Promise.resolve(null),
  );
  const plans = useApiQuery([...BA_KEY, 'client-plans', advisoryClientId], () =>
    api.advisory.plans({ advisoryClientId, includeArchived: true, pageSize: 50 }),
  );
  const recs = useApiQuery([...BA_KEY, 'client-visible-recs', advisoryClientId], () =>
    api.advisory.recommendations({ advisoryClientId, clientVisible: true, pageSize: 50 }),
  );
  const tasks = useApiQuery([...BA_KEY, 'client-tasks-all', advisoryClientId], () =>
    api.advisory.actionItems({ advisoryClientId, pageSize: 100 }),
  );
  const activity = useApiQuery([...BA_KEY, 'client-activity', advisoryClientId, 'portal'], () =>
    api.advisory.activity(advisoryClientId, { pageSize: 100 }),
  );
  const docs = useApiQuery([...BA_KEY, 'client-documents', firmClientId, 'shared'], () =>
    firmClientId
      ? api.documents
          .list(firmClientId, { direction: 'FIRM_TO_CLIENT', limit: 50 })
          .catch(noneWhenMissing(NO_DOCS))
      : Promise.resolve(null),
  );
  const failed = client.isError;
  const sent = (plans.data?.items ?? []).filter((p) => p.sentAt);
  const visibleTasks = (tasks.data?.items ?? []).filter((t) => t.clientVisible);
  const resources = (activity.data?.items ?? []).filter((a) => a.action.includes('resource'));
  const shared = (docs.data?.items ?? []).filter((d) => advisory.has(d.service.id));
  const logins = record.data?.portalLogins ?? [];
  const quietLine = (isError: boolean, pending: boolean, none: string) => (
    <p className={quiet}>
      {failed || isError ? 'Not available right now.' : pending ? 'Loading…' : none}
    </p>
  );
  const hide = (label: string, work: () => Promise<unknown>) => (
    <Button
      variant="secondary"
      aria-label={`Hide ${label} from the client`}
      onClick={() => void act(work, `${label} hidden from the client.`)}
    >
      <EyeSlash aria-hidden weight="fill" className="size-4" />
    </Button>
  );

  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      {toast}
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
        <section className={card} aria-label="Portal access" data-testid="portal-access">
          <SectionHead
            icon={UserCircle}
            title="Portal Access"
            subtitle="Who can sign in to the client portal for this client."
          />
          {logins.length ? (
            <ul className="divide-y divide-divider">
              {logins.map((l) => (
                <li
                  key={l.clientAccountId}
                  className="flex flex-wrap items-center gap-2 py-2 text-sm"
                >
                  <span className="min-w-40 flex-1 text-heading">{l.email}</span>
                  <Badge tone="neutral">{l.portalRole.replace('_', ' ').toLowerCase()}</Badge>
                  <Badge
                    tone={
                      l.status === 'ACTIVE'
                        ? 'success'
                        : l.status === 'INVITED' || l.status === 'PENDING_APPROVAL'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {l.status.replace('_', ' ').toLowerCase()}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className={quiet}>
              {failed || record.isError ? (
                'Not available right now.'
              ) : record.isPending && firmClientId ? (
                'Loading…'
              ) : (
                <>
                  No portal login yet.{' '}
                  <Link
                    href={`/clients/${firmClientId}`}
                    className="font-medium text-link hover:underline"
                  >
                    Invite from the client&apos;s record
                  </Link>
                </>
              )}
            </p>
          )}
        </section>
        <section className={card} aria-label="Plans delivered" data-testid="portal-plans">
          <SectionHead
            icon={SealCheck}
            title="Plans Delivered"
            subtitle="Finalized versions sent to the client; later edits never change them."
          />
          {sent.length ? (
            <ul className="divide-y divide-divider">
              {sent.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <Link
                    href={`${BASE}/plans/${p.id}/edit/review`}
                    className="min-w-40 flex-1 font-semibold text-link hover:underline"
                  >
                    {p.name}
                  </Link>
                  <span className="text-muted">Version {p.currentVersion}</span>
                  <span className="text-muted">sent {dayText(p.sentAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            quietLine(plans.isError, plans.isPending, 'No plan has been sent yet.')
          )}
        </section>
      </div>
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
        <section
          className={card}
          aria-label="Recommendations the client sees"
          data-testid="portal-recommendations"
        >
          <SectionHead
            icon={Lightbulb}
            title="Recommendations Shown"
            subtitle="Marked for the client portal."
          />
          {recs.data?.items.length ? (
            <ul className="divide-y divide-divider">
              {recs.data.items.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-40 flex-1 font-medium text-heading">{r.title}</span>
                  <span className="text-xs text-muted">
                    {r.impactLabel ?? (r.impactCents === null ? '' : money(r.impactCents))}
                  </span>
                  <RecStatusPill status={r.status} />
                  {hide(r.title, () =>
                    api.advisory.updateRecommendation(r.id, { clientVisible: false }),
                  )}
                </li>
              ))}
            </ul>
          ) : (
            quietLine(recs.isError, recs.isPending, 'No recommendation is shown to the client.')
          )}
        </section>
        <section className={card} aria-label="Tasks the client sees" data-testid="portal-tasks">
          <SectionHead
            icon={ListChecks}
            title="Tasks Shown"
            subtitle="Action items marked for the client portal."
          />
          {visibleTasks.length ? (
            <ul className="divide-y divide-divider">
              {visibleTasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-40 flex-1 font-medium text-heading">{t.title}</span>
                  <span className="text-xs text-muted">
                    {t.dueOn ? `due ${dayText(t.dueOn)}` : ''}
                  </span>
                  <ActionStatusPill status={t.status} />
                  {hide(t.title, () =>
                    api.advisory.updateActionItem(t.id, { clientVisible: false }),
                  )}
                </li>
              ))}
            </ul>
          ) : (
            quietLine(tasks.isError, tasks.isPending, 'No task is shown to the client.')
          )}
        </section>
      </div>
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
        <section className={card} aria-label="Resources sent" data-testid="portal-resources">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <SectionHead
              icon={BookOpen}
              title="Resources Sent"
              subtitle="Checklists, guides and templates sent to the client."
            />
            <Link
              href={`${BASE}/resources`}
              className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline"
            >
              Send a resource <ArrowRight aria-hidden weight="bold" className="size-4" />
            </Link>
          </div>
          {resources.length ? (
            <ul className="divide-y divide-divider">
              {resources.map((a) => (
                <li key={a.id} className="grid grid-cols-[1fr_auto] gap-2 py-2 text-sm">
                  <span className="text-heading">{a.message}</span>
                  <span className="text-muted">{dayText(a.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            quietLine(activity.isError, activity.isPending, 'No resource has been sent yet.')
          )}
        </section>
        <section className={card} aria-label="Files shared" data-testid="portal-files">
          <SectionHead
            icon={Paperclip}
            title="Files Shared"
            subtitle="Advisory files the firm shared to the client's portal."
          />
          {shared.length ? (
            <ul className="divide-y divide-divider">
              {shared.map((d) => (
                <li key={d.id} className="grid grid-cols-[1fr_auto] gap-2 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2 truncate text-heading">
                    <FileText aria-hidden weight="fill" className="size-4 shrink-0 text-action" />{' '}
                    {d.fileName}
                  </span>
                  <span className="text-muted">{dayText(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            quietLine(
              docs.isError,
              docs.isPending && Boolean(firmClientId),
              'No advisory file is shared with the client.',
            )
          )}
        </section>
      </div>
    </ClientShell>
  );
}
