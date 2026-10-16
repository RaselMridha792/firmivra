'use client';
import { type Workspace } from '@firmivra/types';
import { Badge, Button, Card } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { TaskForm } from './workspace-forms';
import { ActionError, Pages } from './workspace-parts';
export function TaskCard({ workspace }: { workspace: Workspace }) {
  const id = workspace.engagementId;
  const open = workspace.status === 'PENDING' || workspace.status === 'ACTIVE';
  const [taskCursors, setTaskCursors] = useState<(string | undefined)[]>([undefined]);
  const tasks = useApiQuery(['workspaces', id, 'tasks', taskCursors.at(-1)], () =>
    api.tasks.list({ engagementId: id, cursor: taskCursors.at(-1) }),
  );
  const task = useApiMutation((taskId: string) => api.tasks.update(taskId, { status: 'DONE' }), {
    invalidate: ['workspaces'],
  });
  return (
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
  );
}
export function DocumentCard({ workspace }: { workspace: Workspace }) {
  const id = workspace.engagementId;
  const [docCursors, setDocCursors] = useState<(string | undefined)[]>([undefined]);
  const documents = useApiQuery(['workspaces', id, 'documents', docCursors.at(-1)], () =>
    api.documents.list(workspace.client.id, { serviceId: id, cursor: docCursors.at(-1) }),
  );
  const download = useApiMutation(async (docId: string) => {
    const link = await api.documents.download(docId);
    window.location.assign(link.url);
  });
  return (
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
  );
}
