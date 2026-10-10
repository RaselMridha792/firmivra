'use client';

import type { ClientRecord } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { CLIENT_ERRORS, CLIENTS } from '../../_components/client-parts';

/**
 * Archive (with a confirm) or restore, for the Owner and Admins. An archived client leaves the
 * default list and can't be changed; nothing is deleted.
 */
export function ArchiveAction({ client }: { client: ClientRecord }) {
  const [confirming, setConfirming] = useState(false);
  const archive = useApiMutation(() => api.clients.archive(client.id), { invalidate: CLIENTS });
  const restore = useApiMutation(() => api.clients.restore(client.id), { invalidate: CLIENTS });

  if (client.archivedAt) {
    return (
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <Button variant="secondary" disabled={restore.isPending} onClick={() => restore.mutate()}>
          Restore client
        </Button>
        {restore.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(restore.error, CLIENT_ERRORS)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          archive.reset();
          setConfirming(true);
        }}
      >
        Archive client
      </Button>
      <Modal
        open={confirming}
        title={`Archive ${client.displayName}?`}
        onClose={() => setConfirming(false)}
      >
        <p className="text-sm text-muted">
          The client leaves your active list and their record can&apos;t be changed until you
          restore it. Nothing is deleted.
        </p>
        {archive.error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {errorMessage(archive.error, CLIENT_ERRORS)}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            disabled={archive.isPending}
            onClick={() => archive.mutate(undefined, { onSuccess: () => setConfirming(false) })}
          >
            Archive
          </Button>
        </div>
      </Modal>
    </>
  );
}
