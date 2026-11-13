'use client';

import {
  ApiRequestError,
  type AdminSettingsSectionKey,
  type AdminSettingValue,
} from '@firmivra/types';
import { Button, Card, Input, Modal } from '@firmivra/ui';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { Body, QuietLine, SS, stamp } from './settings-kit';

// SA-SYS-A2: a section's Change History, and Compare & Restore for one save. Restore puts that
// save's kept values back (switches, numbers, choices, colours), leaves everything else, and asks
// for the Super Admin's own password every time. Text and long values are named, never kept.

/** "channels.sms" as "Channels › SMS"; "primaryAccent" as "Primary accent". */
export function fieldLabel(path: string): string {
  return path
    .split('.')
    .map((part) => {
      const words = part.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      const word = words === 'sms' ? 'SMS' : words;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' › ');
}

/** A kept value as the page shows it. */
export function shown(value: AdminSettingValue): string {
  if (value === null || value === '') return 'None';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  return String(value);
}

const RESTORE_ERRORS: Record<string, string> = {
  SAVE_CONFLICT:
    'Someone saved this section since you opened the comparison. Close it and compare again.',
  NOTHING_TO_RESTORE: 'Every value of that save is already back. Nothing was changed.',
  RESTORE_INVALID: 'Those earlier values are no longer allowed together. Nothing was changed.',
};

export function SettingsHistory({
  section,
  onRestored,
}: {
  section: AdminSettingsSectionKey;
  /** The page drops its unsaved draft and reads the section again. */
  onRestored: () => void;
}) {
  const q = useApiQuery([...SS, 'history', section], () => api.adminSettings.history({ section }));
  const [picked, setPicked] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-5!" data-testid="settings-history">
      <div className="flex items-start gap-3">
        <ClockCounterClockwise aria-hidden weight="bold" className="mt-1 size-5 text-action" />
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-heading">Change History</h2>
          <p className="text-sm text-muted">
            The newest saves first. Compare one with now, and restore its earlier values.
          </p>
        </div>
      </div>
      {done ? (
        <p role="status" className="text-sm text-success">
          {done}
        </p>
      ) : null}
      <Body query={q} rows={2}>
        {(h) =>
          h.items.length ? (
            <ol className="flex flex-col divide-y divide-divider">
              {h.items.slice(0, 6).map((item) => {
                const kept = item.changes.filter((c) => c.kept);
                return (
                  <li key={item.eventId} className="flex flex-col gap-1 py-2 text-sm">
                    <p className="text-heading">
                      <span className="font-semibold">
                        {item.kind === 'RESTORED' ? 'Restored' : 'Saved'}
                      </span>{' '}
                      {stamp(item.at)}
                      {item.by ? ` by ${item.by}` : ''}
                    </p>
                    <p className="text-muted">
                      {item.changes.length
                        ? item.changes.map((c) => fieldLabel(c.field)).join(', ')
                        : 'No field changed'}
                    </p>
                    {kept.length ? (
                      <Button
                        variant="ghost"
                        className="w-fit"
                        onClick={() => {
                          setDone(null);
                          setPicked(item.eventId);
                        }}
                      >
                        Compare & Restore
                        <span className="sr-only"> the save of {stamp(item.at)}</span>
                      </Button>
                    ) : (
                      <p className="text-xs text-muted">Nothing here can be restored.</p>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <QuietLine>No saves yet.</QuietLine>
          )
        }
      </Body>
      {picked ? (
        <RestoreDialog
          eventId={picked}
          onClose={() => setPicked(null)}
          onRestored={(count) => {
            setPicked(null);
            setDone(`${count} ${count === 1 ? 'value' : 'values'} restored.`);
            onRestored();
          }}
        />
      ) : null}
    </Card>
  );
}

function RestoreDialog({
  eventId,
  onClose,
  onRestored,
}: {
  eventId: string;
  onClose: () => void;
  onRestored: (count: number) => void;
}) {
  const preview = useApiQuery([...SS, 'restore-preview', eventId], () =>
    api.adminSettings.restorePreview({ eventId }),
  );
  const [password, setPassword] = useState('');
  const restore = useApiMutation(
    () => api.adminSettings.restore({ eventId, version: preview.data?.version ?? 0, password }),
    { invalidate: [...SS] },
  );
  const wrongPassword =
    restore.error instanceof ApiRequestError &&
    restore.error.details?.some((d) => d.path === 'password');
  const p = preview.data;
  return (
    <Modal
      open
      title="Compare & Restore"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!p?.fields.length || !password || restore.isPending}
            onClick={() =>
              restore.mutate(undefined, { onSuccess: (r) => onRestored(r.restored.length) })
            }
          >
            {restore.isPending ? 'Restoring…' : 'Restore'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="restore-dialog">
        <Body query={preview} rows={3}>
          {(data) => (
            <>
              {data.fields.length ? (
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">What Restore changes</caption>
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Setting</th>
                      <th className="py-1 pr-2 font-medium">Now</th>
                      <th className="py-1 font-medium">Restores to</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-divider">
                    {data.fields.map((f) => (
                      <tr key={f.field}>
                        <td className="py-1.5 pr-2 text-heading">{fieldLabel(f.field)}</td>
                        <td className="py-1.5 pr-2">{shown(f.current)}</td>
                        <td className="py-1.5 font-semibold text-heading">{shown(f.restoreTo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <QuietLine>Every value of that save is already back. Nothing to restore.</QuietLine>
              )}
              {data.unchanged.length ? (
                <p className="text-xs text-muted">
                  Already at the earlier value: {data.unchanged.map(fieldLabel).join(', ')}.
                </p>
              ) : null}
              {data.notKept.length ? (
                <p className="text-xs text-muted">
                  Not restored (text and long values are not kept in the history):{' '}
                  {data.notKept.map(fieldLabel).join(', ')}.
                </p>
              ) : null}
              <p className="text-xs text-muted">
                Every other setting stays as it is now. This applies to the whole platform.
              </p>
            </>
          )}
        </Body>
        <Input
          label="Your password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={wrongPassword ? 'Your password is not right' : undefined}
        />
        {restore.error && !wrongPassword ? (
          <p role="alert" className="text-sm text-danger">
            {RESTORE_ERRORS[errorCode(restore.error) ?? ''] ?? errorMessage(restore.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
