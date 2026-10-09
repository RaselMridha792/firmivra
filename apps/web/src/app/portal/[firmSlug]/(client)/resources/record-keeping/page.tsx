import type { Metadata } from 'next';
import { ResourcePage } from '../_components/resource-page';

export const metadata: Metadata = { title: 'Record Keeping Best Practices' };

export default function Page() {
  return (
    <ResourcePage
      page="record-keeping"
      heading="Record Keeping"
      highlight="Best Practices"
      intro="Stay organized. Stay compliant. Build a stronger business."
    />
  );
}
