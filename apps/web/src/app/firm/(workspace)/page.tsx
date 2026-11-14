import type { Metadata } from 'next';
import { DashboardScreen } from './_components/dashboard-screen';
import { addressOf, placeFrom } from './_components/dashboard-place';

export const metadata: Metadata = { title: 'Dashboard' };

type Param = string | string[] | undefined;

/**
 * `?period=&start=&end=`, `pipeline…` and `revenue…`: the periods the dashboard shows (Dashboard
 * Review 2, K2), kept in its address so Back to Dashboard returns to them.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, Param>>;
}) {
  const q = await searchParams;
  const place = placeFrom((key) => {
    const value = q[key];
    return typeof value === 'string' ? value : undefined;
  });
  // A new address (a link to the dashboard) starts the screen over on its periods.
  return <DashboardScreen key={addressOf(place)} initial={place} />;
}
