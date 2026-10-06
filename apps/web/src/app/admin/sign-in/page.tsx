import { StaffAccess } from '../../../components/staff-access';

export default async function AdminSignIn({
  searchParams,
}: {
  searchParams: Promise<{ dev?: string }>;
}) {
  const query = await searchParams;
  return <StaffAccess site="admin" devTools={query.dev === '1'} />;
}
