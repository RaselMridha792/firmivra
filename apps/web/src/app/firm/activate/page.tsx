import { StaffAccess } from '../../../components/staff-access';
export default async function Activate({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <StaffAccess key={token ?? 'no-invite'} site="firm" mode="activate" token={token} />;
}
