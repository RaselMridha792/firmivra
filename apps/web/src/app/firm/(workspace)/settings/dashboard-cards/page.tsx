import type { Metadata } from 'next';
import { DashboardCardsScreen } from './_components/dashboard-cards-screen';

export const metadata: Metadata = { title: 'Dashboard cards' };

/** D4: Settings > Dashboard Cards (Owner and Admin; the API answers 403 to the rest). */
export default function DashboardCardsPage() {
  return <DashboardCardsScreen />;
}
