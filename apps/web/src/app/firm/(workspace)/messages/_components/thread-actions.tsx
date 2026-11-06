'use client';

import { type MessageThread, TAG_ERRORS } from '@firmivra/types';
import { ActionMenu, type ActionMenuItem, Button, Modal, Select } from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  BellSimple,
  BellSimpleSlash,
  CalendarPlus,
  CheckSquare,
  DotsThreeVertical,
  Envelope,
  EnvelopeOpen,
  Tag,
  User,
  UserSwitch,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { useOriginNavigate } from '../../../../../components/origin-link';
import { TagPicker } from '../../../../../components/tag-picker';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';

// MSG-F22 (Octavia's Oct 27 Messages review, MSG-035 and MSG-036): the three-dot Thread Actions
// beside the client card. The client's own pages are opened with Back to this conversation (SH1).

const KEY = ['messages'] as const;
const ASSIGN_ERRORS: Record<string, string> = {
  ASSIGNEE_CANNOT_REACH:
    'A Staff member can own only conversations with their own clients. Choose someone else.',
  NOT_FOUND: 'That member is no longer active in your firm.',
};

/** The client's tags, the firm's one list (as Clients and Leads use them). */
export const clientTagsKey = (clientId: string) => [...KEY, 'client-tags', clientId] as const;

export function ThreadActions({
  thread,
  onChanged,
  onNotice,
}: {
  thread: MessageThread;
  onChanged: () => void;
  onNotice: (text: string, tone: 'success' | 'error') => void;
}) {
  const open = useOriginNavigate();
  const [dialog, setDialog] = useState<'assign' | 'tags'>();
  const clientId = thread.client.id;
  const run = (call: () => Promise<unknown>, done: string) =>
    void call()
      .then(() => {
        onChanged();
        onNotice(done, 'success');
      })
      .catch((e: unknown) => onNotice(errorMessage(e), 'error'));
  const item = (label: string, icon: ActionMenuItem['icon'], onSelect: () => void) => ({
    label,
    ...(icon ? { icon } : {}),
    onSelect,
  });
  return (
    <>
      <ActionMenu
        label={`Thread actions for ${thread.client.displayName}`}
        trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
        sections={[
          {
            items: [
              item('View Profile', User, () => open(`/clients/${clientId}`)),
              thread.unreadCount > 0
                ? item('Mark as Read', EnvelopeOpen, () =>
                    run(() => api.messages.markRead(thread.id), 'Marked as read.'),
                  )
                : item('Mark as Unread', Envelope, () =>
                    run(() => api.messages.markUnread(thread.id), 'Marked as unread.'),
                  ),
              item(thread.assignedTo ? 'Reassign Staff' : 'Assign Staff', UserSwitch, () =>
                setDialog('assign'),
              ),
              item('Tags', Tag, () => setDialog('tags')),
            ],
          },
          {
            items: [
              // SH4 and SH6: the client is chosen there, and Back or Cancel returns here.
              item('Create Task', CheckSquare, () => open(`/tasks/new?clientId=${clientId}`)),
              item('Schedule Appointment', CalendarPlus, () =>
                open(`/calendar/new?clientId=${clientId}`),
              ),
            ],
          },
          {
            items: [
              thread.mutedByMe
                ? item('Unmute', BellSimple, () =>
                    run(
                      () => api.messages.unmute(thread.id),
                      'Alerts for this conversation are on.',
                    ),
                  )
                : item('Mute', BellSimpleSlash, () =>
                    run(
                      () => api.messages.mute(thread.id),
                      'Muted: you get no alerts for this conversation. Its messages still arrive.',
                    ),
                  ),
              thread.archivedAt
                ? item('Restore', ArrowCounterClockwise, () =>
                    run(() => api.messages.restore(thread.id), 'Back in the inbox.'),
                  )
                : item('Archive', Archive, () =>
                    run(
                      () => api.messages.archive(thread.id),
                      'Archived. Its messages are kept, under Archived.',
                    ),
                  ),
            ],
          },
        ]}
        className="shrink-0"
      />
      {dialog === 'assign' ? (
        <AssignDialog
          thread={thread}
          onClose={() => setDialog(undefined)}
          onDone={(name) => {
            setDialog(undefined);
            onChanged();
            onNotice(name ? `${name} owns this conversation.` : 'Unassigned.', 'success');
          }}
        />
      ) : null}
      {dialog === 'tags' ? (
        <ClientTagsDialog
          clientId={clientId}
          name={thread.client.displayName}
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            onNotice('Tags saved.', 'success');
          }}
        />
      ) : null}
    </>
  );
}

