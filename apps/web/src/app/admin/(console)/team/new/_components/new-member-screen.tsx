'use client';

import { CheckCircle } from '@phosphor-icons/react';
import { Button, Callout, PageHeader, Skeleton } from '@firmivra/ui';
import { useState } from 'react';
import { useApiQuery } from '../../../../../../lib/query';
import {
  adminTeam,
  type AdminTeamMember,
  MEMBER_STATUSES,
} from '../../../../../../mocks/admin-team';
import {
  FormLayout,
  FormSkeleton,
  MemberForm,
  SideCard,
  TeamBreadcrumb,
} from '../../_components/member-form';
import { ButtonLink, QuietLine, TEAM_KEY, UNREACHABLE } from '../../_components/team-parts';

/**
 * Add Team Member (creating-team-firmivra-add-team-member-portal.jpg, docx §4 and §24) as a page:
 * the CEO's master form, which shows fewer departments, roles, scopes and permissions to lower
 * levels and nothing to someone who may not add people.
 */
export function NewMemberScreen() {
  const viewer = useApiQuery([...TEAM_KEY, 'viewer'], () => adminTeam.viewer());
  const options = useApiQuery([...TEAM_KEY, 'form-options'], () => adminTeam.formOptions());
  const [added, setAdded] = useState<AdminTeamMember | null>(null);
  const [round, setRound] = useState(0);

  const failed = (viewer.isError && !viewer.data) || (options.isError && !options.data);
  const quiet = (text: string) => ({
    form: <QuietLine testId="new-member-quiet">{text}</QuietLine>,
    aside: (
      <SideCard title="Review">
        <p className="text-sm text-muted">{text}</p>
      </SideCard>
    ),
  });
  const frames =
    viewer.isPending || options.isPending
      ? {
          form: <FormSkeleton />,
          aside: (
            <SideCard title="Review">
              <div aria-hidden className="flex flex-col gap-3">
                <Skeleton />
                <Skeleton className="w-2/3" />
                <Skeleton className="w-3/4" />
              </div>
            </SideCard>
          ),
        }
      : failed
        ? quiet(UNREACHABLE)
        : !viewer.data?.can.add
          ? quiet(
              "You don't have permission to add team members. Ask your department head or the CEO.",
            )
          : null;

  return (
    <div data-testid="new-member-screen" className="flex min-w-0 flex-col gap-5">
      <PageHeader
        above={<TeamBreadcrumb current="Add Team Member" />}
        title="Add Team Member"
        subtitle="Invite a new team member, and set their department, role, and access permissions."
      />
      {added ? (
        <Callout
          icon={CheckCircle}
          surface="success"
          tone="green"
          title={`${added.name} was added to the team`}
          action={
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/team">Back to Team</ButtonLink>
              <Button
                variant="secondary"
                onClick={() => {
                  setAdded(null);
                  setRound(round + 1);
                }}
              >
                Add Another
              </Button>
            </div>
          }
        >
          <span data-testid="member-added">
            {added.roleTitle} in {added.departmentName}. Status: {MEMBER_STATUSES[added.status]}.
          </span>
        </Callout>
      ) : null}
      {frames ? (
        <FormLayout form={frames.form} aside={frames.aside} />
      ) : options.data && !added ? (
        <MemberForm key={round} mode="create" options={options.data} onSaved={setAdded} />
      ) : null}
    </div>
  );
}
