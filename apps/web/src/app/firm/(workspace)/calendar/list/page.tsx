import type { Metadata } from 'next';
import { readListQuery } from '../../../../../lib/list-query';
import { ListScreen } from './_components/list-screen';
import { LIST_VIEW } from './_components/list-view';

export const metadata: Metadata = { title: 'Appointments: List' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** `?serviceKind=BUSINESS_DEVELOPMENT` (Advisory B5): only the Business Advisory meetings. */
export default async function CalendarListPage({ searchParams }: Props) {
  const params = await searchParams;
  return (
    <ListScreen
      {...(params['serviceKind'] === 'BUSINESS_DEVELOPMENT'
        ? { serviceKind: 'BUSINESS_DEVELOPMENT' }
        : {})}
      initial={readListQuery(params, LIST_VIEW)}
    />
  );
}
