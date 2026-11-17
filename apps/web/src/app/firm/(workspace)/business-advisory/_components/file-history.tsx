'use client';

import type { FirmDocument } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { BA_KEY, dayText } from './ba-shared';

/**
 * Advisory Review 2 A-X12 (Octavia's B33): one shared file's history, from the documents' own
 * records (never their content): each version (who uploaded it, when, its check) and what was done
 * with it (uploaded, shared, downloaded, replaced...), newest first.
 */
export function FileHistoryDialog({ doc, onClose }: { doc: FirmDocument; onClose: () => void }) {
  const versions = useApiQuery([...BA_KEY, 'file-versions', doc.id], () =>
    api.documentLibrary.versions(doc.id),
  );
  const activity = useApiQuery([...BA_KEY, 'file-activity', doc.id], () =>
    api.documentLibrary.activity(doc.id),
  );
  const unavailable = <p className="text-sm text-muted">Not available right now.</p>;
  return (
    <Modal
      open
      title="File History"
      subtitle={doc.fileName}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4 text-sm" data-testid="file-history">
        <section aria-label="Versions" className="flex flex-col gap-2">
          <h3 className="font-semibold text-heading">Versions</h3>
          {versions.isError ? (
            unavailable
          ) : versions.data ? (
            <ul className="flex flex-col gap-1">
              {versions.data.map((v) => (
                <li key={v.id} className="text-text">
                  Version {v.versionNo} · {v.fileName}
                  <span className="text-muted">
                    {' '}
                    · {v.uploadedBy?.name ?? 'Unknown'}
                    {v.uploadedBy?.byClient ? ' (client)' : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Loading…</p>
          )}
        </section>
        <section aria-label="Activity" className="flex flex-col gap-2">
          <h3 className="font-semibold text-heading">Activity</h3>
          {activity.isError ? (
            unavailable
          ) : activity.data ? (
            activity.data.length ? (
              <ul className="flex flex-col gap-1">
                {[...activity.data]
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .map((a) => (
                    <li key={a.id} className="text-text">
                      {a.label}
                      <span className="text-muted">
                        {' '}
                        · {dayText(a.at)}
                        {a.by ? ` · ${a.by}` : ''}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-muted">Nothing recorded yet.</p>
            )
          ) : (
            <p className="text-muted">Loading…</p>
          )}
        </section>
      </div>
    </Modal>
  );
}
