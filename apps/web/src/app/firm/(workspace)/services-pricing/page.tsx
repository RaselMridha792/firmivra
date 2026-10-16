import type { Metadata } from 'next';
import { ServicesPricingScreen } from './_components/services-pricing-screen';

export const metadata: Metadata = { title: 'Services & pricing' };

export default function ServicesPricingPage() {
  return <ServicesPricingScreen />;
}
