import type { Metadata } from 'next';
import { SetupScreen } from '../../_components/setup-screen';

export const metadata: Metadata = { title: 'Recurring deadlines and calendars' };

type Props = {
  searchParams: Promise<{ tab?: string; edit?: string; deadline?: string; saved?: string }>;
};

/**
 * `?deadline=<id>` starts a recurring rule from that deadline (its Save and Make Recurring).
 * `from` is the way back (lib/origin.ts) and is never read as a deadline.
 */
export default async function RecurringSetupPage({ searchParams }: Props) {
  const { tab, edit, deadline: from, saved } = await searchParams;
  return (
    <SetupScreen
      // The tab is not in the key: switching tabs keeps the page and its drafts (CD-F09, F12).
      key={`${edit ?? ''}-${from ?? ''}-${saved ?? ''}`}
      tab={tab}
      editId={edit}
      fromDeadline={from}
      saved={saved}
    />
  );
}
