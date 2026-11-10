import type { Metadata } from 'next';
import { LocationsScreen } from './_components/locations-screen';

export const metadata: Metadata = { title: 'Locations' };

/** Settings > Locations (Octavia's settings review, P0 and the Locations module). */
export default function LocationsPage() {
  return <LocationsScreen />;
}
