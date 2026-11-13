import type { Metadata } from 'next';
import { ListScreen } from './_components/list-screen';

export const metadata: Metadata = { title: 'Appointments: List' };

type Props = { searchParams: Promise<{ serviceKind?: string | string[] }> };

/** `?serviceKind=BUSINESS_DEVELOPMENT` (Advisory B5): only the Business Advisory meetings. */
export default async function CalendarListPage({ searchParams }: Props) {
  const { serviceKind } = await searchParams;
  return (
    <ListScreen
      {...(serviceKind === 'BUSINESS_DEVELOPMENT' ? { serviceKind: 'BUSINESS_DEVELOPMENT' } : {})}
    />
  );
}
