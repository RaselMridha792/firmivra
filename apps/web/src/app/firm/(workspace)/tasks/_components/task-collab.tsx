'use client';

import type { TaskComment } from '@firmivra/types';
import { Badge, Button, Checkbox, Modal, Textarea } from '@firmivra/ui';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { TASK_ERRORS } from './task-shared';

/** Q36 errors, on top of the task's own. */
const COLLAB_ERRORS: Record<string, string> = {
  ...TASK_ERRORS,
  NOTHING_TO_ACKNOWLEDGE: 'You have no acknowledgment to give on this task.',
  EDIT_WINDOW_CLOSED: 'A comment can be changed for 15 minutes after it is posted.',
  NOT_AUTHOR: 'Only its author can change this comment.',
  INVALID_MENTION: 'Mention active team members only.',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section className="min-w-0 rounded-xl bg-surface p-4 shadow-md" data-testid={testId}>
      <h2 className="mb-3 font-display text-lg font-bold text-heading">{title}</h2>
      {children}
    </section>
  );
}

/** The key the acknowledgment reads share, so the My Tasks badge refreshes too. */
export const ACK_KEY = ['task-collab', 'acknowledgements'] as const;
/** Kept apart from TASKS_KEY: a task change refetches TASKS_KEY before its own success runs. */
const COLLAB_KEY = ['task-collab'] as const;

/**
 * T-C01: who has to acknowledge this assignment and who has. The signed-in assignee with one to
 * give sees Acknowledge. Hidden when nobody on the task needs to acknowledge.
 */
