'use client';

import {
  FIRM_ROLE_LABELS,
  type StaffSecurityApplyPreview,
  type StaffSecurityDefaultField,
} from '@firmivra/types';
import { Button, Checkbox, Modal, Skeleton } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { NOT_LOADED } from '../../../_components/quiet-card';

/** What each setting is called on this page, for the preview's "Changes". */
export const FIELD_WORDS: Record<StaffSecurityDefaultField, string> = {
  allowedAuthMethods: 'sign-in methods',
  accessLocation: 'where they may sign in from',
  allowedIps: 'allowed IP addresses',
  allowedCountries: 'allowed countries',
  restrictDevices: 'device restriction',
  autoLogoutMinutes: 'automatic logout',
  maxConcurrentSessions: 'concurrent sessions',
  signOutOtherSessions: 'logging out other sessions',
  allowTrustedDevices: 'Remember This Device',
  notifyNewDeviceLogin: 'new device notices',
  notifyFailedLogins: 'failed sign-in notices',
  notifyPasswordChanges: 'password change notices',
  notifySecurityAlerts: 'security alert notices',
  notifyLockouts: 'lockout notices',
};

const SKIPPED: Record<StaffSecurityApplyPreview['skipped'][number]['reason'], string> = {
  YOU: 'you: change your own on your Access & Security page',
  NOT_YOURS: 'only an Owner can change this account',
};

const ERRORS: Record<string, string> = {
  SAVE_CONFLICT:
    'The defaults were saved again after this preview. Close this and open it again to see who changes.',
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The preview's body: who changes (each can be left out), who is left out and why. */
function Preview({
  preview,
  kept,
  toggle,
}: {
  preview: StaffSecurityApplyPreview;
  kept: Set<string>;
  toggle: (id: string, keep: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-4 text-sm text-text">
      {preview.accounts.length ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium text-heading">
            These accounts get the saved defaults. Untick anyone who should keep their own.
          </legend>
          <ul className="flex max-h-72 flex-col divide-y divide-divider overflow-y-auto">
            {preview.accounts.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 py-2" data-testid="apply-account">
                <Checkbox
                  label={`${a.name} (${FIRM_ROLE_LABELS[a.role]})`}
                  checked={!kept.has(a.id)}
                  onChange={(e) => toggle(a.id, !e.target.checked)}
                  className="text-sm"
                />
                <p className="pl-7 text-xs text-muted">
                  Changes: {a.changes.map((f) => FIELD_WORDS[f]).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <p>Every account you may change already uses these settings.</p>
      )}
      {preview.unchanged ? <p>{plural(preview.unchanged, 'account')} already match.</p> : null}
      {preview.skipped.length ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-heading">Left out</p>
          <ul className="flex flex-col gap-1">
            {preview.skipped.map((x) => (
              <li key={x.id}>
                {x.name}: {SKIPPED[x.reason]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-muted">
        Each account uses its new settings from its next request; a new session limit counts from
        its next sign-in. Deactivated accounts are not changed.
      </p>
    </div>
  );
}

/**
 * SM05 (Staff Management Review 2, decision 4a): a one-off "Apply to Existing Accounts" with the
 * saved defaults. It previews who changes and what, lets each be left out (the explicit
 * exceptions), and asks before applying. Audited on the API, per account and as a whole.
 */
export function ApplyToExisting({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const preview = useApiQuery(['staff', 'security-defaults', 'apply-preview'], () =>
    api.staff.securityApplyPreview(),
  );
  const [kept, setKept] = useState<Set<string>>(new Set());
  const apply = useApiMutation(
    (body: { version: string; exceptIds: string[] }) =>
      api.staff.applySecurityDefaults({ ...body, confirm: true }),
    { invalidate: ['staff'] },
  );
  const data = preview.data;
  const going = data ? data.accounts.filter((a) => !kept.has(a.id)).length : 0;
  const toggle = (id: string, keep: boolean) =>
    setKept((was) => {
      const next = new Set(was);
      if (keep) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Modal
      open
      title="Apply to existing accounts?"
      subtitle="The saved defaults, onto the staff accounts you may change."
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {apply.error ? (
            <p role="alert" className="mr-auto text-sm text-danger">
              {errorMessage(apply.error, ERRORS)}
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!data || !going || apply.isPending}
            onClick={() =>
              data &&
              apply.mutate(
                { version: data.version, exceptIds: [...kept] },
                {
                  onSuccess: (r) =>
                    onDone(
                      `Applied to ${plural(r.applied, 'account')}.${
                        r.excepted ? ` ${plural(r.excepted, 'account')} kept their own.` : ''
                      }`,
                    ),
                },
              )
            }
          >
            {apply.isPending ? 'Applying…' : `Apply to ${plural(going, 'Account')}`}
          </Button>
        </div>
      }
    >
      {preview.isPending ? (
        <Skeleton className="h-32" />
      ) : data ? (
        <Preview preview={data} kept={kept} toggle={toggle} />
      ) : (
        <p className="text-sm text-muted">{NOT_LOADED}</p>
      )}
    </Modal>
  );
}
