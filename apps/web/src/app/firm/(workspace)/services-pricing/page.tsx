import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ServicesPricingScreen } from './_components/services-pricing-screen';

export const metadata: Metadata = { title: 'Services & pricing' };

export default function ServicesPricingPage() {
  return (
    <Suspense>
      <ServicesPricingScreen />
    </Suspense>
  );
}
