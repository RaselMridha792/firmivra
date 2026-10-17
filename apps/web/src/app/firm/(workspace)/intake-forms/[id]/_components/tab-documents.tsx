'use client';

import { Badge } from '@firmivra/ui';
import { FolderOpen } from '@phosphor-icons/react';
import { InfoCard } from './detail-cards';
import { useDetail } from './detail-frame';
import { FileTile } from './detail-rail';
import { Quiet, stamp } from './detail-shared';

const SCAN = {
  CLEAN: { label: 'Clean', tone: 'success' },
  PENDING: { label: 'Being checked', tone: 'warning' },
  INFECTED: { label: 'Blocked', tone: 'danger' },
  FAILED: { label: 'Check failed', tone: 'danger' },
} as const;

/** Documents tab: every file the client uploaded, which question it answers and its scan result. */
export function DocumentsTab() {
  const { record, loading } = useDetail();
  const docs = record?.documents ?? [];
  return (
    <InfoCard
      icon={FolderOpen}
      tone="amber"
      title="Uploaded Documents"
      edit={false}
      testId="documents"
    >
      <p className="mb-3 text-sm text-text">
        Required documents uploaded:{' '}
        <span className="font-semibold text-heading">
          {record ? (record.progress.requiredDocumentsUploaded ? 'Yes' : 'Not yet') : '—'}
        </span>
      </p>
      {docs.length === 0 ? (
        <Quiet>
          {loading
            ? 'Loading…'
            : record
              ? 'No documents were uploaded with this form.'
              : 'Documents are not available right now.'}
        </Quiet>
      ) : (
        <ul className="divide-y divide-divider" data-testid="document-list">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
              <FileTile doc={d} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-heading">{d.fileName}</span>
                <span className="text-xs text-muted">
                  {d.questionLabel ?? 'Document'} · Uploaded {stamp(d.uploadedAt)}
                </span>
              </span>
              <Badge tone={SCAN[d.scanStatus].tone}>{SCAN[d.scanStatus].label}</Badge>
            </li>
          ))}
        </ul>
      )}
    </InfoCard>
  );
}
