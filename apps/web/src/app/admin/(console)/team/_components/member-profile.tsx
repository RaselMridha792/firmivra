'use client';

import {
  ArrowsClockwise,
  Buildings,
  CheckCircle,
  Envelope,
  PencilSimple,
  ShieldCheck,
  UserPlus,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import { Avatar, Badge, Button, Drawer, Skeleton, Timeline, type TimelineItem } from '@firmivra/ui';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import {
  ACCESS_SCOPES,
  adminTeam,
  AUTHORITY_LEVELS,
  type AdminTeamMember,
  PERMISSION_ACTIONS,
  TEAM_ERROR_MESSAGES,
  TEAM_MODULES,
  type TeamActivity,
  type TeamActivityKind,
} from '../../../../../mocks/admin-team';
import type { MemberCommand } from './member-menu';
import {
  AccessBadge,
  formatDate,
  formatDateTime,
  Presence,
  QuietLine,
  StatusBadge,
  TEAM_KEY,
} from './team-parts';

const ACTIVITY_ICONS: Record<TeamActivityKind, { icon: Icon; tone: TimelineItem['tone'] }> = {
  CREATED: { icon: UserPlus, tone: 'blue' },
  INVITED: { icon: Envelope, tone: 'blue' },
  PROFILE_UPDATED: { icon: PencilSimple, tone: 'grey' },
  DEPARTMENT_CHANGED: { icon: Buildings, tone: 'purple' },
  ROLE_CHANGED: { icon: ShieldCheck, tone: 'purple' },
  PERMISSIONS_CHANGED: { icon: ShieldCheck, tone: 'amber' },
  SCOPE_CHANGED: { icon: ShieldCheck, tone: 'amber' },
  STATUS_CHANGED: { icon: ArrowsClockwise, tone: 'grey' },
  APPROVED: { icon: CheckCircle, tone: 'green' },
  REJECTED: { icon: XCircle, tone: 'red' },
};

const ACTION_LABELS: Record<string, string> = Object.fromEntries(
  PERMISSION_ACTIONS.map(({ id, label }): [string, string] => [id, label]),
);

/** The audit trail as timeline rows: "Role changed: Account Executive → Sales Manager". */
export function activityItems(entries: TeamActivity[]): TimelineItem[] {
  return entries.map((entry) => ({
    id: entry.id,
    icon: ACTIVITY_ICONS[entry.kind].icon,
    tone: ACTIVITY_ICONS[entry.kind].tone,
    title:
      entry.previousValue && entry.newValue
        ? `${entry.summary}: ${entry.previousValue} → ${entry.newValue}`
        : entry.summary,
    time: formatDateTime(entry.at),
    dateTime: entry.at,
    actor: entry.approver ? `${entry.actor.name} (approved)` : entry.actor.name,
  }));
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-5 gap-3 py-1.5 text-sm">
      <dt className="col-span-2 text-muted">{label}</dt>
      <dd className="col-span-3 min-w-0 wrap-anywhere text-text">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-divider pt-4">
      <h3 className="mb-2 text-sm font-bold text-heading">{title}</h3>
      {children}
    </section>
  );
}

/** Team docx §6, the member profile: identity, organization, contact, account and access. */
export function MemberProfile({
  member,
  onClose,
  onCommand,
}: {
  member: AdminTeamMember | null;
  onClose: () => void;
  onCommand: (command: MemberCommand, member: AdminTeamMember) => void;
}) {
  const router = useRouter();
  const activity = useApiQuery([...TEAM_KEY, 'activity', member?.id], () =>
    member ? adminTeam.activity(member.id) : Promise.resolve([]),
  );
  return (
    <Drawer
      open={member !== null}
      title={member?.name ?? 'Team member'}
      subtitle={member?.jobTitle}
      onClose={onClose}
      footer={
        member ? (
          <>
            {member.allowed.approve ? (
              <>
                <Button variant="secondary" onClick={() => onCommand('reject', member)}>
                  Reject Role
                </Button>
                <Button onClick={() => onCommand('approve', member)}>Approve Role</Button>
              </>
            ) : null}
            {member.allowed.message ? (
              <Button variant="secondary" onClick={() => onCommand('message', member)}>
                Message
              </Button>
            ) : null}
            {member.allowed.edit ? (
              <Button onClick={() => router.push(`/team/${member.id}/edit`)}>Edit Member</Button>
            ) : null}
          </>
        ) : null
      }
    >
      {member ? (
        <div data-testid="member-profile" className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={member.name} size="xl" />
            <div className="flex flex-col items-start gap-1.5">
              <Presence value={member.availability} pill />
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={member.status} />
                <AccessBadge level={member.accessLevel} />
                {member.customPermissions ? (
                  <Badge tone="warning">Custom Permissions Applied</Badge>
                ) : null}
              </div>
            </div>
          </div>
          <Section title="Organization">
            <dl>
              <Row label="Department">{member.departmentName}</Row>
              <Row label="Role">{member.roleTitle}</Row>
              <Row label="Authority level">
                Level {member.level}: {AUTHORITY_LEVELS[member.level]}
              </Row>
              <Row label="Reports to">{member.reportsTo?.name ?? 'No direct supervisor'}</Row>
              <Row label="Team">{member.teamName ?? 'No team'}</Row>
              <Row label="Location">{member.locationName ?? 'No location'}</Row>
            </dl>
          </Section>
          <Section title="Contact">
            <dl>
              <Row label="Email">
                <a href={`mailto:${member.email}`} className="text-link hover:underline">
                  {member.email}
                </a>
              </Row>
              <Row label="Phone">{member.phone ?? 'No phone number'}</Row>
            </dl>
          </Section>
          <Section title="Account">
            <dl>
              <Row label="Access scope">
                {ACCESS_SCOPES.find((scope) => scope.id === member.scope)?.label ?? member.scope}
              </Row>
              <Row label="Date added">{formatDate(member.createdAt)}</Row>
              <Row label="Added by">{member.invitedBy?.name ?? '—'}</Row>
              {member.approvedBy ? <Row label="Approved by">{member.approvedBy.name}</Row> : null}
              <Row label="Last active">
                {member.lastActiveAt ? formatDateTime(member.lastActiveAt) : 'Not yet'}
              </Row>
            </dl>
          </Section>
          <Section title="Permissions">
            <ul className="flex flex-col gap-1.5 text-sm">
              {TEAM_MODULES.filter((area) => member.permissions[area.id]?.length).map((area) => (
                <li key={area.id} className="flex flex-wrap gap-x-2">
                  <span className="font-semibold text-heading">{area.label}:</span>
                  <span className="text-text">
                    {(member.permissions[area.id] ?? [])
                      .map((action) => ACTION_LABELS[action] ?? action)
                      .join(', ')}
                  </span>
                </li>
              ))}
            </ul>
            {TEAM_MODULES.every((area) => !member.permissions[area.id]?.length) ? (
              <p className="text-sm text-muted">No module access yet.</p>
            ) : null}
          </Section>
          <Section title="Recent Activity">
            {activity.isPending ? (
              <div aria-hidden className="flex flex-col gap-2">
                <Skeleton />
                <Skeleton className="w-2/3" />
              </div>
            ) : activity.isError ? (
              <QuietLine>{errorMessage(activity.error, TEAM_ERROR_MESSAGES)}</QuietLine>
            ) : (
              <Timeline
                items={activityItems(activity.data.slice(0, 8))}
                variant="plain"
                label={`Recent activity for ${member.name}`}
                emptyText="No activity yet."
              />
            )}
          </Section>
        </div>
      ) : null}
    </Drawer>
  );
}
