'use client';

import type { MessageTemplateRow } from '@firmivra/types';
import { ActionMenu, type ActionMenuItem, Button, Checkbox, Modal } from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  CheckCircle,
  Copy,
  DotsThreeVertical,
  Eye,
  PencilSimple,
  ShareNetwork,
  Star,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { ApiRequestError } from '@firmivra/types';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { PreviewDialog } from './template-dialogs';
import { TEMPLATES_KEY, TEMPLATE_ERRORS, dayText, quiet } from './templates-shared';
import { templateUse } from './use-template';

type Dialog = 'preview' | 'share' | 'archive';

/**
 * The three-dot menu of one template: Edit, Preview, Activate (a draft, CM-F12), Duplicate, Share,
 * Favorite, Archive. Activate is an Owner's or Admin's; Staff see who can do it. Archive asks first
 * (TP-F10).
 */
export function TemplateMenu({
  row,
  onNotice,
}: {
  row: Pick<MessageTemplateRow, 'id' | 'name' | 'kind' | 'status' | 'favorite'>;
  onNotice: (text: string, tone: 'success' | 'error') => void;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>();
  const options = { invalidate: [...TEMPLATES_KEY] };
  const fail = (e: unknown) => onNotice(errorMessage(e, TEMPLATE_ERRORS), 'error');
  const duplicate = useApiMutation(() => api.templates.duplicate(row.id), options);
  const favorite = useApiMutation(
    () => (row.favorite ? api.templates.unfavorite(row.id) : api.templates.favorite(row.id)),
    options,
  );
  const restore = useApiMutation(() => api.templates.restore(row.id), options);
  const { role } = useFirm();
  const canActivate = role === 'OWNER' || role === 'ADMIN';
  const activate = useApiMutation(async () => {
    const t = await api.templates.get(row.id);
    return api.templates.update(row.id, { status: 'ACTIVE', etag: t.etag });
  }, options);
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
    ...(row.status === 'DRAFT'
      ? [
          canActivate
            ? item('Activate', CheckCircle, () =>
                activate.mutate(undefined, {
                  onSuccess: () =>
                    onNotice(`${row.name} is active and can be used now.`, 'success'),
                  onError: fail,
                }),
              )
            : {
                ...item('Activate', CheckCircle, () =>
                  onNotice('Ask an Owner or Admin to activate this template.', 'error'),
                ),
                restricted: 'Owner or Admin',
              },
        ]
      : []),
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
      : item('Archive', Archive, () => setDialog('archive'), true),
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
        <ArchiveDialog
          template={row}
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            onNotice(`${row.name} archived.`, 'success');
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Archive, asked first (TP-F10): the template's name, what archiving does, how often it was used and
 * the active automations that use it. Its versions and the messages already sent stay; Restore
 * brings it back as a draft. Used by the row menu and the editor.
 */
export function ArchiveDialog({
  template,
  onClose,
  onDone,
}: {
  template: Pick<MessageTemplateRow, 'id' | 'name'>;
  onClose: () => void;
  onDone: () => void;
}) {
  const detail = useApiQuery([...TEMPLATES_KEY, 'detail', template.id], () =>
    api.templates.get(template.id),
  );
  const [warn, setWarn] = useState<string>();
  const archive = useApiMutation(
    (confirm: boolean) =>
      api.templates.archive(template.id, confirm ? { confirmAutomationImpact: true } : {}),
    { invalidate: [...TEMPLATES_KEY] },
  );
  const d = detail.data;
  const automations = d?.automationCount ?? 0;
  // The automations were shown (or the API named them since): this Archive is the confirmation.
  const impact = automations > 0 || warn !== undefined;
  // mutateAsync, not mutate's callbacks: the refetch after an archive drops the row, which can
  // unmount this dialog (and its menu) first, and mutate's callbacks then never run.
  const go = () =>
    void archive.mutateAsync(impact).then(onDone, (e: unknown) => {
      if (e instanceof ApiRequestError && e.code === 'AUTOMATION_IN_USE') setWarn(e.message);
    });
  const usage = detail.isPending
    ? 'Checking where it is used…'
    : !d
      ? 'We could not check where it is used.'
      : d.useCount === 0
        ? 'It has not been used yet.'
        : `Used ${d.useCount} time${d.useCount === 1 ? '' : 's'}${d.lastUsedAt ? `, last on ${dayText(d.lastUsedAt)}` : ''}.`;
  const failed =
    archive.isError &&
    !(archive.error instanceof ApiRequestError && archive.error.code === 'AUTOMATION_IN_USE');
  return (
    <Modal
      open
      title="Archive template?"
      subtitle={template.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep
          </Button>
          <Button disabled={archive.isPending || detail.isPending} onClick={go}>
            {impact ? 'Archive Anyway' : 'Archive'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-text" data-testid="archive-dialog">
        <p>
          It leaves the library and every template picker, so no one can use it in a new message or
          automation. The messages already sent with it and its versions stay, and Restore brings it
          back as a draft.
        </p>
        <p data-testid="archive-usage">{usage}</p>
        {impact ? (
          <p role="alert" className="text-warning" data-testid="automation-warning">
            {warn ?? `${automations} active automation${automations === 1 ? ' uses' : 's use'} it.`}{' '}
            Archiving it stops them from sending it.
          </p>
        ) : null}
        {failed ? (
          <p role="alert" className="text-danger">
            {errorMessage(archive.error, TEMPLATE_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Use on a template's row (`templateUse`): an Email or SMS template opens a Communications draft
 * copied from it; a Task, Document Request or Intake template starts its module's own task,
 * request or send from the template it stands for (TP-F08). When it can't be used (a draft, an
 * archived one, nothing chosen yet, Tax Workflow or Bookkeeping) Use stays in place switched off,
 * with the reason on hover, for screen readers and on a press (TP-F13, TP-F14).
 */
export function UseTemplate({
  row,
  className,
  onNotice,
}: {
  row: Pick<MessageTemplateRow, 'id' | 'name' | 'kind' | 'status' | 'linkedTemplateId'>;
  className: string;
  onNotice: (text: string, tone: 'success' | 'error') => void;
}) {
  const { role } = useFirm();
  const reasonId = useId();
  const use = templateUse(row, role === 'OWNER' || role === 'ADMIN');
  if (!use) return null;
  if ('href' in use) {
    return (
      <Link href={use.href} aria-label={`Use ${row.name}`} className={className}>
        Use
      </Link>
    );
  }
  const { reason } = use;
  return (
    <>
      <button
        type="button"
        aria-disabled="true"
        aria-label={`Use ${row.name}`}
        aria-describedby={reasonId}
        title={reason}
        onClick={() => onNotice(reason, 'error')}
        data-testid="use-blocked"
        className="inline-flex min-h-9 cursor-not-allowed items-center rounded-control border border-divider bg-canvas px-4 text-sm font-semibold text-muted"
      >
        Use
      </button>
      <span id={reasonId} hidden>
        {reason}
      </span>
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
