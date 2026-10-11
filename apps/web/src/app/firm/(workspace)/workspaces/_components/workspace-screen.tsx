'use client';
import { type Workspace } from '@firmivra/types';
import { Badge, Button, Card, Modal, Select } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { WORKSPACE_ERRORS } from './workspace-errors';
import { NoteForm, ReportForm, TaskForm } from './workspace-forms';
export function WorkspaceScreen({ engagementId }: { engagementId: string }) {
  const query = useApiQuery(['workspaces', engagementId, 'detail'], () =>
    api.workspaces.get(engagementId),
  );
  return (
    <PageState query={query}>{(workspace) => <WorkspaceDetail workspace={workspace} />}</PageState>
  );
}
function WorkspaceDetail({ workspace }: { workspace: Workspace }) {
  const id = workspace.engagementId;
  const [confirmation, setConfirmation] = useState<{ reportId: string; publish: boolean } | null>(
    null,
  );
  const open = workspace.status === 'PENDING' || workspace.status === 'ACTIVE';
  const [taskCursors, setTaskCursors] = useState<(string | undefined)[]>([undefined]);
  const [reportCursors, setReportCursors] = useState<(string | undefined)[]>([undefined]);
  const [docCursors, setDocCursors] = useState<(string | undefined)[]>([undefined]);
  const tasks = useApiQuery(['workspaces', id, 'tasks', taskCursors.at(-1)], () =>
    api.tasks.list({ engagementId: id, cursor: taskCursors.at(-1) }),
  );
  const reports = useApiQuery(['workspaces', id, 'reports', reportCursors.at(-1)], () =>
    api.workspaces.reports(id, { cursor: reportCursors.at(-1) }),
  );
  const documents = useApiQuery(['workspaces', id, 'documents', docCursors.at(-1)], () =>
    api.documents.list(workspace.client.id, { serviceId: id, cursor: docCursors.at(-1) }),
  );
  const notes = useApiQuery(['workspaces', id, 'notes'], () =>
    api.clientNotes.list(workspace.client.id, { engagementId: id }),
  );
  const stage = useApiMutation(
    (value: string) => api.engagements.update(id, { stage: value || null }),
    { invalidate: ['workspaces'] },
  );
  const task = useApiMutation((taskId: string) => api.tasks.update(taskId, { status: 'DONE' }), {
    invalidate: ['workspaces'],
  });
  const report = useApiMutation(
    ({ reportId, publish }: { reportId: string; publish: boolean }) =>
      publish ? api.workspaces.publishReport(reportId) : api.workspaces.unpublishReport(reportId),
    { invalidate: ['workspaces'] },
  );
  const download = useApiMutation(async (docId: string) => {
    const link = await api.documents.download(docId);
    window.location.assign(link.url);
  });

  return (
    <div className="min-w-0 space-y-6" data-testid="workspace-detail">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-heading" data-testid="page-title">
          {workspace.title}
        </h1>
        <p className="text-muted">
          {workspace.client.displayName} · {workspace.serviceName}
        </p>
        <Badge>{workspace.status}</Badge>
        <Select
          label="Stage"
          value={workspace.stage ?? ''}
          disabled={!open || stage.isPending}
          onChange={(e) => stage.mutate(e.target.value)}
          options={[
            { value: '', label: 'No stage' },
            ...workspace.stages.map((value) => ({ value, label: value })),
          ]}
        />
        <ActionError error={stage.error} />
      </div>
      <Card className="space-y-4" data-testid="workspace-tasks">
        <h2 className="text-xl font-semibold text-heading">Tasks</h2>
        <ActionError error={task.error} />
        {open ? <TaskForm workspace={workspace} /> : null}
        <PageState query={tasks} empty="No tasks yet." isEmpty={(data) => !data.items.length}>
          {(data) => (
            <>
              <ul className="space-y-3">
                {data.items.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium wrap-anywhere">{row.title}</p>
                      <p className="text-sm text-muted">
                        {row.status} · Due: {row.dueOn ?? '—'}
                      </p>
                    </div>
                    {open && row.status === 'OPEN' ? (
                      <Button
                        variant="secondary"
                        disabled={task.isPending}
                        onClick={() => task.mutate(row.id)}
                        aria-label={`Complete ${row.title}`}
                      >
                        Complete
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Pages
                cursors={taskCursors}
                next={data.nextCursor}
                set={setTaskCursors}
                label="Task pages"
              />
            </>
          )}
        </PageState>
      </Card>
      <Card className="space-y-4" data-testid="workspace-documents">
        <h2 className="text-xl font-semibold text-heading">Documents</h2>
        <ActionError error={download.error} />
        <PageState
          query={documents}
          empty="No documents for this workspace."
          isEmpty={(data) => !data.items.length}
        >
          {(data) => (
            <>
              <ul className="space-y-3">
                {data.items.map((row) => (
                  <li key={row.id} className="space-y-2 border-b border-border py-3">
                    <p className="font-medium wrap-anywhere">{row.fileName}</p>
                    <Badge>
                      {row.scanStatus === 'CLEAN'
                        ? 'Scan passed'
                        : row.scanStatus === 'PENDING'
                          ? 'Scanning'
                          : 'Blocked'}
                    </Badge>
                    <Button
                      variant="secondary"
                      className="w-full sm:w-auto"
                      disabled={row.scanStatus !== 'CLEAN' || download.isPending}
                      onClick={() => download.mutate(row.id)}
                    >
                      Download
                    </Button>
                  </li>
                ))}
              </ul>
              <Pages
                cursors={docCursors}
                next={data.nextCursor}
                set={setDocCursors}
                label="Document pages"
              />
            </>
          )}
        </PageState>
      </Card>
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
    </div>
  );
}
function ActionError({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="text-sm text-danger">
      {errorMessage(error, WORKSPACE_ERRORS)}
    </p>
  ) : null;
}
function Pages({
  cursors,
  next,
  set,
  label,
}: {
  cursors: (string | undefined)[];
  next: string | null;
  set: React.Dispatch<React.SetStateAction<(string | undefined)[]>>;
  label: string;
}) {
  return (
    <nav aria-label={label} className="grid grid-cols-2 gap-3">
      <Button
        variant="secondary"
        disabled={cursors.length === 1}
        onClick={() => set((v) => v.slice(0, -1))}
      >
        Previous
      </Button>
      <Button
        variant="secondary"
        disabled={!next}
        onClick={() => {
          if (next) set((v) => [...v, next]);
        }}
      >
        Next
      </Button>
    </nav>
  );
}
