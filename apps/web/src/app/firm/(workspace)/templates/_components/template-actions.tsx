'use client';

import type { MessageTemplateRow } from '@firmivra/types';
import { ActionMenu, type ActionMenuItem, Button, Checkbox, Modal } from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  Copy,
  DotsThreeVertical,
  Eye,
  PencilSimple,
  ShareNetwork,
  Star,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { ApiRequestError } from '@firmivra/types';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { PreviewDialog } from './template-dialogs';
import { TEMPLATES_KEY, TEMPLATE_ERRORS, quiet } from './templates-shared';

type Dialog = 'preview' | 'share' | 'archive';

/** The three-dot menu of one template: Edit, Preview, Duplicate, Share, Favorite, Archive. */
export function TemplateMenu({
  row,
  onNotice,
}: {
  row: Pick<MessageTemplateRow, 'id' | 'name' | 'kind' | 'status' | 'favorite'>;
  onNotice: (text: string, tone: 'success' | 'error') => void;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>();
  const [warn, setWarn] = useState<string>();
  const options = { invalidate: [...TEMPLATES_KEY] };
  const fail = (e: unknown) => onNotice(errorMessage(e, TEMPLATE_ERRORS), 'error');
  const duplicate = useApiMutation(() => api.templates.duplicate(row.id), options);
  const favorite = useApiMutation(
    () => (row.favorite ? api.templates.unfavorite(row.id) : api.templates.favorite(row.id)),
    options,
  );
  const restore = useApiMutation(() => api.templates.restore(row.id), options);
  const archive = useApiMutation(
    (confirm: boolean) =>
      api.templates.archive(row.id, confirm ? { confirmAutomationImpact: true } : {}),
    options,
  );
  const tryArchive = (confirm: boolean) =>
    archive.mutate(confirm, {
      onSuccess: () => {
        setDialog(undefined);
        setWarn(undefined);
        onNotice(`${row.name} archived.`, 'success');
      },
      onError: (e) => {
        if (e instanceof ApiRequestError && e.code === 'AUTOMATION_IN_USE') {
          setWarn(e.message);
          setDialog('archive');
        } else fail(e);
      },
    });
  const item = (
    label: string,
    icon: typeof Eye,
    onSelect: () => void,
    danger?: boolean,
  ): ActionMenuItem => ({
    label,
    icon,
    onSelect,
    ...(danger ? { danger } : {}),
  });
  const items: ActionMenuItem[] = [
    item('Edit', PencilSimple, () => router.push(`/templates/${row.id}/edit`)),
    item('Preview', Eye, () => setDialog('preview')),
    item('Duplicate', Copy, () =>
      duplicate.mutate(undefined, {
        onSuccess: (d) => router.push(`/templates/${d.id}/edit`),
        onError: fail,
      }),
    ),
    item('Share', ShareNetwork, () => setDialog('share')),
    item(row.favorite ? 'Remove Favorite' : 'Add to Favorites', Star, () =>
      favorite.mutate(undefined, { onError: fail }),
    ),
    row.status === 'ARCHIVED'
      ? item('Restore', ArrowCounterClockwise, () =>
          restore.mutate(undefined, {
            onSuccess: () => onNotice(`${row.name} restored as a draft.`, 'success'),
            onError: fail,
          }),
        )
      : item('Archive', Archive, () => tryArchive(false), true),
  ];
  return (
    <>
      <ActionMenu
        label={`Actions for ${row.name}`}
        sections={[{ items }]}
        trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
      />
      {dialog === 'preview' ? (
        <PreviewDialog template={row} onClose={() => setDialog(undefined)} />
      ) : null}
      {dialog === 'share' ? (
        <ShareDialog
          row={row}
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            onNotice('Sharing saved.', 'success');
          }}
        />
      ) : null}
      {dialog === 'archive' ? (
        <Modal
          open
          title="Archive template?"
          subtitle={row.name}
          onClose={() => setDialog(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog(undefined)}>
                Keep
              </Button>
              <Button disabled={archive.isPending} onClick={() => tryArchive(true)}>
                Archive Anyway
              </Button>
            </>
          }
        >
          <p role="alert" className="text-sm text-warning" data-testid="automation-warning">
            {warn} Archiving it can stop those automations from sending.
          </p>
        </Modal>
      ) : null}
    </>
  );
}

function ShareDialog({
  row,
  onClose,
  onDone,
}: {
  row: Pick<MessageTemplateRow, 'id' | 'name'>;
  onClose: () => void;
  onDone: () => void;
}) {
  const detail = useApiQuery([...TEMPLATES_KEY, 'detail', row.id], () => api.templates.get(row.id));
  const team = useApiQuery([...TEMPLATES_KEY, 'members'], () => api.team.list());
  const [picked, setPicked] = useState<string[]>();
  const chosen = picked ?? (detail.data?.sharedWith ?? []).map((m) => m.userId);
  const members = (team.data ?? []).filter((m) => m.status === 'ACTIVE');
  const save = useApiMutation(() => api.templates.setShares(row.id, { userIds: chosen }), {
    invalidate: [...TEMPLATES_KEY],
  });
  return (
    <Modal
      open
      title="Share Template"
      subtitle={row.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !detail.data}
            onClick={() => save.mutate(undefined, { onSuccess: onDone })}
          >
            Save Sharing
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2" data-testid="share-dialog">
        {members.length === 0 ? (
          <p className={quiet}>{team.isPending ? 'Loading…' : 'No team members to share with.'}</p>
        ) : (
          members.map((m) => (
            <Checkbox
              key={m.user.id}
              label={m.user.name}
              checked={chosen.includes(m.user.id)}
              onChange={(e) =>
                setPicked(
                  e.target.checked ? [...chosen, m.user.id] : chosen.filter((x) => x !== m.user.id),
                )
              }
            />
          ))
        )}
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, TEMPLATE_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
