'use client';

import type { StaffDetail } from '@firmivra/types';
import {
  type Icon,
  Key,
  LockKey,
  LockSimple,
  LockSimpleOpen,
  PaperPlaneTilt,
  SignOut,
  UserCheck,
  UserMinus,
} from '@phosphor-icons/react';
import { createElement, useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import { ActionModal, type StaffAction } from '../../_components/staff-actions';
import { MEMBER_ERRORS } from '../../_components/staff-parts';

interface Item {
  action: StaffAction | 'resend';
  label: string;
  icon: Icon;
  danger?: boolean;
}

/** The six controls, as the member's status allows (Lock or Unlock, Deactivate or Reactivate). */
function itemsFor(member: StaffDetail | undefined): Item[] {
  const status = member?.status;
  return [
    { action: 'resetPassword', label: 'Reset Password', icon: Key },
    { action: 'resetMfa', label: 'Reset MFA', icon: LockSimple },
    { action: 'resend', label: 'Resend Invitation', icon: PaperPlaneTilt },
    { action: 'signOutAll', label: 'Sign Out All Sessions', icon: SignOut },
    status === 'LOCKED'
      ? { action: 'unlock', label: 'Unlock Account', icon: LockSimpleOpen }
      : { action: 'lock', label: 'Lock Account', icon: LockKey, danger: true },
    status === 'DEACTIVATED'
      ? { action: 'reactivate', label: 'Reactivate Account', icon: UserCheck }
      : { action: 'deactivate', label: 'Deactivate Account', icon: UserMinus, danger: true },
  ];
}

function fits(action: Item['action'], member: StaffDetail): boolean {
  const s = member.status;
  if (action === 'resend') return s === 'INVITED';
  if (action === 'reactivate') return s === 'DEACTIVATED';
  if (action === 'unlock') return s === 'LOCKED';
  if (action === 'deactivate') return s !== 'DEACTIVATED';
  if (action === 'lock') return s === 'ACTIVE';
  // Reset Password, Reset MFA and Sign Out All are for someone who has signed in.
  return s === 'ACTIVE' || s === 'LOCKED';
}

/**
 * Quick Actions and Account Actions (staff-account-access-and-security.jpg): Reset Password,
 * Reset MFA, Resend Invitation, Sign Out All Sessions, Lock and Deactivate. Each high-risk one asks
 * first (ActionModal); the line under the buttons says what happened.
 */
export function AccountButtons({
  member,
  enabled,
  testId,
}: {
  member: StaffDetail | undefined;
  enabled: boolean;
  testId: string;
}) {
  const [action, setAction] = useState<StaffAction | null>(null);
  const [done, setDone] = useState('');
  const resend = useApiMutation((id: string) => api.staff.resendInvite(id), {
    invalidate: ['staff'],
  });
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {itemsFor(member).map((item) => (
          <button
            key={item.action}
            type="button"
            disabled={!enabled || !member || !fits(item.action, member) || resend.isPending}
            onClick={() => {
              if (!member) return;
              setDone('');
              if (item.action === 'resend') {
                resend.mutate(member.id, {
                  onSuccess: () => setDone(`A fresh invitation was emailed to ${member.name}.`),
                });
              } else setAction(item.action);
            }}
            className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border bg-surface px-1.5 text-xs font-semibold hover:bg-canvas disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:hover:bg-surface ${item.danger ? 'border-danger text-danger' : 'border-action text-action'}`}
          >
            {createElement(item.icon, {
              'aria-hidden': true,
              weight: 'fill',
              className: 'size-4 shrink-0',
            })}
            {item.label}
          </button>
        ))}
      </div>
      {resend.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(resend.error, MEMBER_ERRORS)}
        </p>
      ) : done ? (
        <p role="status" data-testid={`${testId}-result`} className="text-sm text-success">
          {done}
        </p>
      ) : null}
      {action && member ? (
        <ActionModal
          action={action}
          id={member.id}
          name={member.name}
          onClose={() => setAction(null)}
          onDone={(text) => {
            setAction(null);
            setDone(text);
          }}
        />
      ) : null}
    </div>
  );
}
