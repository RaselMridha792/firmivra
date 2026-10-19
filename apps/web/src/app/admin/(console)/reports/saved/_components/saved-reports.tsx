'use client';

import type { AdminSavedReport } from '@firmivra/types';
import { ActionMenu, Badge, Button, Card, Input, Modal, Skeleton } from '@firmivra/ui';
import {
  Copy,
  DotsThreeVertical,
  PencilSimple,
  Play,
  ShareNetwork,
  TextAa,
  Trash,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  dateTimeText,
  loadError,
  QuietLine,
  ReportsHeader,
  ReportsTabs,
  RP,
  useRange,
} from '../../_components/reports-common';

const TYPE_LABELS: Record<AdminSavedReport['type'], string> = {
  FIRMS: 'Firms',
  USERS: 'Users',
  SUBSCRIPTIONS_REVENUE: 'Subscriptions & Revenue',
  SUPPORT: 'Support',
  FEATURE_USAGE: 'Feature Usage',
  ACTIVITY_LOG: 'Activity Log',
};
const PRESETS: Record<string, string> = {
  LAST_7_DAYS: 'Last 7 days',
  LAST_30_DAYS: 'Last 30 days',
  THIS_MONTH: 'This month',
  LAST_MONTH: 'Last month',
  THIS_QUARTER: 'This quarter',
  THIS_YEAR: 'This year',
};
const rangeText = (r: AdminSavedReport['dateRange']) =>
  'preset' in r ? PRESETS[r.preset] : `${r.from} to ${r.to}`;

/**
 * Saved Reports (docx §6; no frame): your reports and the ones other Super Admins shared. Run and
 * Edit open the builder with the report; Rename, Share, Duplicate and Delete act here. Only the
 * owner changes or deletes one (the API answers 404 otherwise); a copy is always yours.
 */
