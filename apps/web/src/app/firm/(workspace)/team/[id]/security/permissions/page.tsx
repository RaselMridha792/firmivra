import type { Metadata } from 'next';
import { PermissionsTab } from '../_components/permissions-tab';

export const metadata: Metadata = { title: 'Staff security: Permissions' };

export default async function TeamIdSecurityPermissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PermissionsTab id={id} />;
}
