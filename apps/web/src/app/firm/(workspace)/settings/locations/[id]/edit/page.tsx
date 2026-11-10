import type { Metadata } from 'next';
import { LocationForm } from '../../_components/location-form';

export const metadata: Metadata = { title: 'Edit Location' };

/** Settings > Locations > Edit Location. */
export default async function EditLocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LocationForm id={id} />;
}
