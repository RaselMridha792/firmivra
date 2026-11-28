'use client';

import {
  ArrowsClockwise,
  Buildings,
  CheckCircle,
  Envelope,
  PencilSimple,
  ShieldCheck,
  TreeStructure,
  UserPlus,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import { Avatar, Badge, Button, Drawer, Skeleton, Timeline, type TimelineItem } from '@firmivra/ui';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useApiQuery } from '../../../../../lib/query';
import type { MemberCommand } from './member-menu';
import {
  ACCESS_SCOPES,
  adminTeam,
  AUTHORITY_LEVELS,
  type AdminTeamMember,
  errorMessage,
  PERMISSION_ACTIONS,
  roleTemplate,
  TEAM_ERROR_MESSAGES,
  type TeamActivity,
  type TeamActivityKind,
  teamModules,
} from './team-api';
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
  // The API's own kinds: activation, a new supervisor and R0's bootstrap.
  ACTIVATED: { icon: CheckCircle, tone: 'green' },
  REPORTS_TO_CHANGED: { icon: TreeStructure, tone: 'purple' },
  MAPPED_TO_CEO: { icon: ShieldCheck, tone: 'purple' },
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
    // No actor: the platform itself (R0's bootstrap).
    actor: entry.actor
      ? entry.approver
        ? `${entry.actor.name} (approved)`
        : entry.actor.name
      : 'System',
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
  const modules = teamModules();
  // SA-TEAM-P03: the role's template, to say where each permission comes from (Edit's choices
  // load it; someone the viewer can't reach gets the list without its sources).
  const options = useApiQuery([...TEAM_KEY, 'form-options', member?.id ?? 'none'], () =>
    member ? adminTeam.formOptions(member.id) : Promise.resolve(null),
  );
  const template = member && options.data ? roleTemplate(member.roleId) : null;
  const sourceOf = (area: string, action: string) => {
    if (member?.accessLevel === 'SUPER_ADMIN') return 'Full access (CEO / Super Admin)';
    if (!template) return null;
    const held: readonly string[] = template[area as keyof typeof template] ?? [];
    return held.includes(action) ? 'Role template' : 'Added for this person';
  };
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
          <Section title="Effective Access">
            <p className="mb-2 text-xs text-muted">
              What {member.name} can do, and where each permission comes from.
            </p>
            <ul data-testid="effective-access" className="flex flex-col gap-2 text-sm">
              {modules
                .filter(
                  (area) =>
                    member.permissions[area.id]?.length ||
                    (template?.[area.id]?.length && member.accessLevel !== 'SUPER_ADMIN'),
                )
                .map((area) => {
                  const granted = member.permissions[area.id] ?? [];
                  const removed =
                    member.accessLevel === 'SUPER_ADMIN'
                      ? []
                      : (template?.[area.id] ?? []).filter((action) => !granted.includes(action));
                  return (
                    <li key={area.id} className="flex flex-col gap-0.5">
                      <span className="font-semibold text-heading">{area.label}</span>
                      {granted.map((action) => {
                        const source = sourceOf(area.id, action);
                        return (
                          <span key={action} className="flex flex-wrap gap-x-2 text-text">
                            {ACTION_LABELS[action] ?? action}
                            {source ? <span className="text-muted">· {source}</span> : null}
                          </span>
                        );
                      })}
                      {removed.map((action) => (
                        <span
                          key={action}
                          className="flex flex-wrap gap-x-2 text-muted line-through"
                        >
                          {ACTION_LABELS[action] ?? action}
                          <span className="no-underline">· Removed for this person</span>
                        </span>
                      ))}
                    </li>
                  );
                })}
            </ul>
            {modules.every((area) => !member.permissions[area.id]?.length) ? (
              <p className="text-sm text-muted">No module access yet.</p>
            ) : null}
            {options.isError ? (
              <p className="mt-2 text-xs text-muted">
                Where each permission comes from is shown to those who can edit this person.
              </p>
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
