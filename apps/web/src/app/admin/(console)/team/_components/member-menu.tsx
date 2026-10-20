'use client';

import {
  ArrowCounterClockwise,
  ChatText,
  CheckCircle,
  DotsThree,
  DotsThreeVertical,
  Envelope,
  IdentificationCard,
  PencilSimple,
  Prohibit,
  ShieldCheck,
  UserMinus,
  XCircle,
} from '@phosphor-icons/react';
import { ActionMenu, type ActionMenuItem } from '@firmivra/ui';
import { useRouter } from 'next/navigation';
import type { AdminTeamMember } from './team-api';

/** What a member's menu can ask the page to do; navigation happens here. */
export type MemberCommand =
  'profile' | 'message' | 'suspend' | 'reactivate' | 'resend' | 'approve' | 'reject' | 'remove';

/** The ⋮ menu on a card and the ⋯ menu in a row: only what the signed-in admin may do. */
export function MemberMenu({
  member,
  vertical,
  onCommand,
}: {
  member: AdminTeamMember;
  vertical?: boolean;
  onCommand: (command: MemberCommand, member: AdminTeamMember) => void;
}) {
  const router = useRouter();
  const { allowed, status } = member;
  const run = (command: MemberCommand) => () => onCommand(command, member);
  const edit = `/team/${member.id}/edit`;
  const main: ActionMenuItem[] = [
    { label: 'View Profile', icon: IdentificationCard, onSelect: run('profile') },
    ...(allowed.edit
      ? [{ label: 'Edit Member', icon: PencilSimple, onSelect: () => router.push(edit) }]
      : []),
    ...(allowed.message
      ? [{ label: 'Send Message', icon: ChatText, onSelect: run('message') }]
      : []),
    ...(allowed.changeRole
      ? [
          {
            label: 'Change Role & Permissions',
            icon: ShieldCheck,
            onSelect: () => router.push(`${edit}#role`),
          },
        ]
      : []),
  ];
  const account: ActionMenuItem[] = [
    ...(allowed.approve
      ? [
          { label: 'Approve Role', icon: CheckCircle, onSelect: run('approve') },
          { label: 'Reject Role', icon: XCircle, onSelect: run('reject') },
        ]
      : []),
    ...(allowed.resendInvite
      ? [{ label: 'Resend Invitation', icon: Envelope, onSelect: run('resend') }]
      : []),
    ...(allowed.changeStatus && status === 'ACTIVE'
      ? [{ label: 'Suspend', icon: Prohibit, onSelect: run('suspend') }]
      : []),
    ...(allowed.changeStatus && ['SUSPENDED', 'INACTIVE', 'DEACTIVATED'].includes(status)
      ? [{ label: 'Reactivate', icon: ArrowCounterClockwise, onSelect: run('reactivate') }]
      : []),
    ...(allowed.remove
      ? [{ label: 'Remove from Team', icon: UserMinus, danger: true, onSelect: run('remove') }]
      : []),
  ];
  const Glyph = vertical ? DotsThreeVertical : DotsThree;
  return (
    <ActionMenu
      label={`Actions for ${member.name}`}
      trigger={<Glyph aria-hidden weight="bold" className="size-5 text-action" />}
      sections={[
        { items: main },
        ...(account.length ? [{ title: 'Account', items: account }] : []),
      ]}
    />
  );
}
