import type { Metadata } from 'next';
import { TeamsScreen } from './_components/teams-screen';

export const metadata: Metadata = { title: 'Teams & departments: Teams' };

export default async function TeamTeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ departmentId?: string; teamId?: string }>;
}) {
  // View All Teams and Manage Teams open this tab filtered to a department; Open Team opens a team.
  const { departmentId, teamId } = await searchParams;
  return (
    <TeamsScreen
      departmentId={typeof departmentId === 'string' ? departmentId : undefined}
      teamId={typeof teamId === 'string' ? teamId : undefined}
    />
  );
}
