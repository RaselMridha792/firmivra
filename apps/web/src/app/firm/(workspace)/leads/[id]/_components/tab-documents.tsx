'use client';

import { Badge } from '@firmivra/ui';
import { FileText, FolderOpen } from '@phosphor-icons/react';
import Link from 'next/link';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
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

/** Documents & Forms tab: what the lead uploaded in Begin Online, and the forms sent to them. */
export function DocumentsTab() {
  const { id } = useProfile();
  const query = useApiQuery(wsKey(id, 'documents'), () => api.leadPipeline.documentsAndForms(id));
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
          <Link href="/modules/document-upload" className="text-sm font-medium text-link underline">
            Upload Document
          </Link>
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
                    <span className="text-xs text-muted">Uploaded {dayText(d.uploadedAt)}</span>
                  </span>
                </span>
                <Badge tone={scanTone(d.scanStatus)}>{words(d.scanStatus)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardFrame>
      <CardFrame
        icon={FileText}
        title="Forms"
        testId="card-forms"
        action={
          <Link href="/intake-forms/send" className="text-sm font-medium text-link underline">
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
              <Link href="/intake-forms/send" className={`${outlineButton} mt-2`}>
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
