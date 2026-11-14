import type { Metadata } from 'next';
import { AppointmentsScreen } from './_components/appointments-screen';

export const metadata: Metadata = { title: 'Appointments' };

type Props = { searchParams: Promise<{ book?: string | string[] }> };

/** `?book={typeId}`: from a booking link (Appointments Review 2, row 3), booking opens on it. */
export default async function AppointmentsPage({ searchParams }: Props) {
  const { book } = await searchParams;
  return <AppointmentsScreen book={typeof book === 'string' ? book : undefined} />;
}
