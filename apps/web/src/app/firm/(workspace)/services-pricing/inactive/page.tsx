import type { Metadata } from 'next';
import { InactiveServices } from './_components/inactive-services';

export const metadata: Metadata = { title: 'Services & pricing: Inactive services' };

export default function ServicesPricingInactivePage() {
  return <InactiveServices />;
}
