'use client';

import { PageHeader, Skeleton, Timeline, Toast } from '@firmivra/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { errorCode } from '../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../lib/query';
import {
  FormLayout,
  FormSkeleton,
  MemberForm,
  MemberFormFrame,
  SideCard,
  TeamBreadcrumb,
} from '../../../_components/member-form';
import { activityItems } from '../../../_components/member-profile';
import { adminTeam, errorMessage, TEAM_ERROR_MESSAGES } from '../../../_components/team-api';
import { QuietLine, TEAM_KEY, UNREACHABLE } from '../../../_components/team-parts';

function SideSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <Skeleton />
      <Skeleton className="w-2/3" />
      <Skeleton className="w-3/4" />
    </div>
  );
}

/**
 * Edit Team Member (creating-team docx §21): the add form filled in, under the same authority
 * rules. A new role or department reloads the role's template after a warning when custom
 * permissions would be replaced; the side shows the review and the person's audit trail.
 */
export function EditMemberScreen({ memberId }: { memberId: string }) {
  const member = useApiQuery([...TEAM_KEY, 'member', memberId], () => adminTeam.member(memberId));
  const options = useApiQuery([...TEAM_KEY, 'form-options', memberId], () =>
    adminTeam.formOptions(memberId),
  );
  const activity = useApiQuery([...TEAM_KEY, 'activity', memberId], () =>
    adminTeam.activity(memberId),
  );
  const [saved, setSaved] = useState('');
  const focusedRef = useRef(false);
  const ready = Boolean(member.data && options.data);

  // "Change Role & Permissions" opens this page at #role: put the role field in view once.
  useEffect(() => {
    if (!ready || focusedRef.current || window.location.hash !== '#role') return;
    focusedRef.current = true;
    const field = document.getElementById('role');
    field?.scrollIntoView({ block: 'center' });
    field?.focus();
  }, [ready]);

  const activityCard = (
    <SideCard title="Recent Activity">
      {activity.isPending ? (
        <SideSkeleton />
      ) : activity.isError ? (
        <p className="text-sm text-muted">{UNREACHABLE}</p>
      ) : (
        <Timeline
          items={activityItems(activity.data.slice(0, 8))}
          variant="plain"
          label="Recent activity"
          emptyText="No activity yet."
        />
      )}
    </SideCard>
  );

  const quiet = (text: string) => (
    <FormLayout
      form={<QuietLine testId="edit-member-quiet">{text}</QuietLine>}
      aside={
        <SideCard title="Review">
          <p className="text-sm text-muted">{text}</p>
        </SideCard>
      }
    />
  );
  // The API is unreachable: the form's frame stays, empty and disabled, with the person's activity.
  const frame = (text: string) => (
    <MemberFormFrame mode="edit" message={text} testId="edit-member-quiet" aside={activityCard} />
  );

  let body: ReactNode = null;
  if (member.isPending || options.isPending)
    body = (
      <FormLayout
        form={<FormSkeleton />}
        aside={
          <SideCard title="Review">
            <SideSkeleton />
          </SideCard>
        }
      />
    );
  else if (member.isError && !member.data)
    body =
      errorCode(member.error) === 'NOT_FOUND'
        ? quiet(
            "We couldn't find this team member. They may have been removed, or the link is wrong.",
          )
        : frame(UNREACHABLE);
  else if (options.isError && !options.data)
    body = frame(errorMessage(options.error, TEAM_ERROR_MESSAGES));
  else if (member.data && !member.data.allowed.edit)
    body = quiet(
      `You can't edit ${member.data.name}: only someone above them in the hierarchy can.`,
    );
  else if (member.data && options.data)
    body = (
      <MemberForm
        key={member.data.updatedAt}
        mode="edit"
        member={member.data}
        options={options.data}
        aside={activityCard}
        onSaved={(next) => setSaved(`Changes to ${next.name} were saved.`)}
      />
    );

  return (
    <div data-testid="edit-member-screen" className="flex min-w-0 flex-col gap-5">
      <PageHeader
        above={<TeamBreadcrumb current="Edit Team Member" />}
        title="Edit Team Member"
        subtitle={
          member.data
            ? `Update ${member.data.name}'s details, role, access and status.`
            : "Update a team member's details, role, access and status."
        }
      />
      {saved ? <Toast message={saved} onDismiss={() => setSaved('')} /> : null}
      {body}
    </div>
  );
}
