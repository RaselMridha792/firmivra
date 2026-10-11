'use client';
import { type Report, type Workspace } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiMutation } from '../../../../../lib/query';
import { ReportForm } from './workspace-forms';
import { ActionError } from './workspace-parts';

export function ReportActions({ report, workspace }: { report: Report; workspace: Workspace }) {
  const [action, setAction] = useState<'edit' | 'delete' | null>(null);
  const open = workspace.status === 'PENDING' || workspace.status === 'ACTIVE';
  const remove = useApiMutation(() => api.workspaces.deleteReport(report.id), {
    invalidate: ['workspaces'],
  });
  const download = useApiMutation(async () => {
    if (report.documentId) {
      const link = await api.documents.download(report.documentId);
      window.location.assign(link.url);
    }
  });
  return (
    <>
      <div className="flex flex-wrap gap-3" data-testid="report-actions">
        {report.documentId ? (
          <Button
            variant="secondary"
            disabled={download.isPending}
            onClick={() => download.mutate(undefined)}
            aria-label={`Download attachment for ${report.title}`}
          >
            Download attachment
          </Button>
        ) : null}
        {report.status === 'DRAFT' && open ? (
          <Button
            variant="secondary"
            onClick={() => setAction('edit')}
            aria-label={`Edit ${report.title}`}
          >
            Edit
          </Button>
        ) : null}
        {report.status === 'DRAFT' && !report.firstPublishedAt ? (
          <Button
            variant="secondary"
            onClick={() => setAction('delete')}
            aria-label={`Delete ${report.title}`}
          >
            Delete
          </Button>
        ) : null}
      </div>
      <ActionError error={download.error} />
      <Modal open={action === 'edit'} title="Edit draft report" onClose={() => setAction(null)}>
        {action === 'edit' ? (
          <ReportForm workspace={workspace} report={report} onSaved={() => setAction(null)} />
        ) : null}
      </Modal>
      <Modal
        open={action === 'delete'}
        title="Delete draft report?"
        onClose={() => setAction(null)}
      >
        <p className="mb-4 text-sm text-muted">
          Delete “{report.title}”? This draft has never been published. This cannot be undone.
        </p>
        <ActionError error={remove.error} />
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setAction(null)}>
            Keep draft
          </Button>
          <Button
            disabled={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => setAction(null) })}
          >
            Confirm delete
          </Button>
        </div>
      </Modal>
    </>
  );
}
