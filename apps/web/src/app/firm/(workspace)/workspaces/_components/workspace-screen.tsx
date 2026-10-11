'use client';
import { type Workspace } from '@firmivra/types';
import { Badge, Select } from '@firmivra/ui';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { ActionError } from './workspace-parts';
import { NoteCard, ReportCard } from './workspace-note-report-cards';
import { TaskCard, DocumentCard } from './workspace-task-document-cards';
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
  const open = workspace.status === 'PENDING' || workspace.status === 'ACTIVE';
  const stage = useApiMutation(
    (value: string) => api.engagements.update(id, { stage: value || null }),
    { invalidate: ['workspaces'] },
  );

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
      <TaskCard workspace={workspace} />
      <DocumentCard workspace={workspace} />
      <NoteCard workspace={workspace} />
      <ReportCard workspace={workspace} />
    </div>
  );
}
