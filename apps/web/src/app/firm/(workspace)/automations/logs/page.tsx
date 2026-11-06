import type { Metadata } from 'next';
import { LogsScreen } from '../_components/logs-screen';

export const metadata: Metadata = { title: 'Automation logs' };

type Props = { searchParams: Promise<{ ruleId?: string; run?: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AutomationLogsPage({ searchParams }: Props) {
  const { ruleId, run } = await searchParams;
  // `?run=` (a bell item's link): that run's details open first. The API still checks it is this
  // firm's run and one the person may see (404 otherwise).
  const runId = run && UUID.test(run) ? run : undefined;
  return <LogsScreen key={`${ruleId ?? 'all'}:${runId ?? ''}`} ruleId={ruleId} runId={runId} />;
}
