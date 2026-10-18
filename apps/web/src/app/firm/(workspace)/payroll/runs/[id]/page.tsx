import type { Metadata } from 'next';
import { RunScreen } from '../../_components/run-screen';

export const metadata: Metadata = { title: 'Payroll run' };

type Props = { params: Promise<{ id: string }> };

export default async function PayrollRunPage({ params }: Props) {
  const { id } = await params;
  return <RunScreen id={id} />;
}
