'use client';

import { CreateLeadTaskRequest } from '@firmivra/types';
import { Button, Card, Input, Select, Textarea } from '@firmivra/ui';
import { ArrowLeft, Plus, UserCircle } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { PageState } from '../../../../../components/page-state';
import { useMe } from '../../../../../components/signed-in';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { LEAD_PIPELINE_KEY } from '../../leads/_components/lead-shared';

const PRIORITIES = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

/**
 * Create Task opened from a lead (/tasks/new?leadId=..., Leads R2 2): the lead is chosen and shown,
 * the way back is to that lead, and the task is saved as the lead's. It then shows on the lead's
 * Tasks tab and Overview. A lead has no services, files or portal, so the client-only parts of
 * Create Task (service, files, client visibility) are not here.
 */
export function LeadTaskForm({ leadId }: { leadId: string }) {
  const lead = useApiQuery([...LEAD_PIPELINE_KEY, 'task-lead', leadId], () =>
    api.leadPipeline.profile(leadId),
  );
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="lead-task-create">
      <PageState query={lead} isEmpty={() => false}>
        {(found) => (
          <Form leadId={leadId} leadName={`${found.firstName} ${found.lastName}`.trim()} />
        )}
      </PageState>
    </div>
  );
}

function Form({ leadId, leadName }: { leadId: string; leadName: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { role } = useFirm();
  const { me } = useMe();
  const staff = role === 'STAFF';
  const back = `/leads/${leadId}/tasks`;
  const options = useApiQuery([...LEAD_PIPELINE_KEY, 'options'], () => api.leadPipeline.options());
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [assignee, setAssignee] = useState(me.user.id);
  const [details, setDetails] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation((body: CreateLeadTaskRequest) =>
    api.leadPipeline.createTask(leadId, body),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = CreateLeadTaskRequest.safeParse({
      title,
      dueOn: dueOn || undefined,
      priority,
      details,
      ...(staff ? {} : { assignedUserId: assignee || null }),
    });
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        found[key] ??= key === 'dueOn' ? 'Choose a due date' : issue.message;
      }
      setErrors(found);
      return;
    }
    setErrors({});
    save.mutate(parsed.data, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: LEAD_PIPELINE_KEY });
        router.push(back);
      },
    });
  }

  const staffOptions = [
    { value: '', label: 'Not assigned' },
    ...(options.data?.staff ?? []).map((m) => ({ value: m.userId, label: m.name })),
  ];
  return (
    <>
      <Link href={back} className="flex w-fit items-center gap-2 text-sm font-medium text-link">
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to {leadName}
      </Link>
      <header className="flex min-w-0 items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-navigation text-on-action">
          <Plus aria-hidden weight="bold" className="size-8" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-bold text-heading">Create Task</h1>
          <p className="text-base text-muted">A task for this lead, on its Tasks tab.</p>
        </div>
      </header>
      <Card className="flex max-w-3xl flex-col gap-4">
        <p
          className="flex items-center gap-2 rounded-control bg-canvas px-3 py-2 text-sm text-heading"
          data-testid="lead-task-for"
        >
          <UserCircle aria-hidden weight="fill" className="size-5 text-firm-text" />
          <span>
            Lead: <strong>{leadName}</strong>
          </span>
        </p>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <Input
            label="Task name *"
            maxLength={200}
            value={title}
            error={errors['title']}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Due date *"
              type="date"
              value={dueOn}
              error={errors['dueOn']}
              onChange={(event) => setDueOn(event.target.value)}
            />
            <Select
              label="Priority"
              options={PRIORITIES}
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            />
          </div>
          {staff ? (
            <p className="text-sm text-muted">Assigned to you.</p>
          ) : (
            <Select
              label="Assigned to"
              options={staffOptions}
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            />
          )}
          <Textarea
            label="Details"
            rows={4}
            maxLength={5000}
            value={details}
            error={errors['details']}
            onChange={(event) => setDetails(event.target.value)}
          />
          {save.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(save.error)}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => router.push(back)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Save Task
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
