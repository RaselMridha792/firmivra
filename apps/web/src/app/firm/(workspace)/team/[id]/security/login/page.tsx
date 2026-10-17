import type { Metadata } from 'next';
import { LoginTab } from '../_components/login-tab';

export const metadata: Metadata = { title: 'Staff security: Login & security' };

export default async function TeamIdSecurityLoginPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LoginTab id={id} />;
}
