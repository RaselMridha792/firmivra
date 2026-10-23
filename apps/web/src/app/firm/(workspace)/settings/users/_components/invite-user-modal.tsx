'use client';

import { FIRM_ROLE_LABELS, type MembershipRole, type StaffListItem } from '@firmivra/types';
import { Button, Modal, SearchField, Select } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { customKey } from './custom-roles';

const INVITE_ERRORS: Record<string, string> = {
  CANNOT_GRANT: 'You cannot give this role. Choose another role or ask the Owner.',
  NOT_INVITED: 'This person already has an account. Use Reset Password or Reactivate instead.',
  SAVE_CONFLICT: 'This staff record changed meanwhile. Choose the person again.',
  FORBIDDEN: 'Only an Owner or an Admin can invite users.',
  NOT_FOUND: 'This staff record is no longer there. Choose the person again.',
};

const sentText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Invite User (Octavia's review, Oct 20, section 5): the person is created in Staff Management
 * first, then invited from here; no second staff record. Choose the existing record (searchable,
 * name and work email come from it), check the role, send. The activation email carries a
 * time-limited link; the person sets their own password and two-factor sign-in. A role change is
 * saved on the record first (Edit Staff's route), then the invitation goes out (Resend's route,
 * which never claims an email that failed).
 */
export function InviteUserModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const options = useApiQuery(['staff', 'options'], () => api.staff.options());
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const candidates = useApiQuery(['staff', 'invite-candidates', term], () =>
    api.staff.list({
      status: 'invited',
      pageSize: 100,
      ...(term.length >= 2 ? { search: term } : {}),
    }),
  );
  const [picked, setPicked] = useState<StaffListItem>();
  /** A built-in role, or `custom:<id>` for one of the firm's custom roles. */
  const [role, setRole] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const roles = (options.data?.roles ?? []).filter((r) => r.role !== 'OWNER');
  const customs = options.data?.customRoles ?? [];
  const people = candidates.data?.items ?? [];
  const current = picked?.customRole ? customKey(picked.customRole.id) : (picked?.role ?? '');
  const chosen = role || current;
  const custom = customs.find((c) => customKey(c.id) === chosen);
  const description = custom
    ? (custom.description ?? `Starts from ${FIRM_ROLE_LABELS[custom.basedOn]}.`)
    : roles.find((r) => r.role === chosen)?.description;

  const send = async () => {
    if (!picked || !chosen) return;
    setBusy(true);
    setError(undefined);
    try {
      if (chosen !== current) {
        const record = await api.staff.get(picked.id);
        await api.staff.update(picked.id, {
          version: record.version,
          account: custom
            ? { customRoleId: custom.id }
            : { role: chosen as MembershipRole, customRoleId: null },
        });
      }
      await api.staff.resendInvite(picked.id);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await queryClient.invalidateQueries({ queryKey: ['staff'] });
      onDone(`Invitation sent to ${picked.name} (${picked.email}).`);
    } catch (e) {
      // The inputs stay as they were, so a retry is one click.
      setError(errorMessage(e, INVITE_ERRORS));
      setBusy(false);
    }
  };

  return (
    <Modal open title="Invite User" onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-4"
        data-testid="invite-user"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <p className="text-sm text-text">
          Choose the employee from Staff Management. Their name and work email come from their staff
          record.
        </p>
        <SearchField
          label="Search employees"
          placeholder="Search by name or email…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {candidates.isError ? (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
            Employees could not load. {errorMessage(candidates.error, INVITE_ERRORS)}
            <Button variant="outline" onClick={() => void candidates.refetch()}>
              Retry
            </Button>
          </p>
        ) : candidates.isPending ? (
          <p className="text-sm text-muted">Loading employees…</p>
        ) : people.length === 0 ? (
          <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-text">
            {term
              ? 'No employee waiting for an invitation matches this search.'
              : 'No employee is waiting for an invitation.'}{' '}
            <Link href="/team/new" className="font-medium text-link hover:underline">
              Add the employee in Staff Management
            </Link>{' '}
            first.
          </p>
        ) : (
          <ul
            role="listbox"
            aria-label="Employees waiting for an invitation"
            className="flex max-h-56 flex-col overflow-y-auto rounded-lg border border-divider"
          >
            {people.map((p) => {
              const on = picked?.id === p.id;
              return (
                <li key={p.id} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(p);
                      setRole('');
                      setError(undefined);
                    }}
                    className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm ${on ? 'bg-accent-soft' : 'hover:bg-canvas'}`}
                  >
                    <span className="font-medium text-heading">{p.name}</span>
                    <span className="text-muted">
                      {p.email} · {FIRM_ROLE_LABELS[p.role]}
                      {p.invite ? ` · invited ${sentText(p.invite.sentAt)}` : ' · not invited yet'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {picked ? (
          <div className="flex flex-col gap-3 rounded-lg border border-divider p-3">
            <dl className="grid grid-cols-[6rem_1fr] gap-1 text-sm">
              <dt className="text-muted">Name</dt>
              <dd className="text-heading">{picked.name}</dd>
              <dt className="text-muted">Work email</dt>
              <dd className="break-all text-heading">{picked.email}</dd>
            </dl>
            <Select
              label="Role *"
              options={[
                ...roles.map((r) => ({ value: r.role, label: r.label })),
                ...customs.map((c) => ({ value: customKey(c.id), label: `${c.name} (custom)` })),
              ]}
              value={chosen}
              onChange={(event) => setRole(event.target.value)}
            />
            {description ? <p className="text-xs text-muted">{description}</p> : null}
            {picked.invite ? (
              <p className="text-xs text-muted">
                Sending again replaces the link sent {sentText(picked.invite.sentAt)}; the old one
                stops working.
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="text-xs text-muted">
          They get a secure, time-limited link to set their own password; two-factor sign-in is
          always required.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!picked || !chosen || busy}>
            {busy ? 'Sending…' : 'Send Invitation'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