export function AcknowledgmentCard({ taskId }: { taskId: string }) {
  const query = useApiQuery([...ACK_KEY, taskId], () => api.taskWork.acknowledgements(taskId));
  const [error, setError] = useState<string>();
  const acknowledge = useApiMutation(() => api.taskWork.acknowledge(taskId), {
    invalidate: [...ACK_KEY],
  });
  const data = query.data;
  const required = (data?.items ?? []).filter((i) => i.required);
  if (!data || required.length === 0) return null;
  return (
    <Section title="Acknowledgment" testId="detail-acknowledgment">
      {data.mine === 'PENDING' ? (
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-soft p-3 text-sm text-text"
          data-testid="ack-pending"
        >
          <span>A coworker assigned this task to you. Please acknowledge it.</span>
          <Button
            onClick={() => {
              setError(undefined);
              acknowledge.mutate(undefined, {
                onError: (e) => setError(errorMessage(e, COLLAB_ERRORS)),
              });
            }}
            disabled={acknowledge.isPending}
          >
            {acknowledge.isPending ? 'Acknowledging…' : 'Acknowledge'}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mb-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {required.map((r) => (
          <li
            key={r.assignee.userId}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span className="font-medium text-text">{r.assignee.name}</span>
            {r.acknowledgedAt ? (
              <Badge tone="success">Acknowledged {when(r.acknowledgedAt)}</Badge>
            ) : (
              <Badge tone="warning">
                Awaiting acknowledgment{r.reminderSentAt ? ' (reminder sent)' : ''}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** The My Tasks badge: the task still waits for the signed-in member's acknowledgment. */
export function usePendingAcknowledgements(): Set<string> {
  const query = useApiQuery([...ACK_KEY, 'pending'], () => api.taskWork.pendingAcknowledgements());
  return new Set((query.data?.items ?? []).map((i) => i.taskId));
}

function CommentItem({ taskId, c }: { taskId: string; c: TaskComment }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string>();
  const key = [...COLLAB_KEY, 'comments', taskId];
  const save = useApiMutation(() => api.taskWork.editComment(taskId, c.id, { body: draft }), {
    invalidate: key,
  });
  const remove = useApiMutation(() => api.taskWork.deleteComment(taskId, c.id), {
    invalidate: key,
  });
  const onError = (e: unknown) => setError(errorMessage(e, COLLAB_ERRORS));
  return (
    <li className="rounded-lg border border-border p-3" data-testid="task-comment">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-text">{c.author?.name ?? 'Former member'}</span>
        <span className="text-xs text-muted">
          {when(c.createdAt)}
          {c.edited ? ' (edited)' : ''}
        </span>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            label="Edit comment"
            value={draft}
            maxLength={4000}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={save.isPending || draft.trim() === ''}
              onClick={() => {
                setError(undefined);
                save.mutate(undefined, { onSuccess: () => setEditing(false), onError });
              }}
            >
              Save
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setDraft(c.body);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-line break-words text-sm text-text">{c.body}</p>
      )}
      {!editing && (c.canEdit || c.canDelete) ? (
        <div className="mt-2 flex gap-3 text-sm">
          {c.canEdit ? (
            <button
              type="button"
              className="font-medium text-link hover:underline"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          ) : null}
          {c.canDelete ? (
            <button
              type="button"
              className="font-medium text-danger hover:underline"
              onClick={() => setConfirm(true)}
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {confirm ? (
        <Modal
          open
          title="Delete this comment?"
          subtitle="It is removed from the discussion. The audit log keeps that it was deleted."
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(undefined, {
                    onSuccess: () => setConfirm(false),
                    onError: (e) => {
                      setConfirm(false);
                      onError(e);
                    },
                  })
                }
              >
                Delete
              </Button>
            </>
          }
        >
          <span />
        </Modal>
      ) : null}
    </li>
  );
}

/**
 * T-C02: the task's internal discussion. Staff only, never shown to the client. The task's
 * assignees and anyone mentioned get a notification.
 */
export function DiscussionCard({ taskId, meId }: { taskId: string; meId: string | null }) {
  const key = [...COLLAB_KEY, 'comments', taskId];
  const query = useApiQuery(key, () => api.taskWork.comments(taskId));
  const team = useApiQuery([...COLLAB_KEY, 'members'], () => api.team.list());
  const members = (team.data ?? [])
    .filter((m) => m.status === 'ACTIVE')
    .map((m) => ({ userId: m.user.id, name: m.user.name }));
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [error, setError] = useState<string>();
  const post = useApiMutation(
    () =>
      api.taskWork.addComment(taskId, {
        body,
        ...(mentions.length ? { mentionUserIds: mentions } : {}),
      }),
    { invalidate: key },
  );
  const others = members.filter((m) => m.userId !== meId);
  const items = query.data?.items ?? [];
  return (
    <Section title="Discussion (Not Visible to Clients)" testId="detail-discussion">
      {query.isLoading ? (
        <p className="text-sm text-muted">Loading comments…</p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger">
          The comments could not be loaded. Reload the page to try again.
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">No comments yet.</p>
      ) : (
        <ul className="mb-4 flex flex-col gap-2">
          {items.map((c) => (
            <CommentItem key={c.id} taskId={taskId} c={c} />
          ))}
        </ul>
      )}
      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(undefined);
          post.mutate(undefined, {
            onSuccess: () => {
              setBody('');
              setMentions([]);
              setShowMentions(false);
            },
            onError: (err) => setError(errorMessage(err, COLLAB_ERRORS)),
          });
        }}
      >
        <Textarea
          label="Add a comment"
          hint="Only your team sees this. The task's assignees are notified."
          value={body}
          maxLength={4000}
          rows={3}
          onChange={(e) => setBody(e.target.value)}
        />
        <div>
          <button
            type="button"
            className="text-sm font-medium text-link hover:underline"
            aria-expanded={showMentions}
            onClick={() => setShowMentions((v) => !v)}
          >
            {mentions.length ? `Mention (${mentions.length})` : 'Mention a teammate'}
          </button>
          {showMentions ? (
            <fieldset
              className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border px-3"
              data-testid="mention-list"
            >
              <legend className="sr-only">Teammates to notify</legend>
              {others.map((m) => (
                <Checkbox
                  key={m.userId}
                  label={m.name}
                  checked={mentions.includes(m.userId)}
                  onChange={(e) =>
                    setMentions((list) =>
                      e.target.checked ? [...list, m.userId] : list.filter((id) => id !== m.userId),
                    )
                  }
                />
              ))}
            </fieldset>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" disabled={post.isPending || body.trim() === ''}>
            {post.isPending ? 'Posting…' : 'Post Comment'}
          </Button>
        </div>
      </form>
    </Section>
  );
}
