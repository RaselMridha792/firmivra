import type { Metadata } from 'next';
import { LogsScreen } from '../_components/logs-screen';

export const metadata: Metadata = { title: 'Automation logs' };

type Props = { searchParams: Promise<{ ruleId?: string }> };

export default async function AutomationLogsPage({ searchParams }: Props) {
  const { ruleId } = await searchParams;
  return <LogsScreen key={ruleId ?? 'all'} ruleId={ruleId} />;
}
