import type { Metadata } from 'next';
import { ServiceEditor } from './_components/service-editor';

export const metadata: Metadata = { title: 'Add new service' };

export default function ServicesPricingNewPage() {
  return <ServiceEditor />;
}
