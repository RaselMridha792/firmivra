'use client';

import { Badge, Button } from '@firmivra/ui';
import { FileText, FolderOpen } from '@phosphor-icons/react';
import Link from 'next/link';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { CardFrame, EmptyPanel, outlineButton } from './profile-cards';
import { useProfile } from './profile-frame';
import { dayText, wsKey } from './profile-shared';

const words = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replace(/_/g, ' ');
const scanTone = (status: string) =>
  /clean|ok|safe|available/i.test(status)
    ? 'success'
    : /block|infect|fail/i.test(status)
      ? 'danger'
      : 'warning';

/**
 * Documents & Forms tab: the lead's files (its own from Begin Online, and those the firm added,
 * Leads R2 4) and the forms sent to them. Upload Document opens on this lead.
 */
export function DocumentsTab() {
  const { id, profile } = useProfile();
  const query = useApiQuery(wsKey(id, 'documents'), () => api.leadPipeline.documentsAndForms(id));
  const download = useApiMutation(async (fileId: string) => {
    const link = await api.leads.downloadUpload(id, fileId);
    window.open(link.url, '_blank', 'noopener');
  });
  const remove = useApiMutation((fileId: string) => api.leadPipeline.removeFile(id, fileId), {
    invalidate: wsKey(id, 'documents'),
  });
  const converted = profile?.stage === 'CONVERTED';
  const documents = query.data?.documents ?? [];
  const forms = query.data?.forms ?? [];
  const state = query.isPending
    ? 'Loading…'
    : query.isError
      ? 'Documents are not available right now.'
      : null;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <CardFrame
        icon={FolderOpen}
        title="Documents"
        testId="card-documents"
        action={
          converted ? null : (
            <Link
              href={`/documents/upload?leadId=${id}`}
              className="text-sm font-medium text-link underline"
            >
              Upload Document
            </Link>
          )
        }
      >
        {documents.length === 0 ? (
          <EmptyPanel
            icon={FolderOpen}
            title={state ?? 'No documents yet.'}
            {...(state ? {} : { text: 'Files the lead uploads or you add will appear here.' })}
          />
        ) : (
          <ul className="divide-y divide-divider" data-testid="lead-documents">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <span className="flex min-w-0 items-center gap-3">
                  <FileText aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-heading">
                      {d.fileName}
                    </span>
                    <span className="text-xs text-muted">
                      {d.addedBy ? `Added by ${d.addedBy.name}` : 'From the lead'},{' '}
                      {dayText(d.uploadedAt)}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge tone={scanTone(d.scanStatus)}>{words(d.scanStatus)}</Badge>
                  {d.scanStatus === 'CLEAN' ? (
                    <Button
                      variant="ghost"
                      aria-label={`Download ${d.fileName}`}
                      disabled={download.isPending}
                      onClick={() => download.mutate(d.id)}
                    >
                      Download
                    </Button>
                  ) : null}
                  {d.addedBy && !converted ? (
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${d.fileName}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(d.id)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {download.isError || remove.isError ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {errorMessage(download.error ?? remove.error)}
          </p>
        ) : null}
      </CardFrame>
      <CardFrame
        icon={FileText}
        title="Forms"
        testId="card-forms"
        action={
          <Link
            href={`/intake-forms/send?leadId=${id}`}
            className="text-sm font-medium text-link underline"
          >
            Send Intake Form
          </Link>
        }
      >
        {forms.length === 0 ? (
          <EmptyPanel
            icon={FileText}
            title={state ?? 'No forms sent yet.'}
            {...(state
              ? {}
              : { text: 'Send an intake form to collect what you need before the first meeting.' })}
          >
            {state ? null : (
              <Link href={`/intake-forms/send?leadId=${id}`} className={`${outlineButton} mt-2`}>
                Send Intake Form
              </Link>
            )}
          </EmptyPanel>
        ) : (
          <ul className="divide-y divide-divider" data-testid="lead-forms">
            {forms.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-3">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-heading">{f.name}</span>
                  <span className="text-xs text-muted">
                    {f.sentAt ? `Sent ${dayText(f.sentAt)}` : 'Not sent yet'}
                  </span>
                </span>
                <Badge tone="info">{words(f.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardFrame>
    </div>
  );
}
