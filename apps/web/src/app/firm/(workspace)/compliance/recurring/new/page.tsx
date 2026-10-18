import type { Metadata } from 'next';
import { SetupScreen } from '../../_components/setup-screen';

export const metadata: Metadata = { title: 'Recurring deadlines and calendars' };

type Props = {
  searchParams: Promise<{ tab?: string; edit?: string; from?: string; saved?: string }>;
};

export default async function RecurringSetupPage({ searchParams }: Props) {
  const { tab, edit, from, saved } = await searchParams;
  return (
    <SetupScreen
      key={`${tab ?? ''}-${edit ?? ''}-${from ?? ''}-${saved ?? ''}`}
      tab={tab}
      editId={edit}
      fromDeadline={from}
      saved={saved}
    />
  );
}
