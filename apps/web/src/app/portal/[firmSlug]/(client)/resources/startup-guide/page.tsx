import type { Metadata } from 'next';
import { ResourcePage } from '../_components/resource-page';

export const metadata: Metadata = { title: 'Business Startup Guide' };

export default function Page() {
  return (
    <ResourcePage
      page="startup-guide"
      heading="Business Startup"
      highlight="Guide"
      intro="The steps to start your business the right way, from choosing a structure to opening your books."
    />
  );
}
