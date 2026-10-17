import type { Metadata } from 'next';
import { ClientWorkspaceScreen } from '../../_components/client-workspace';

export const metadata: Metadata = { title: 'Payroll client' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> };

export default async function PayrollClientPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { tab } = await searchParams;
  return <ClientWorkspaceScreen key={`${id}-${tab ?? ''}`} id={id} tab={tab} />;
}
