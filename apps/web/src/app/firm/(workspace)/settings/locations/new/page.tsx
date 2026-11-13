import type { Metadata } from 'next';
import { LocationForm } from '../_components/location-form';

export const metadata: Metadata = { title: 'Add New Location' };

/** Settings > Locations > Add New Location. */
export default function NewLocationPage() {
  return <LocationForm />;
}
