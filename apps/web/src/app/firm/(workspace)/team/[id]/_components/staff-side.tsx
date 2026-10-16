'use client';

import type { PermissionModule, StaffDetail } from '@firmivra/types';
import { Avatar, Badge, Button, Modal, Skeleton, Textarea } from '@firmivra/ui';
import {
  CalendarBlank,
  CheckCircle,
  Clock,
  EnvelopeSimple,
  type Icon,
  Key,
  Lightning,
  LockSimple,
  MapPin,
  NotePencil,
  PaperPlaneTilt,
  PauseCircle,
  PencilSimple,
  Phone,
  ShieldCheck,
  SignOut,
  Trash,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, createElement, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED } from '../../_components/quiet-card';
import { RowMenu } from '../../_components/row-menu';
import { CAPABILITY_ORDER } from '../../roles/_components/role-parts';
import type { StaffAction } from './staff-actions';
import { MEMBER_ERRORS, STATUS_LOOKS, dateTime, longDate } from './staff-parts';

const card =
  'flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm';
const quiet = 'rounded-lg bg-subtle p-4 text-sm text-muted';

/** A right-hand card of Edit Staff: the tinted tile, the title and an optional link. */
function SideCard({
  title,
  icon,
  action,
  testId,
  children,
}: {
  title: string;
  icon: Icon;
  action?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} data-testid={testId} className={card}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info-soft text-heading"
        >
          {createElement(icon, { weight: 'fill', className: 'size-6' })}
        </span>
        <h2 className="min-w-0 flex-1 text-lg font-bold whitespace-nowrap text-heading">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const sideLink = 'shrink-0 text-xs font-semibold text-link hover:underline';

/** Photo, name, status, title, departments, email, phone, office and Member since. */
export function ProfileCard({
  member,
  loading,
  failed,
}: {
  member: StaffDetail | undefined;
  loading: boolean;
  failed: string | undefined;
}) {
  const router = useRouter();
  if (!member) {
    return (
      <section aria-label="Staff profile" data-testid="staff-profile" className={card}>
        {loading ? <Skeleton className="h-28" /> : <p className={quiet}>{failed ?? NOT_LOADED}</p>}
      </section>
    );
  }
  const status = STATUS_LOOKS[member.status];
  const rows: [Icon, string][] = [
    [EnvelopeSimple, member.email],
    [Phone, member.phone ?? '—'],
    [MapPin, member.profile.office ?? '—'],
    [CalendarBlank, `Member since ${longDate(member.memberSince)}`],
  ];
  const base = `/team/${member.id}/security`;
  return (
    <section aria-label="Staff profile" data-testid="staff-profile" className={card}>
      <div className="flex items-start gap-4">
        <Avatar name={member.name} src={member.avatarUrl ?? undefined} size="xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-lg font-bold break-words text-heading">{member.name}</p>
          <span className="w-fit">
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
          </span>
          <p className="text-sm text-link">{member.jobTitle ?? '—'}</p>
          <p className="text-sm text-muted">
            {member.departments.map((d) => d.name).join(', ') || 'No department'}
          </p>
        </div>
        <RowMenu
          label={`More for ${member.name}`}
          items={[
            { label: 'Access & Security', onSelect: () => router.push(base) },
            { label: 'Login History', onSelect: () => router.push(`${base}/history`) },
            { label: 'Activity & Audit', onSelect: () => router.push(`${base}/activity`) },
          ]}
        />
      </div>
      <ul className="flex flex-col gap-2 border-t border-divider pt-3">
        {rows.map(([icon, text]) => (
          <li key={text} className="flex min-w-0 items-center gap-3 text-sm text-text">
            {createElement(icon, {
              'aria-hidden': true,
              weight: 'fill',
              className: 'size-5 shrink-0 text-heading',
            })}
            <span className="min-w-0 break-words">{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TILES: { action: StaffAction | 'resend'; label: string; icon: Icon; danger?: boolean }[] = [
  { action: 'resetPassword', label: 'Reset Password', icon: Key },
  { action: 'resetMfa', label: 'Reset MFA', icon: LockSimple },
  { action: 'resend', label: 'Resend Invite', icon: PaperPlaneTilt },
  { action: 'signOutAll', label: 'Sign Out All Sessions', icon: SignOut },
  { action: 'deactivate', label: 'Deactivate Account', icon: PauseCircle, danger: true },
  { action: 'delete', label: 'Delete Account', icon: Trash, danger: true },
];

/** Which quick actions fit the member's status (an invite only while invited, and so on). */
function fits(action: StaffAction | 'resend', member: StaffDetail): boolean {
  const signedIn = member.status === 'ACTIVE' || member.status === 'LOCKED';
  if (action === 'resend') return member.status === 'INVITED';
  if (action === 'deactivate' || action === 'delete') return member.status !== 'DEACTIVATED';
  return signedIn;
}

/** Reset Password, Reset MFA, Resend Invite, Sign Out All Sessions, Deactivate and Delete. */
export function QuickActions({
  member,
  enabled,
  onAction,
  message,
}: {
  member: StaffDetail | undefined;
  enabled: boolean;
  onAction: (action: StaffAction) => void;
  message: { text: string; error?: boolean } | null;
}) {
  const resend = useApiMutation((id: string) => api.staff.resendInvite(id), {
    invalidate: ['staff'],
  });
  const [sent, setSent] = useState('');
  return (
    <SideCard title="Quick Actions" icon={Lightning} testId="quick-actions">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {TILES.map((tile) => {
          const on = enabled && member !== undefined && fits(tile.action, member);
          return (
            <button
              key={tile.action}
              type="button"
              disabled={!on || resend.isPending}
              onClick={() => {
                if (!member) return;
                if (tile.action === 'resend') {
                  setSent('');
                  resend.mutate(member.id, {
                    onSuccess: () => setSent(`A fresh invitation was emailed to ${member.name}.`),
                  });
                } else onAction(tile.action);
              }}
              className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border border-divider bg-surface p-2 text-center text-xs font-medium text-text hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface"
            >
              {createElement(tile.icon, {
                'aria-hidden': true,
                weight: 'fill',
                className: `size-6 ${tile.danger ? 'text-danger' : 'text-heading'}`,
              })}
              {tile.label}
            </button>
          );
        })}
      </div>
      {resend.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(resend.error, MEMBER_ERRORS)}
        </p>
      ) : sent || message ? (
        <p
          role={message?.error ? 'alert' : 'status'}
          data-testid="action-result"
          className={`text-sm ${message?.error ? 'text-danger' : 'text-success'}`}
        >
          {sent || message?.text}
        </p>
      ) : null}
    </SideCard>
  );
}

/** "Payroll (View, Create, Edit)" for each module with something granted. */
export function AccessSummary({ id }: { id: string }) {
  const permissions = useApiQuery(['staff', 'permissions', id], () => api.staff.permissions(id));
  const modules = useApiQuery(['roles', 'modules'], () => api.roles.modules());
  const label = (m: PermissionModule) =>
    modules.data?.modules.find((x) => x.module === m)?.label ??
    m.charAt(0) + m.slice(1).toLowerCase().replaceAll('_', ' ');
  const capability = (c: string) =>
    modules.data?.capabilities.find((x) => x.capability === c)?.label ??
    c.charAt(0) + c.slice(1).toLowerCase();
  const granted = new Map<PermissionModule, string[]>();
  for (const cell of permissions.data?.cells ?? []) {
    if (!cell.granted) continue;
    granted.set(cell.module, [...(granted.get(cell.module) ?? []), cell.capability]);
  }
  const lines = [...granted].map(
    ([m, caps]) =>
      `${label(m)} (${CAPABILITY_ORDER.filter((c) => caps.includes(c))
        .map(capability)
        .join(', ')})`,
  );
  return (
    <SideCard
      title="Access Summary"
      icon={ShieldCheck}
      testId="access-summary"
      action={
        <Link href={`/team/${id}/security/permissions`} className={sideLink}>
          View All Permissions
        </Link>
      }
    >
      {permissions.isPending ? (
        <Skeleton className="h-24" />
      ) : permissions.isError ? (
        <p className={quiet}>{NOT_LOADED}</p>
      ) : lines.length ? (
        <ul className="flex flex-col gap-2">
          {lines.slice(0, 5).map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm text-text">
              <CheckCircle aria-hidden weight="fill" className="size-5 shrink-0 text-success" />
              {line}
            </li>
          ))}
          {lines.length > 5 ? (
            <li className="text-sm text-muted">and {lines.length - 5} more modules</li>
          ) : null}
        </ul>
      ) : (
        <p className={quiet}>No permissions are granted yet.</p>
      )}
    </SideCard>
  );
}

/** The last five things done by or to the member (the audit log). */
export function RecentActivity({ id }: { id: string }) {
  const activity = useApiQuery(['staff', 'activity', id, 5], () =>
    api.staff.activity(id, { limit: 5 }),
  );
  const items = activity.data?.items ?? [];
  return (
    <SideCard
      title="Recent Activity"
      icon={Clock}
      testId="recent-activity"
      action={
        <Link href={`/team/${id}/security/activity`} className={sideLink}>
          View All Activity
        </Link>
      }
    >
      {activity.isPending ? (
        <Skeleton className="h-24" />
      ) : activity.isError ? (
        <p className={quiet}>{NOT_LOADED}</p>
      ) : items.length ? (
        <ul className="flex flex-col divide-y divide-divider">
          {items.map((item) => (
            <li key={item.id} className="grid grid-cols-[minmax(0,11rem)_1fr] gap-3 py-2 text-sm">
              <time dateTime={item.at} className="text-muted">
                {dateTime(item.at)}
              </time>
              <span className="min-w-0 break-words text-text">
                {item.label}
                {item.actorName ? ` by ${item.actorName}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={quiet}>No activity yet.</p>
      )}
    </SideCard>
  );
}

/** The internal note (Owner and Admin): the text, who changed it last, and Edit. */
export function NotesCard({ id, enabled }: { id: string; enabled: boolean }) {
  const note = useApiQuery(['staff', 'note', id], () => api.staff.note(id));
  const [editing, setEditing] = useState(false);
  const n = note.data;
  return (
    <SideCard
      title="Notes"
      icon={NotePencil}
      testId="staff-notes"
      action={
        <Button
          variant="ghost"
          disabled={!enabled || note.isPending || note.isError}
          onClick={() => setEditing(true)}
        >
          <PencilSimple aria-hidden weight="bold" className="size-4" />
          Edit
        </Button>
      }
    >
      {note.isPending ? (
        <Skeleton className="h-16" />
      ) : note.isError ? (
        <p className={quiet}>{NOT_LOADED}</p>
      ) : n ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm break-words whitespace-pre-line text-text">{n.text}</p>
          <p className="text-xs text-muted">
            Last updated: {longDate(n.updatedAt)}
            {n.updatedBy ? ` by ${n.updatedBy}` : ''}
          </p>
        </div>
      ) : (
        <p className={quiet}>No notes yet. Add one with Edit.</p>
      )}
      {editing ? (
        <NoteModal id={id} text={n?.text ?? ''} onClose={() => setEditing(false)} />
      ) : null}
    </SideCard>
  );
}

function NoteModal({ id, text, onClose }: { id: string; text: string; onClose: () => void }) {
  const [value, setValue] = useState(text);
  const save = useApiMutation((t: string) => api.staff.setNote(id, { text: t }), {
    invalidate: ['staff', 'note', id],
  });
  return (
    <Modal open title="Edit Notes" onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(value, { onSuccess: onClose });
        }}
      >
        <div className="flex flex-col gap-1">
          <Textarea
            label="Account Notes"
            maxLength={500}
            rows={5}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <p className="self-end text-xs text-muted">{value.length}/500</p>
        </div>
        <p className="text-xs text-muted">
          Only Owners and Admins see these notes. Leave it empty to remove the note.
        </p>
        {save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, MEMBER_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Save Notes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