export function SavedReports() {
  const { keep } = useRange();
  const router = useRouter();
  const q = useApiQuery([...RP, 'saved'], () => api.adminReports.saved());
  const [renaming, setRenaming] = useState<AdminSavedReport | null>(null);
  const [deleting, setDeleting] = useState<AdminSavedReport | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const done = (text: string) => setNotice({ tone: 'ok', text });
  const failed = (e: unknown) => setNotice({ tone: 'error', text: errorMessage(e) });
  const share = useApiMutation(
    (s: AdminSavedReport) => api.adminReports.updateSaved(s.id, { shared: !s.shared }),
    { invalidate: [...RP, 'saved'] },
  );
  const duplicate = useApiMutation((s: AdminSavedReport) => api.adminReports.duplicateSaved(s.id), {
    invalidate: [...RP, 'saved'],
  });

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ReportsHeader
        back
        title="Saved Reports"
        subtitle="Reports you saved, and the ones other Super Admins shared, ready to run on current data."
        actions={
          <Link
            href={keep('/reports/builder')}
            className="inline-flex h-10 items-center rounded-lg bg-action px-4 text-sm font-semibold text-on-action"
          >
            New Report
          </Link>
        }
      />
      <ReportsTabs />
      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${notice.tone === 'error' ? 'text-danger' : 'text-success'}`}
        >
          {notice.text}
        </p>
      ) : null}
      <Card className="p-5!" data-testid="saved-reports">
        {q.isError ? (
          <QuietLine>{loadError(q.error)}</QuietLine>
        ) : !q.data ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : !q.data.items.length ? (
          <QuietLine>
            No saved reports yet. Build one in Custom Reports and choose Save Report.
          </QuietLine>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="bg-table-head text-text">
                <tr>
                  {['Report', 'Type', 'Period', 'Owner', 'Last Run', ''].map((h) => (
                    <th key={h || 'actions'} scope="col" className="px-3 py-2 font-medium">
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {q.data.items.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-3">
                      <span className="font-semibold text-heading">{s.name}</span>
                      {s.description ? (
                        <span className="block text-xs text-muted">{s.description}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-text">{TYPE_LABELS[s.type]}</td>
                    <td className="px-3 py-3 text-text">{rangeText(s.dateRange)}</td>
                    <td className="px-3 py-3 text-text">
                      {s.isYours ? 'You' : s.owner.name}{' '}
                      {s.shared ? <Badge tone="info">Shared</Badge> : null}
                    </td>
                    <td className="px-3 py-3 text-text">
                      {s.lastRunAt ? dateTimeText(s.lastRunAt) : 'Never'}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => router.push(keep(`/reports/builder/run?saved=${s.id}`))}
                        >
                          <span className="inline-flex items-center gap-1.5 text-action">
                            <Play aria-hidden weight="fill" className="size-4" />
                            Run
                          </span>
                        </Button>
                        <ActionMenu
                          label={`More for ${s.name}`}
                          align="right"
                          trigger={
                            <DotsThreeVertical
                              aria-hidden
                              weight="bold"
                              className="size-5 text-text"
                            />
                          }
                          sections={[
                            {
                              items: [
                                ...(s.isYours
                                  ? [
                                      {
                                        label: 'Edit',
                                        icon: PencilSimple,
                                        onSelect: () =>
                                          router.push(keep(`/reports/builder?saved=${s.id}`)),
                                      },
                                      {
                                        label: 'Rename',
                                        icon: TextAa,
                                        onSelect: () => setRenaming(s),
                                      },
                                      {
                                        label: s.shared
                                          ? 'Stop sharing'
                                          : 'Share with Super Admins',
                                        icon: ShareNetwork,
                                        onSelect: () =>
                                          share.mutate(s, {
                                            onSuccess: (r) =>
                                              done(
                                                r.shared
                                                  ? `“${r.name}” is shared.`
                                                  : `“${r.name}” is yours only.`,
                                              ),
                                            onError: failed,
                                          }),
                                      },
                                    ]
                                  : []),
                                {
                                  label: 'Duplicate',
                                  icon: Copy,
                                  onSelect: () =>
                                    duplicate.mutate(s, {
                                      onSuccess: (r) => done(`Saved a copy: “${r.name}”.`),
                                      onError: failed,
                                    }),
                                },
                                ...(s.isYours
                                  ? [
                                      {
                                        label: 'Delete',
                                        icon: Trash,
                                        danger: true,
                                        onSelect: () => setDeleting(s),
                                      },
                                    ]
                                  : []),
                              ],
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <RenameModal
        report={renaming}
        onClose={() => setRenaming(null)}
        onDone={(r) => done(`Renamed to “${r.name}”.`)}
      />
      <DeleteModal
        report={deleting}
        onClose={() => setDeleting(null)}
        onDone={(name) => done(`Deleted “${name}”.`)}
      />
    </div>
  );
}

function RenameModal({
  report,
  onClose,
  onDone,
}: {
  report: AdminSavedReport | null;
  onClose: () => void;
  onDone: (r: AdminSavedReport) => void;
}) {
  const [name, setName] = useState('');
  const rename = useApiMutation((id: string) => api.adminReports.updateSaved(id, { name }), {
    invalidate: [...RP, 'saved'],
  });
  return (
    <Modal
      open={report !== null}
      title="Rename report"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || rename.isPending}
            onClick={() =>
              rename.mutate(report!.id, {
                onSuccess: (r) => {
                  onDone(r);
                  onClose();
                },
              })
            }
          >
            Rename
          </Button>
        </>
      }
    >
      <Input
        label="Report Name"
        defaultValue={report?.name}
        key={report?.id}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
      />
      {rename.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(rename.error, {
            DUPLICATE_NAME: 'You already have a saved report with this name.',
          })}
        </p>
      ) : null}
    </Modal>
  );
}

function DeleteModal({
  report,
  onClose,
  onDone,
}: {
  report: AdminSavedReport | null;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const remove = useApiMutation((id: string) => api.adminReports.deleteSaved(id), {
    invalidate: [...RP, 'saved'],
  });
  return (
    <Modal
      open={report !== null}
      title="Delete report?"
      subtitle={
        report
          ? `“${report.name}” goes for everyone it is shared with. Exported files are not affected.`
          : undefined
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="dark"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(report!.id, {
                onSuccess: () => {
                  onDone(report!.name);
                  onClose();
                },
              })
            }
          >
            Delete
          </Button>
        </>
      }
    >
      {remove.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(remove.error)}
        </p>
      ) : (
        <p className="text-sm text-text">This removes the saved definition only.</p>
      )}
    </Modal>
  );
}
