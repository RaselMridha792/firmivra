'use client';
import {
  CreateTaskRequest,
  CreateInternalNoteRequest,
  CreateReportRequest,
  REPORT_KINDS,
  type Workspace,
} from '@firmivra/types';
import { Button, Input, Select } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
export function TaskForm({ workspace }: { workspace: Workspace }) {
  const form = useForm<CreateTaskRequest>({
    resolver: zodResolver(CreateTaskRequest),
    defaultValues: {
      clientId: workspace.client.id,
      engagementId: workspace.engagementId,
      title: '',
    },
  });
  const mutation = useApiMutation((body: CreateTaskRequest) => api.tasks.create(body), {
    invalidate: ['workspace-tasks', workspace.engagementId],
  });
  return (
    <form
      className="space-y-3"
      onSubmit={form.handleSubmit((body) =>
        mutation.mutate(body, { onSuccess: () => form.reset() }),
      )}
      data-testid="workspace-task-form"
    >
      <Input
        label="New task"
        error={form.formState.errors.title?.message}
        {...form.register('title')}
      />
      {mutation.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      <Button type="submit" disabled={mutation.isPending}>
        Add task
      </Button>
    </form>
  );
}
export function NoteForm({ workspace }: { workspace: Workspace }) {
  const form = useForm<CreateInternalNoteRequest>({
    resolver: zodResolver(CreateInternalNoteRequest),
    defaultValues: { engagementId: workspace.engagementId, body: '' },
  });
  const mutation = useApiMutation(
    (body: CreateInternalNoteRequest) => api.clientNotes.create(workspace.client.id, body),
    { invalidate: ['workspace-notes', workspace.engagementId] },
  );
  return (
    <form
      className="space-y-3"
      onSubmit={form.handleSubmit((body) =>
        mutation.mutate(body, { onSuccess: () => form.reset() }),
      )}
      data-testid="workspace-note-form"
    >
      <Input
        label="Internal note"
        error={form.formState.errors.body?.message}
        {...form.register('body')}
      />
      {mutation.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      <Button type="submit" disabled={mutation.isPending}>
        Add note
      </Button>
    </form>
  );
}
export function ReportForm({ workspace }: { workspace: Workspace }) {
  const form = useForm<CreateReportRequest>({
    resolver: zodResolver(CreateReportRequest),
    defaultValues: {
      kind: REPORT_KINDS[workspace.kind][0],
      title: '',
      periodLabel: '',
      data: { summary: '', lines: [] },
    },
  });
  const mutation = useApiMutation(
    (body: CreateReportRequest) => api.workspaces.createReport(workspace.engagementId, body),
    { invalidate: ['workspace-reports', workspace.engagementId] },
  );
  return (
    <form
      className="space-y-3"
      onSubmit={form.handleSubmit((body) =>
        mutation.mutate(body, { onSuccess: () => form.reset() }),
      )}
      data-testid="workspace-report-form"
    >
      <Select
        label="Report type"
        options={REPORT_KINDS[workspace.kind].map((value) => ({
          value,
          label: value.charAt(0) + value.slice(1).toLowerCase(),
        }))}
        {...form.register('kind')}
      />
      <Input
        label="Report title"
        error={form.formState.errors.title?.message}
        {...form.register('title')}
      />
      <Input
        label="Period (optional)"
        error={form.formState.errors.periodLabel?.message}
        {...form.register('periodLabel')}
      />
      <Input
        label="Summary (optional)"
        error={form.formState.errors.data?.summary?.message}
        {...form.register('data.summary')}
      />
      {mutation.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      <Button type="submit" disabled={mutation.isPending}>
        Create report
      </Button>
    </form>
  );
}
