'use client';
import { type Workspace } from '@firmivra/types';
import { Badge, Button, Card, Modal } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { NoteForm, ReportForm } from './workspace-forms';
import { ActionError, Pages } from './workspace-parts';
export function NoteCard({ workspace }: { workspace: Workspace }) {
  const id = workspace.engagementId;
  const notes = useApiQuery(['workspaces', id, 'notes'], () =>
    api.clientNotes.list(workspace.client.id, { engagementId: id }),
  );
  return (
    <Card className="space-y-4" data-testid="workspace-notes">
      <h2 className="text-xl font-semibold text-heading">Internal notes</h2>
      <NoteForm workspace={workspace} />
      <PageState query={notes} empty="No internal notes yet.">
        {(rows) => (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.id} className="space-y-2 border-b border-border py-3">
                <p className="whitespace-pre-wrap wrap-anywhere">{row.body}</p>
                <p className="text-sm text-muted">{row.author.name}</p>
              </li>
            ))}
          </ul>
        )}
      </PageState>
    </Card>
  );
}
export function ReportCard({ workspace }: { workspace: Workspace }) {
  const id = workspace.engagementId;
  const open = workspace.status === 'PENDING' || workspace.status === 'ACTIVE';
  const [confirmation, setConfirmation] = useState<{ reportId: string; publish: boolean } | null>(
    null,
  );
  const [reportCursors, setReportCursors] = useState<(string | undefined)[]>([undefined]);
  const reports = useApiQuery(['workspaces', id, 'reports', reportCursors.at(-1)], () =>
    api.workspaces.reports(id, { cursor: reportCursors.at(-1) }),
  );
  const report = useApiMutation(
    ({ reportId, publish }: { reportId: string; publish: boolean }) =>
      publish ? api.workspaces.publishReport(reportId) : api.workspaces.unpublishReport(reportId),
    { invalidate: ['workspaces'] },
  );
  return (
    <>
      <Card className="space-y-4" data-testid="workspace-reports">
        <h2 className="text-xl font-semibold text-heading">Reports</h2>
        <ActionError error={report.error} />
        {open ? <ReportForm workspace={workspace} /> : null}
        <PageState query={reports} empty="No reports yet." isEmpty={(data) => !data.items.length}>
          {(data) => (
            <>
              <ul className="space-y-4">
                {data.items.map((row) => (
                  <li key={row.id} className="space-y-3 border-b border-border py-3">
                    <p className="font-semibold wrap-anywhere">{row.title}</p>
                    <p className="text-sm text-muted">{row.periodLabel ?? '—'}</p>
                    <Badge>{row.status === 'PUBLISHED' ? 'Published' : 'Draft'}</Badge>
                    {row.data.summary ? (
                      <p className="whitespace-pre-wrap wrap-anywhere">{row.data.summary}</p>
                    ) : null}
                    <p className="whitespace-pre-wrap wrap-anywhere">
                      {row.data.lines
                        .map(
                          (line) =>
                            `${line.label}: ${line.amountCents === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(line.amountCents / 100)} ${line.note ?? ''}`,
                        )
                        .join('\n')}
                    </p>
                    <Button
                      variant="secondary"
                      disabled={report.isPending || (!open && row.status === 'DRAFT')}
                      onClick={() =>
                        setConfirmation({ reportId: row.id, publish: row.status === 'DRAFT' })
                      }
                      aria-label={`${row.status === 'DRAFT' ? 'Publish' : 'Unpublish'} ${row.title}`}
                    >
                      {row.status === 'DRAFT' ? 'Publish' : 'Unpublish'}
                    </Button>
                  </li>
                ))}
              </ul>
              <Pages
                cursors={reportCursors}
                next={data.nextCursor}
                set={setReportCursors}
                label="Report pages"
              />
            </>
          )}
        </PageState>
      </Card>
      <Modal
        open={!!confirmation}
        title={confirmation?.publish ? 'Publish report?' : 'Unpublish report?'}
        onClose={() => setConfirmation(null)}
      >
        <p className="text-sm text-muted">
          {confirmation?.publish
            ? 'This report will be visible to the client.'
            : 'This report will no longer be visible to the client.'}
        </p>
        <ActionError error={report.error} />
        <Button
          disabled={report.isPending}
          onClick={() => {
            if (confirmation)
              report.mutate(confirmation, { onSuccess: () => setConfirmation(null) });
          }}
        >
          Confirm {confirmation?.publish ? 'publish' : 'unpublish'}
        </Button>
      </Modal>
    </>
  );
}
