import type { Metadata } from 'next';
import { DirectoryScreen } from './_components/directory-screen';

export const metadata: Metadata = { title: 'Staff directory' };

const VIEWS = ['all', 'active', 'invited', 'locked', 'inactive', 'drafts'] as const;

export default async function StaffDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  // A summary card opens the directory on its status (?status=active, inactive).
  const { status } = await searchParams;
  const view = VIEWS.find((v) => v === status) ?? 'all';
  return <DirectoryScreen view={view} />;
}
