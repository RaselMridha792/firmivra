'use client';

import {
  ESIGN_ERRORS,
  type EsignTemplateDetail,
  type EsignTemplateVersion,
  RestoreEsignTemplateVersionBody,
} from '@firmivra/types';
import { Badge, Button, Card, Modal } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { count, shortDate } from '../../../../../../../components/esign/format';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { TextArea } from '../../../../../setup/_components/fields';
import { TEMPLATES, templateKey } from '../../_components/keys';

/** Every saved version, newest first; an older one can be restored as a new newest version. */
export function TemplateVersions({ t, editable }: { t: EsignTemplateDetail; editable: boolean }) {
  const versions = useApiQuery([...templateKey(t.id), 'versions'], () =>
    api.esign.templates.versions(t.id),
  );
  const [restoring, setRestoring] = useState<EsignTemplateVersion | null>(null);
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-semibold text-heading">Versions</h2>
      <p className="text-sm text-muted">
        A new request copies the current version. Requests already made keep the version they came
        from.
      </p>
      {versions.isError && !versions.data && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(versions.error, ESIGN_ERRORS)}
        </p>
      )}
      {versions.isPending && <p className="text-sm text-muted">Loading versions…</p>}
      <ol data-testid="template-versions" className="flex flex-col divide-y divide-border">
        {versions.data?.items.map((v) => (
          <li key={v.version} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-text">Version {v.version}</span>
                {v.current && <Badge tone="success">Current</Badge>}
              </div>
              <span className="text-muted">
                Saved {shortDate(v.savedAt)} by {v.savedBy.name}. {count(v.pageCount, 'page')},{' '}
                {count(v.roleCount, 'role')}, {count(v.fieldCount, 'field')}.
              </span>
              {v.note && <span className="text-text">{v.note}</span>}
            </div>
            {editable && !v.current && (
              <Button variant="secondary" onClick={() => setRestoring(v)}>
                Restore
              </Button>
            )}
          </li>
        ))}
      </ol>
      {restoring && <RestoreDialog t={t} v={restoring} onClose={() => setRestoring(null)} />}
    </Card>
  );
}

function RestoreDialog({
  t,
  v,
  onClose,
}: {
  t: EsignTemplateDetail;
  v: EsignTemplateVersion;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const restore = useApiMutation((body: RestoreEsignTemplateVersionBody) =>
    api.esign.templates.restoreVersion(t.id, v.version, body),
  );
  const leave = (event?: { preventDefault?: () => void }) => {
    // Modal passes Escape's cancel event: stopping it keeps the dialog open while restoring.
    if (restore.isPending) event?.preventDefault?.();
    else onClose();
  };
  function submit() {
    const parsed = RestoreEsignTemplateVersionBody.safeParse(note.trim() ? { note } : {});
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    restore.mutate(parsed.data, {
      onSuccess: (next) => {
        queryClient.setQueryData(templateKey(t.id), next);
        void queryClient.invalidateQueries({ queryKey: [...templateKey(t.id), 'versions'] });
        void queryClient.invalidateQueries({ queryKey: [...TEMPLATES, 'list'] });
        onClose();
      },
    });
  }
  return (
    <Modal open title={`Restore version ${v.version}?`} onClose={leave}>
      <div className="flex max-w-xl flex-col gap-4">
        <p className="text-sm text-text">
          It is copied into a new current version, which new requests use from now on. Nothing is
          overwritten.
        </p>
        <TextArea
          label="Note (optional)"
          maxLength={500}
          value={note}
          error={error}
          disabled={restore.isPending}
          onChange={(e) => {
            setNote(e.target.value);
            setError(undefined);
            restore.reset();
          }}
        />
        {restore.error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(restore.error, ESIGN_ERRORS)}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button disabled={restore.isPending} onClick={submit}>
            {restore.isPending ? 'Restoring…' : 'Restore'}
          </Button>
          <Button variant="ghost" disabled={restore.isPending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
