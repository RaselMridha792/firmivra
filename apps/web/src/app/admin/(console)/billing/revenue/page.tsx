import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RevenueScreen } from './_components/revenue-screen';

export const metadata: Metadata = { title: 'Revenue' };

/** Billing > Revenue (SA-BIL-A1): collected revenue by period and type; the Dashboard links here. */
export default function AdminBillingRevenuePage() {
  return (
    <Suspense>
      <RevenueScreen />
    </Suspense>
  );
}
