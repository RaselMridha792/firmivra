import type { Metadata } from 'next';
import { ResourceLibrary } from '../_components/resources-screen';

export const metadata: Metadata = { title: 'Business advisory: Resources' };

export default function BusinessAdvisoryResourcesPage() {
  return <ResourceLibrary />;
}