/** Assign or Reassign Staff: who owns the conversation. The client's own assignee is unchanged. */
function AssignDialog({
  thread,
  onClose,
  onDone,
}: {
  thread: MessageThread;
  onClose: () => void;
  onDone: (name: string | null) => void;
}) {
  const people = useApiQuery([...KEY, 'assignees'], () => api.messages.outbound.assignees());
  const [userId, setUserId] = useState(thread.assignedTo?.userId ?? '');
  const save = useApiMutation(() => api.messages.assign(thread.id, { userId: userId || null }));
  const chosen = (people.data?.items ?? []).find((p) => p.userId === userId);
  return (
    <Modal
      open
      title={thread.assignedTo ? 'Reassign Staff' : 'Assign Staff'}
      subtitle={thread.client.displayName}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || userId === (thread.assignedTo?.userId ?? '')}
            onClick={() =>
              save.mutate(undefined, { onSuccess: () => onDone(chosen?.name ?? null) })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="assign-dialog">
        <Select
          label="Owner of this conversation"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          options={[
            { value: '', label: 'Unassigned' },
            ...(people.data?.items ?? []).map((p) => ({
              value: p.userId,
              label: `${p.name} (${p.role === 'STAFF' ? 'Staff' : p.role === 'OWNER' ? 'Owner' : 'Admin'})`,
            })),
          ]}
        />
        <p className="text-sm text-muted">
          An Owner or Admin can own any conversation; a Staff member only those with their own
          clients. This does not change the client’s assigned staff member.
        </p>
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, ASSIGN_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** The client's tags, from the firm's one list (Clients' own Tags card does the same). */
export function ClientTagsDialog({
  clientId,
  name,
  onClose,
  onDone,
}: {
  clientId: string;
  name: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { role } = useFirm();
  const tags = useApiQuery(clientTagsKey(clientId), () => api.clients.tags(clientId));
  const firmTags = useApiQuery(['tags'], () => api.tags.list());
  const [draft, setDraft] = useState<string[]>();
  const value = draft ?? tags.data?.tags ?? [];
  const save = useApiMutation((names: string[]) => api.clients.setTags(clientId, { tags: names }), {
    invalidate: clientTagsKey(clientId),
  });
  return (
    <Modal
      open
      title="Tags"
      subtitle={name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || tags.isPending || draft === undefined}
            onClick={() =>
              save.mutate(value, {
                onSuccess: () => {
                  // A new tag joins the firm's list.
                  void qc.invalidateQueries({ queryKey: ['tags'] });
                  onDone();
                },
              })
            }
          >
            Save Tags
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="tags-dialog">
        {tags.isError ? (
          <p role="alert" className="text-sm text-danger">
            The tags can’t be loaded right now.
          </p>
        ) : (
          <TagPicker
            label="Client tags"
            value={value}
            onChange={setDraft}
            options={(firmTags.data?.items ?? []).map((t) => t.name)}
            loading={tags.isPending || firmTags.isPending}
            canCreate={role === 'OWNER' || role === 'ADMIN'}
            max={20}
            error={save.error ? errorMessage(save.error, TAG_ERRORS) : undefined}
          />
        )}
        <p className="text-sm text-muted">
          These are the client’s own tags, the same on their profile and in every list. Only an
          Owner or Admin adds a new tag name.
        </p>
      </div>
    </Modal>
  );
}
