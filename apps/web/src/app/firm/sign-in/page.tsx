import { StaffAccess } from '../../../components/staff-access';

export default async function FirmSignIn({
  searchParams,
}: {
  searchParams: Promise<{ dev?: string }>;
}) {
  const query = await searchParams;
  return <StaffAccess site="firm" devTools={query.dev === '1'} />;
}
