'use client';
import { type Workspace } from '@firmivra/types';
import { Badge, Button, Card, Select } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
export function WorkspaceScreen({ engagementId }: { engagementId: string }) {
  const query = useApiQuery(['workspace', engagementId], () => api.workspaces.get(engagementId));
  return (
    <PageState query={query}>{(workspace) => <WorkspaceDetail workspace={workspace} />}</PageState>
  );
}
function WorkspaceDetail({ workspace }: { workspace: Workspace }) {
  const id = workspace.engagementId;
  const open = workspace.status === 'PENDING' || workspace.status === 'ACTIVE';
  const [taskCursors, setTaskCursors] = useState<(string | undefined)[]>([undefined]);
  const [reportCursors, setReportCursors] = useState<(string | undefined)[]>([undefined]);
  const [docCursors, setDocCursors] = useState<(string | undefined)[]>([undefined]);
  const tasks = useApiQuery(['workspace-tasks', id, taskCursors.at(-1)], () =>
    api.tasks.list({ engagementId: id, cursor: taskCursors.at(-1) }),
  );
  const reports = useApiQuery(['workspace-reports', id, reportCursors.at(-1)], () =>
    api.workspaces.reports(id, { cursor: reportCursors.at(-1) }),
  );
  const documents = useApiQuery(['workspace-documents', id, docCursors.at(-1)], () =>
    api.documents.list(workspace.client.id, { serviceId: id, cursor: docCursors.at(-1) }),
  );
  const notes = useApiQuery(['workspace-notes', id], () =>
    api.clientNotes.list(workspace.client.id, { engagementId: id }),
  );
  const stage = useApiMutation(
    (value: string) => api.engagements.update(id, { stage: value || null }),
    { invalidate: ['workspace', id] },
  );
  const task = useApiMutation((taskId: string) => api.tasks.update(taskId, { status: 'DONE' }), {
    invalidate: ['workspace-tasks', id],
  });
  const report = useApiMutation(
    ({ reportId, publish }: { reportId: string; publish: boolean }) =>
      publish ? api.workspaces.publishReport(reportId) : api.workspaces.unpublishReport(reportId),
    { invalidate: ['workspace-reports', id] },
  );
  const download = useApiMutation(async (docId: string) => {
    const link = await api.documents.download(docId);
    window.location.assign(link.url);
  });
  const errors = [stage.error, task.error, report.error, download.error].filter(Boolean);
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
      </div>
      {errors.length ? (
        <p role="alert" className="text-sm text-danger">
          {errors.map((error) => errorMessage(error)).join(' ')}
        </p>
      ) : null}
      <Card className="space-y-4" data-testid="workspace-tasks">
        <h2 className="text-xl font-semibold text-heading">Tasks</h2>
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
                    {row.status === 'OPEN' ? (
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
                        report.mutate({ reportId: row.id, publish: row.status === 'DRAFT' })
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
    </div>
  );
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
